// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { MnemonicModal } from "../ui/MnemonicModal";
import { MNEMONIC_LINE_MAX_GRAPHEMES } from "../vocabulary/mnemonicText";

/**
 * The mnemonic editor: read, write and generate in one place. What matters: nothing is stored until Save, a failed or
 * stale AI answer never replaces what the learner typed, the storage key stays the first-seen surface while the shown
 * form follows the script setting, and saving refreshes the open views (the store has no change notification).
 */

installObsidianDom();

const REC = (over: Record<string, unknown> = {}): any => ({
  key: "学习|xue2xi2",
  surfaces: ["學習", "学习"],
  simplified: "学习",
  traditional: "學習",
  pinyin: "xué xí",
  definitions: ["to study"],
  hsk: { source: "2.0", levels: ["2"] },
  status: "known",
  seenCount: 1,
  recentSeenAt: [],
  dailySeenCounts: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function make(opts: { rec?: any; aiEnabled?: boolean; script?: string; generate?: (i: any) => Promise<any>; dict?: any[] } = {}) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.ai.enabled = opts.aiEnabled !== false;
  settings.scriptVariant = opts.script ?? "auto";
  const plugin: any = {
    settings,
    dictionary: { lookup: vi.fn(() => opts.dict ?? []), distinctTraditionalForms: () => [] },
    vocab: { updateMnemonic: vi.fn() },
    mnemonic: { generate: vi.fn(opts.generate ?? (async () => ({ mnemonic: "📖🧠", story: "A book in the brain." }))) },
    refreshChineseViews: vi.fn(),
  };
  const modal = new MnemonicModal(new App() as any, plugin, opts.rec ?? REC(), "我每天学习中文。");
  modal.open();
  const root = modal.contentEl as HTMLElement;
  return { modal, root, plugin };
}
const line = (r: HTMLElement) => r.querySelector<HTMLInputElement>(".cci-mnemonic-line-input")!;
const story = (r: HTMLElement) => r.querySelector<HTMLTextAreaElement>(".cci-mnemonic-story-input")!;
const btn = (r: HTMLElement, text: string) => Array.from(r.querySelectorAll("button")).find((b) => b.textContent === text)!;
const counter = (r: HTMLElement) => r.querySelector<HTMLElement>(".cci-mnemonic-counter")!;
const lastNotice = () => Notice.instances.at(-1)?.message;
const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

beforeEach(() => {
  Notice.instances.length = 0;
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("what it shows", () => {
  it("the word with its pinyin from the dictionary, the stored line and story, and a counter", () => {
    const { root } = make({ rec: REC({ mnemonic: { text: "📖", story: "Study." } }), dict: [{ pinyin: "xué xí" }] });
    expect(root.querySelector("h2")!.textContent).toBe("學習 (xué xí)"); // auto: the form first read
    expect(line(root).value).toBe("📖");
    expect(story(root).value).toBe("Study.");
    expect(counter(root).textContent).toBe(`1/${MNEMONIC_LINE_MAX_GRAPHEMES}`);
  });

  it("falls back to the record's pinyin, and to the bare word when there is none", () => {
    expect(make({ rec: REC() }).root.querySelector("h2")!.textContent).toBe("學習 (xué xí)");
    document.body.innerHTML = "";
    expect(make({ rec: REC({ pinyin: undefined }) }).root.querySelector("h2")!.textContent).toBe("學習");
  });

  it("starts empty for a word with no mnemonic", () => {
    const { root } = make();
    expect(line(root).value).toBe("");
    expect(story(root).value).toBe("");
  });

  it("shows the form the script setting asks for, but stores on the first-seen surface", () => {
    const { root, plugin } = make({ rec: REC(), script: "simplified" });
    expect(root.querySelector("h2")!.textContent).toBe("学习 (xué xí)");
    line(root).value = "📖";
    btn(root, "Save").click();
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledWith("學習", expect.anything());
  });

  it("flags a line over the cap as the user types, without cutting it", () => {
    const { root } = make();
    line(root).value = "😀".repeat(MNEMONIC_LINE_MAX_GRAPHEMES + 3);
    line(root).dispatchEvent(new Event("input"));
    expect(counter(root).textContent).toBe(`${MNEMONIC_LINE_MAX_GRAPHEMES + 3}/${MNEMONIC_LINE_MAX_GRAPHEMES}`);
    expect(counter(root).classList.contains("is-over")).toBe(true);
    expect(Array.from(line(root).value).length).toBe(MNEMONIC_LINE_MAX_GRAPHEMES + 3);
    line(root).value = "😀";
    line(root).dispatchEvent(new Event("input"));
    expect(counter(root).classList.contains("is-over")).toBe(false);
  });
});

describe("saving", () => {
  it("stores the trimmed line and story, refreshes the views and closes", () => {
    const { root, plugin } = make();
    line(root).value = "  📖🧠  ";
    story(root).value = "  A book.  ";
    btn(root, "Save").click();
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledWith("學習", { text: "📖🧠", story: "A book." });
    expect(lastNotice()).toBe("Mnemonic saved.");
    expect(plugin.refreshChineseViews).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
  });

  it("cuts a line that is over the cap at save time", () => {
    const { root, plugin } = make();
    line(root).value = "😀".repeat(MNEMONIC_LINE_MAX_GRAPHEMES + 10);
    btn(root, "Save").click();
    const saved = plugin.vocab.updateMnemonic.mock.calls[0][1].text as string;
    expect(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(saved)).length).toBe(MNEMONIC_LINE_MAX_GRAPHEMES);
  });

  it("empty fields clear the mnemonic and say so", () => {
    const { root, plugin } = make({ rec: REC({ mnemonic: { text: "📖", story: "x" } }) });
    line(root).value = "";
    story(root).value = "";
    btn(root, "Save").click();
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledWith("學習", { text: undefined, story: undefined });
    expect(lastNotice()).toBe("Mnemonic cleared.");
  });

  it("a story alone is still a saved mnemonic", () => {
    const { root } = make();
    story(root).value = "Only a story.";
    btn(root, "Save").click();
    expect(lastNotice()).toBe("Mnemonic saved.");
  });

  it("Cancel stores nothing", () => {
    const { root, plugin } = make();
    line(root).value = "📖";
    btn(root, "Cancel").click();
    expect(plugin.vocab.updateMnemonic).not.toHaveBeenCalled();
    expect(plugin.refreshChineseViews).not.toHaveBeenCalled();
  });
});

describe("Generate with AI", () => {
  it("is offered only when AI is on", () => {
    expect(Array.from(make({ aiEnabled: false }).root.querySelectorAll("button")).some((b) => b.textContent === "Generate with AI")).toBe(false);
    document.body.innerHTML = "";
    expect(btn(make().root, "Generate with AI")).toBeTruthy();
  });

  it("sends the word, the sentence and what is in the fields right now, then fills them in without saving", async () => {
    const { root, plugin } = make({ dict: [{ pinyin: "xué xí", traditional: "學習", definitions: ["to study"] }] });
    line(root).value = "my edit";
    story(root).value = "my story";
    btn(root, "Generate with AI").click();
    await vi.waitFor(() => expect(line(root).value).toBe("📖🧠"));
    const input = plugin.mnemonic.generate.mock.calls[0][0];
    expect(input).toMatchObject({ surface: "學習", sentence: "我每天学习中文。", existing: "my edit", existingStory: "my story", traditional: "學習", definitions: ["to study"], hskLevels: ["2"] });
    expect(story(root).value).toBe("A book in the brain.");
    expect(counter(root).textContent).toBe(`2/${MNEMONIC_LINE_MAX_GRAPHEMES}`);
    expect(plugin.vocab.updateMnemonic).not.toHaveBeenCalled();
  });

  it("falls back to the record when the dictionary has no entry", async () => {
    const { root, plugin } = make({ rec: REC({ definitions: undefined, hsk: undefined }) });
    btn(root, "Generate with AI").click();
    await vi.waitFor(() => expect(plugin.mnemonic.generate).toHaveBeenCalled());
    expect(plugin.mnemonic.generate.mock.calls[0][0]).toMatchObject({ traditional: "學習", definitions: [], hskLevels: [] });
  });

  it("an answer without a story clears the story field", async () => {
    const { root } = make({ generate: async () => ({ mnemonic: "🍎" }) });
    story(root).value = "old";
    btn(root, "Generate with AI").click();
    await vi.waitFor(() => expect(line(root).value).toBe("🍎"));
    expect(story(root).value).toBe("");
  });

  it("shows progress, and ignores a second click while one is running", async () => {
    const d = deferred<any>();
    const { root, plugin } = make({ generate: () => d.promise });
    const gen = btn(root, "Generate with AI") as HTMLButtonElement;
    gen.click();
    expect(gen.disabled).toBe(true);
    expect(gen.textContent).toBe("Generating…");
    gen.disabled = false;
    gen.click();
    expect(plugin.mnemonic.generate).toHaveBeenCalledTimes(1);
    d.resolve({ mnemonic: "x" });
    await vi.waitFor(() => expect(gen.textContent).toBe("Generate with AI"));
    expect(gen.disabled).toBe(false);
  });

  it("a failure keeps what was typed, says why, and lets the user try again", async () => {
    const { root } = make({ generate: async () => { throw new Error("rate limited"); } });
    line(root).value = "mine";
    story(root).value = "also mine";
    btn(root, "Generate with AI").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Mnemonic failed: rate limited"));
    expect(line(root).value).toBe("mine");
    expect(story(root).value).toBe("also mine");
    expect((btn(root, "Generate with AI") as HTMLButtonElement).disabled).toBe(false);
  });

  it("an answer that arrives after the modal was closed changes nothing and raises no notice", async () => {
    const d = deferred<any>();
    const { root, modal } = make({ generate: () => d.promise });
    const input = line(root);
    btn(root, "Generate with AI").click();
    modal.close();
    d.resolve({ mnemonic: "late" });
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe("");
    expect(Notice.instances).toHaveLength(0);
  });

  it("a failure that arrives after the modal was closed raises no notice either", async () => {
    const d = deferred<any>();
    const { root, modal } = make({ generate: () => d.promise });
    btn(root, "Generate with AI").click();
    modal.close();
    d.reject(new Error("too late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(Notice.instances).toHaveLength(0);
  });
});
