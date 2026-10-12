// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { ExplainModal } from "../ui/ExplainModal";
import { renderExplainBlocks } from "../ui/explainPreview";
import { explainBlocks } from "../ai/explain";
import { FULL, META, clone } from "./explainFixture";

/**
 * The Explain dialog: it writes the note on the model's say-so only after the learner chose to, never saves without a
 * press, tells the learner what the plugin could not verify, and never overwrites an earlier note.
 */

installObsidianDom();

const ENTRY = { simplified: "方便", traditional: "方便", pinyin: "fāng biàn", definitions: ["convenient"], hsk: { source: "2.0", levels: ["3"] } };

function make(
  opts: {
    explain?: () => Promise<any>;
    existing?: { path: string } | null;
    provider?: string;
    saveFails?: boolean;
    openAfterSave?: boolean;
  } = {}
) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.ai.enabled = true;
  settings.ai.provider = opts.provider ?? "openai";
  settings.explain.openAfterSave = opts.openAfterSave ?? true;
  const created: Array<[string, string]> = [];
  const leaf = { setViewState: vi.fn(async () => {}) };
  const app: any = new App();
  app.vault = {
    getMarkdownFiles: () => (opts.existing ? [{ path: opts.existing.path, stat: { ctime: 1 } }] : []),
    getAbstractFileByPath: (p: string) => (created.some(([c]) => c === p) ? {} : null),
    createFolder: vi.fn(async () => {}),
    create: vi.fn(async (p: string, c: string) => {
      if (opts.saveFails) throw new Error("disk full");
      created.push([p, c]);
      return { path: p };
    }),
  };
  app.metadataCache = { getFileCache: () => ({ frontmatter: { "cci-explain": true, "cci-word": "方便|fang1 bian4" } }) };
  app.workspace = { getLeaf: vi.fn(() => leaf) };
  const plugin: any = {
    settings,
    dictionary: { lookup: (s: string) => (s === "方便" ? [ENTRY] : []), isTraditionalMarker: () => false },
    vocab: { bySurface: () => undefined },
    explain: { generate: vi.fn(opts.explain ?? (async () => ({ result: clone(FULL), issues: [] }))) },
  };
  const modal = new ExplainModal(app, plugin, "方便", "住在这里很方便。");
  modal.open();
  const root = modal.contentEl as HTMLElement;
  return { modal, root, plugin, app, created, leaf };
}
const btn = (r: HTMLElement, text: string) => Array.from(r.querySelectorAll("button")).find((b) => b.textContent === text)!;
const text = (r: HTMLElement) => r.textContent ?? "";
const lastNotice = () => Notice.instances.at(-1)?.message;
const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

beforeEach(() => {
  document.body.innerHTML = "";
  Notice.instances.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("writing the explanation", () => {
  it("asks the service with the facts about the word, shows progress, then the note as a preview", async () => {
    const { root, plugin, modal } = make();
    expect(text(root)).toContain("Explain 方便");
    expect(text(root)).toContain("Writing the explanation…");
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    expect(plugin.explain.generate).toHaveBeenCalledTimes(1);
    expect(plugin.explain.generate.mock.calls[0][0]).toMatchObject({ surface: "方便", pinyin: "fāng biàn", sentence: "住在这里很方便。", hskLevels: ["3"] });
    expect(root.querySelector(".cci-explain-callout")!.textContent).toContain("AI-generated");
    expect(root.querySelector("h3")!.textContent).toBe("方便 (fāng biàn)");
    expect(text(root)).toContain("When you need this word");
    expect(text(root)).toContain("这里买东西很方便。");
    expect(root.querySelector(".cci-explain-caveat")).toBeNull();
    // nothing is written before Save, and Close just closes
    const close = vi.spyOn(modal, "close");
    btn(root, "Close").click();
    expect(close).toHaveBeenCalled();
  });

  it("says what the plugin could not get right, rather than presenting a silently worse note", async () => {
    const { root } = make({ explain: async () => ({ result: clone(FULL), issues: ["Example 2 needs pinyin.", "Another."] }) });
    await vi.waitFor(() => expect(root.querySelector(".cci-explain-caveat")).toBeTruthy());
    expect(text(root)).toContain("even after asking again: Example 2 needs pinyin. Another.");
  });

  it("Regenerate asks again and replaces the preview", async () => {
    let n = 0;
    const second = clone(FULL);
    second.summary = "Second version.";
    const { root, plugin } = make({ explain: async () => ({ result: n++ === 0 ? clone(FULL) : second, issues: [] }) });
    await vi.waitFor(() => expect(btn(root, "Regenerate")).toBeTruthy());
    btn(root, "Regenerate").click();
    await vi.waitFor(() => expect(text(root)).toContain("Second version."));
    expect(plugin.explain.generate).toHaveBeenCalledTimes(2);
  });

  it("shows a failure with Try again, and Close", async () => {
    let n = 0;
    const { root, modal } = make({
      explain: async () => {
        if (n++ === 0) throw new Error("rate limited");
        return { result: clone(FULL), issues: [] };
      },
    });
    await vi.waitFor(() => expect(text(root)).toContain("The explanation failed: rate limited"));
    const closeFail = vi.spyOn(modal, "close").mockImplementation(() => {});
    btn(root, "Close").click();
    expect(closeFail).toHaveBeenCalled();
    btn(root, "Try again").click();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
  });

  it("ignores a slow answer that arrives after the dialog was closed or superseded", async () => {
    const d = deferred<any>();
    const { root, modal } = make({ explain: () => d.promise });
    modal.close();
    d.resolve({ result: clone(FULL), issues: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(text(root)).toBe("");
    const e = deferred<any>();
    const second = make({ explain: () => e.promise });
    second.modal.close();
    e.reject(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(text(second.root)).toBe("");
  });

  it("Cancel closes while it is still writing", async () => {
    const d = deferred<any>();
    const { root, modal } = make({ explain: () => d.promise });
    const close = vi.spyOn(modal, "close");
    btn(root, "Cancel").click();
    expect(close).toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("writes the note into the explanation folder, tells the learner, opens it in the reader and closes", async () => {
    const { root, created, leaf, modal } = make();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    const close = vi.spyOn(modal, "close");
    btn(root, "Save as note").click();
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0][0]).toBe("Chinese Learning/Generated/Explanations/方便 fāng biàn.md");
    expect(created[0][1]).toContain("cci-explain: true");
    expect(created[0][1]).toContain('cci-word: "方便|fang1 bian4"');
    expect(created[0][1]).toContain('model: "gpt-6-luna"');
    expect(created[0][1]).toContain("# 方便 (fāng biàn)");
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(lastNotice()).toBe("Saved Chinese Learning/Generated/Explanations/方便 fāng biàn.md");
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: "cci-chinese-view", state: { file: created[0][0] } });
  });

  it("leaves the note closed when the setting says so, and records the Ollama model", async () => {
    const { root, created, leaf, plugin } = make({ openAfterSave: false, provider: "ollama" });
    plugin.settings.ai.ollama.chatModel = "qwen3:8b";
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    btn(root, "Save as note").click();
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(leaf.setViewState).not.toHaveBeenCalled();
  });

  it("does not close a dialog that the learner has already moved on from while saving", async () => {
    const { root, leaf, modal } = make();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    const d = deferred<void>();
    leaf.setViewState.mockImplementationOnce(() => d.promise);
    btn(root, "Save as note").click();
    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalled());
    const close = vi.spyOn(modal, "close");
    btn(root, "Regenerate")?.click();
    modal.onClose();
    d.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says so when the note cannot be saved", async () => {
    const { root } = make({ saveFails: true });
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    btn(root, "Save as note").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Could not save the explanation: disk full"));
    expect(btn(root, "Save as note")).toBeTruthy();
  });

  it("Copy puts the Markdown on the clipboard, and says if it cannot", async () => {
    const write = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const { root } = make();
    await vi.waitFor(() => expect(btn(root, "Copy")).toBeTruthy());
    btn(root, "Copy").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Explanation copied."));
    expect(write.mock.calls[0][0]).toContain("## Examples");
    write.mockRejectedValueOnce(new Error("denied"));
    btn(root, "Copy").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Could not copy to the clipboard."));
  });
});

describe("a word that already has an explanation", () => {
  it("says so first and costs nothing until asked; Open it opens the existing note in the reader", async () => {
    const { root, plugin, leaf, modal } = make({ existing: { path: "Notes/方便 fāng biàn.md" } });
    expect(text(root)).toContain("You already have an explanation of this word: Notes/方便 fāng biàn.md");
    expect(plugin.explain.generate).not.toHaveBeenCalled();
    const close = vi.spyOn(modal, "close");
    btn(root, "Open it").click();
    await vi.waitFor(() => expect(leaf.setViewState).toHaveBeenCalledWith({ type: "cci-chinese-view", state: { file: "Notes/方便 fāng biàn.md" } }));
    expect(close).toHaveBeenCalled();
  });

  it("Write a new version generates, and saving then offers another version beside the old one", async () => {
    const { root, plugin, created } = make({ existing: { path: "Notes/方便 fāng biàn.md" } });
    btn(root, "Write a new version").click();
    await vi.waitFor(() => expect(btn(root, "Save as another version")).toBeTruthy());
    expect(plugin.explain.generate).toHaveBeenCalledTimes(1);
    expect(btn(root, "Save as note")).toBeUndefined();
    btn(root, "Save as another version").click();
    await vi.waitFor(() => expect(created).toHaveLength(1));
  });

  it("Close leaves everything alone", () => {
    const { root, modal, plugin } = make({ existing: { path: "x.md" } });
    const close = vi.spyOn(modal, "close");
    btn(root, "Close").click();
    expect(close).toHaveBeenCalled();
    expect(plugin.explain.generate).not.toHaveBeenCalled();
  });
});

describe("renderExplainBlocks", () => {
  it("draws headings, paragraphs and nested lists, numbering where asked, and groups list items", () => {
    const parent = document.createElement("div");
    renderExplainBlocks(parent, explainBlocks(FULL, META));
    expect(parent.querySelectorAll("h3.cci-explain-h1")).toHaveLength(1);
    expect(parent.querySelectorAll("h4.cci-explain-h2").length).toBeGreaterThan(4);
    expect(parent.querySelectorAll("h5.cci-explain-h3").length).toBeGreaterThan(3);
    expect(parent.querySelector(".cci-explain-num")!.textContent).toBe("1. ");
    expect(parent.querySelector("li.cci-explain-d1")).toBeTruthy();
    expect(parent.querySelector("strong")!.textContent).toBe("convenient; easy; to make things easy");
    expect(parent.querySelector("em")!.textContent).toBe("Zhèlǐ mǎi dōngxi hěn fāngbiàn.");
    // consecutive list items share one list; a heading starts a new one
    const lists = parent.querySelectorAll("ul");
    const items = parent.querySelectorAll("li");
    expect(lists.length).toBeLessThan(items.length);
  });
});
