// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { PhraseModal, PhraseSelection } from "../ui/PhraseModal";
import { estimatePhraseUsd } from "../ai/phraseCost";
import type { Measured } from "../ai/simplify";

/**
 * The dialog behind the lightbulb tool: it is the confirm step (nothing is sent before the button), checks an explanation
 * is for correct text, shows proof reading corrections with Apply that writes into the note only where the text is still
 * what was shown, and never saves without a press.
 */

installObsidianDom();

const TEXT = "我昨天去了商店。";
const WORDS = [
  { text: "我", pinyin: "wǒ", role: "subject", meaning: "I" },
  { text: "昨天", pinyin: "zuó tiān", role: "time word", meaning: "yesterday" },
  { text: "去", pinyin: "qù", role: "verb", meaning: "go" },
  { text: "了", pinyin: "le", role: "aspect particle", meaning: "completed" },
  { text: "商店", pinyin: "shāng diàn", role: "place", meaning: "shop" },
];
const EXPLAINED = {
  translation: "I went to the shop yesterday.",
  expresses: "Says what happened.",
  register: "neutral",
  structure: "S + Time + 去 + 了 + Place",
  breakdown: WORDS,
  grammarPoints: [{ point: "了", explanation: "Completed action.", example: "" }],
  typo: "",
  notes: [],
};
const meas = (text: string, over: Partial<Measured> = {}): Measured => ({ text, words: [], cost: 10, hardest: 5, unknown: 3, chars: Array.from(text).length, ...over });
const NOTHING = { original: meas(TEXT), ranked: [], best: null };
const PLAIN = { ...meas("我昨天去商店。", { cost: 3, hardest: 1, unknown: 1 }), change: "Drops 了." };
const MIDDLE = { ...meas("昨天我去了商店。", { cost: 6, hardest: 2, unknown: 2 }), change: "" };
const SIMPLER = { original: meas(TEXT), ranked: [PLAIN, MIDDLE], best: PLAIN };
const USAGE = { ts: 1, provider: "openai", model: "gpt-6-luna", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 2000 };

function make(
  opts: {
    provider?: string;
    action?: "explain" | "proofread" | "simplify";
    check?: object | Error;
    explain?: object | Error;
    proof?: object | Error;
    simplify?: object | Error;
    issues?: string[];
    sel?: Partial<PhraseSelection>;
    replace?: boolean;
    usage?: boolean;
    saveFails?: boolean;
  } = {}
) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.ai.enabled = true;
  settings.ai.provider = opts.provider ?? "openai";
  const listeners = new Set<(e: any) => void>();
  const emit = () => opts.usage && listeners.forEach((l) => l(USAGE));
  const resolve = <T,>(v: T | Error | undefined, fallback: T) => {
    if (v instanceof Error) throw v;
    return v ?? fallback;
  };
  const created: Array<[string, string]> = [];
  const app: any = new App();
  app.vault = {
    getAbstractFileByPath: (p: string) => (created.some(([c]) => c === p) ? {} : null),
    createFolder: vi.fn(async () => {}),
    create: vi.fn(async (p: string, c: string) => {
      if (opts.saveFails) throw new Error("disk full");
      created.push([p, c]);
      return { path: p };
    }),
  };
  const leaf = { setViewState: vi.fn(async () => {}) };
  app.workspace = { getLeaf: vi.fn(() => leaf) };
  const view = { replaceRange: vi.fn(() => opts.replace ?? true) };
  const plugin: any = {
    settings,
    onAiUsage: (cb: (e: any) => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    phraseExplain: {
      check: vi.fn(async () => (emit(), resolve(opts.check, { verdict: "ok", note: "", original: "", suggestion: "" }))),
      explain: vi.fn(async () => (emit(), { result: resolve(opts.explain, EXPLAINED), issues: opts.issues ?? [] })),
    },
    proofread: {
      proofread: vi.fn(async () => (emit(), { result: resolve(opts.proof, { corrections: [] }), issues: opts.issues ?? [] })),
    },
    simplify: {
      simplify: vi.fn(async () => (emit(), { ...(resolve(opts.simplify, NOTHING) as object), issues: opts.issues ?? [] })),
    },
  };
  const sel: PhraseSelection = { text: TEXT, raw: TEXT, from: 100, to: 100 + TEXT.length, view: view as any, hasMarkup: false, ...opts.sel };
  const modal = new PhraseModal(app, plugin, sel, opts.action ?? "explain");
  modal.open();
  return { modal, root: modal.contentEl as HTMLElement, plugin, view, created, leaf };
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

describe("the confirm step", () => {
  it("shows the text, its length against the limit, the likely cost and where it goes, and sends nothing yet", () => {
    const { root, plugin } = make();
    expect(root.querySelector("h2")!.textContent).toBe("Explain this text");
    expect(root.querySelector("blockquote")!.textContent).toBe(TEXT);
    expect(text(root)).toContain(`${Array.from(TEXT).length} of 150 characters.`);
    expect(text(root)).toMatch(/Estimated cost (under \$0\.01|about \$\d\.\d\d) on OpenAI\./);
    expect(text(root)).toContain("sent to OpenAI");
    expect(plugin.phraseExplain.check).not.toHaveBeenCalled();
    expect(plugin.proofread.proofread).not.toHaveBeenCalled();
  });

  it("names the action, and says nothing about cost for a local model", () => {
    const { root } = make({ provider: "ollama", action: "proofread" });
    expect(root.querySelector("h2")!.textContent).toBe("Proof read this text");
    expect(btn(root, "Proof read")).toBeTruthy();
    expect(text(root)).not.toContain("Estimated cost");
    expect(text(root)).toContain("your Ollama server");
  });

  it("Cancel closes without sending anything", () => {
    const { root, modal, plugin } = make();
    const close = vi.spyOn(modal, "close");
    btn(root, "Cancel").click();
    expect(close).toHaveBeenCalled();
    expect(plugin.phraseExplain.check).not.toHaveBeenCalled();
  });
});

describe("estimatePhraseUsd", () => {
  it("grows with the text, and explaining (two calls) costs more than proof reading (one)", () => {
    const short = estimatePhraseUsd("explain", 10, "gpt-6-luna");
    const long = estimatePhraseUsd("explain", 150, "gpt-6-luna");
    expect(long).toBeGreaterThan(short);
    expect(estimatePhraseUsd("proofread", 150, "gpt-6-luna")).toBeLessThan(long);
    expect(estimatePhraseUsd("explain", 150, "gpt-5.4-mini")).toBeGreaterThan(long * 5);
    expect(long).toBeLessThan(0.01);
  });
});

describe("explaining", () => {
  it("checks the text, explains it, and shows the note: nothing is saved until Save", async () => {
    const { root, plugin, created, modal } = make();
    btn(root, "Explain").click();
    expect(text(root)).toContain("Writing the explanation…");
    expect(root.querySelector("progress")).toBeTruthy();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    expect(plugin.phraseExplain.check).toHaveBeenCalledWith(TEXT);
    expect(plugin.phraseExplain.explain).toHaveBeenCalledWith(TEXT, undefined);
    expect(root.querySelector("h2")!.textContent).toBe("Phrase explained");
    expect(text(root)).toContain("I went to the shop yesterday.");
    expect(text(root)).toContain("Word by word");
    expect(root.querySelector(".cci-explain-caveat")).toBeNull();
    expect(created).toHaveLength(0);
    const close = vi.spyOn(modal, "close").mockImplementation(() => {});
    btn(root, "Close").click();
    expect(close).toHaveBeenCalled();
  });

  it("passes a typo the check found to the explanation, with or without a note", async () => {
    const a = make({ check: { verdict: "typo", note: "obvious", original: "昨夭", suggestion: "昨天" } });
    btn(a.root, "Explain").click();
    await vi.waitFor(() => expect(a.plugin.phraseExplain.explain).toHaveBeenCalled());
    expect(a.plugin.phraseExplain.explain).toHaveBeenCalledWith(TEXT, "昨夭 should be 昨天 (obvious)");
    document.body.innerHTML = "";
    const b = make({ check: { verdict: "typo", note: "", original: "夭", suggestion: "天" } });
    btn(b.root, "Explain").click();
    await vi.waitFor(() => expect(b.plugin.phraseExplain.explain).toHaveBeenCalled());
    expect(b.plugin.phraseExplain.explain).toHaveBeenCalledWith(TEXT, "夭 should be 天");
  });

  it("says what the plugin could not verify, and shows the OpenAI cost from the real usage", async () => {
    const { root } = make({ issues: ["The list misses 了."], usage: true });
    btn(root, "Explain").click();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    expect(text(root)).toContain("even after asking again: The list misses 了.");
    // two requests (check + explanation), each 1000 in and 2000 out at luna prices
    expect(text(root)).toContain("Cost on OpenAI: $0.0022 (2 requests).");
  });

  it("when the check says the text is wrong it does not explain: it says why and offers to proof read instead", async () => {
    const { root, plugin } = make({ check: { verdict: "wrong", note: "了 cannot go there.", original: "", suggestion: "" }, proof: { corrections: [] } });
    btn(root, "Explain").click();
    await vi.waitFor(() => expect(text(root)).toContain("This text may contain a mistake"));
    expect(text(root)).toContain("了 cannot go there.");
    expect(plugin.phraseExplain.explain).not.toHaveBeenCalled();
    btn(root, "Proof read this instead").click();
    await vi.waitFor(() => expect(text(root)).toContain("No mistakes found."));
    expect(plugin.proofread.proofread).toHaveBeenCalledWith(TEXT);
  });

  it("gives a reason of its own when the check was wrong without saying why", async () => {
    const { root } = make({ check: { verdict: "wrong", note: "", original: "", suggestion: "" } });
    btn(root, "Explain").click();
    await vi.waitFor(() => expect(text(root)).toContain("The grammar looks broken"));
    btn(root, "Close").click();
  });

  it("records the Ollama model in the saved note, and ignores a check that answers after the dialog was closed", async () => {
    const m = make({ provider: "ollama" });
    m.plugin.settings.ai.ollama.chatModel = "qwen3:8b";
    btn(m.root, "Explain").click();
    await vi.waitFor(() => expect(btn(m.root, "Save as note")).toBeTruthy());
    btn(m.root, "Save as note").click();
    await vi.waitFor(() => expect(m.created).toHaveLength(1));
    expect(m.created[0][1]).toContain('provider: "ollama"');
    expect(m.created[0][1]).toContain('model: "qwen3:8b"');
    const d = deferred<any>();
    const late = make();
    late.plugin.phraseExplain.check = vi.fn(() => d.promise);
    btn(late.root, "Explain").click();
    late.modal.close();
    d.resolve({ verdict: "wrong", note: "x", original: "", suggestion: "" });
    await new Promise((r) => setTimeout(r, 0));
    expect(text(late.root)).toBe("");
  });

  it("Save as note writes <start of the text> <date>.md into the explanations folder, tells the learner, opens it and closes", async () => {
    const { root, created, leaf, modal } = make();
    btn(root, "Explain").click();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    const close = vi.spyOn(modal, "close");
    btn(root, "Save as note").click();
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0][0]).toMatch(/^Chinese Learning\/Generated\/Explanations\/我昨天去了商店。 \d{4}-\d{2}-\d{2}\.md$/);
    expect(created[0][1]).toContain("cci-explain-phrase: true");
    expect(created[0][1]).toContain(`cci-phrase: "${TEXT}"`);
    expect(created[0][1]).toContain("# Phrase explained");
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(lastNotice()).toContain("Saved Chinese Learning/Generated/Explanations/");
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: "cci-chinese-view", state: { file: created[0][0] } });
  });

  it("keeps the dialog open when saving fails", async () => {
    const { root, modal } = make({ saveFails: true });
    btn(root, "Explain").click();
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
    const close = vi.spyOn(modal, "close");
    btn(root, "Save as note").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Could not save the explanation: disk full"));
    expect(close).not.toHaveBeenCalled();
  });

  it("Copy puts the Markdown on the clipboard; Regenerate asks again", async () => {
    const write = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const { root, plugin } = make();
    btn(root, "Explain").click();
    await vi.waitFor(() => expect(btn(root, "Copy")).toBeTruthy());
    btn(root, "Copy").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Explanation copied."));
    expect(write.mock.calls[0][0]).toContain("## Word by word");
    btn(root, "Regenerate").click();
    await vi.waitFor(() => expect(plugin.phraseExplain.check).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(btn(root, "Save as note")).toBeTruthy());
  });

  it("shows a failure with Try again and Close, and ignores a late answer after the dialog was closed", async () => {
    let n = 0;
    const m = make();
    m.plugin.phraseExplain.check = vi.fn(async () => {
      if (n++ === 0) throw new Error("rate limited");
      return { verdict: "ok", note: "", original: "", suggestion: "" };
    });
    btn(m.root, "Explain").click();
    await vi.waitFor(() => expect(text(m.root)).toContain("That failed: rate limited"));
    const close = vi.spyOn(m.modal, "close").mockImplementation(() => {});
    btn(m.root, "Close").click();
    expect(close).toHaveBeenCalled();
    btn(m.root, "Try again").click();
    await vi.waitFor(() => expect(btn(m.root, "Save as note")).toBeTruthy());

    const d = deferred<any>();
    const late = make();
    late.plugin.phraseExplain.check = vi.fn(() => d.promise);
    btn(late.root, "Explain").click();
    late.modal.close();
    d.resolve({ verdict: "ok", note: "", original: "", suggestion: "" });
    await new Promise((r) => setTimeout(r, 0));
    expect(text(late.root)).toBe("");
    const e = deferred<any>();
    const lateFail = make();
    lateFail.plugin.phraseExplain.check = vi.fn(() => e.promise);
    btn(lateFail.root, "Explain").click();
    lateFail.modal.close();
    e.reject(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(text(lateFail.root)).toBe("");
  });

  it("Cancel closes while it is still working", () => {
    const m = make();
    m.plugin.phraseExplain.check = vi.fn(() => new Promise(() => {}));
    btn(m.root, "Explain").click();
    const close = vi.spyOn(m.modal, "close");
    btn(m.root, "Cancel").click();
    expect(close).toHaveBeenCalled();
  });

  it("stops the progress clock when the screen changes or the dialog closes", async () => {
    vi.useFakeTimers();
    try {
      const m = make();
      m.plugin.phraseExplain.check = vi.fn(() => new Promise(() => {}));
      btn(m.root, "Explain").click();
      expect(vi.getTimerCount()).toBe(1);
      m.modal.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("proof reading", () => {
  const two = { corrections: [{ original: "了", replacement: "", why: "Not needed here." }, { original: "昨天", replacement: "今天", why: "Wrong day." }] };

  it("says so, kindly, when there is nothing to fix", async () => {
    const { root, plugin } = make({ action: "proofread", proof: { corrections: [] } });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(text(root)).toContain("No mistakes found."));
    expect(text(root)).toContain("Only real mistakes are flagged, not style.");
    expect(plugin.proofread.proofread).toHaveBeenCalledWith(TEXT);
    expect(btn(root, "Apply all")).toBeUndefined();
    expect(btn(root, "Copy corrected text")).toBeUndefined();
  });

  it("lists each correction as wrong -> right with the reason, in the order of the text, and a delete as '(delete)'", async () => {
    const { root } = make({ action: "proofread", proof: two });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(root.querySelectorAll(".cci-proof-item")).toHaveLength(2));
    const items = Array.from(root.querySelectorAll(".cci-proof-item")).map((i) => i.textContent);
    expect(items[0]).toContain("❌ 昨天 → ✅ 今天");
    expect(items[0]).toContain("Wrong day.");
    expect(items[1]).toContain("❌ 了 → ✅ (delete)");
  });

  it("Apply replaces that text in the note at its position, then shows Applied", async () => {
    const { root, view } = make({ action: "proofread", proof: two });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(root.querySelectorAll(".cci-proof-item")).toHaveLength(2));
    (root.querySelectorAll(".cci-proof-item button")[0] as HTMLButtonElement).click();
    // 昨天 starts at index 1 of the selection, which starts at 100 in the note
    expect(view.replaceRange).toHaveBeenCalledWith(101, 103, "昨天", "今天");
    const first = root.querySelectorAll(".cci-proof-item button")[0] as HTMLButtonElement;
    expect(first.textContent).toBe("Applied ✓");
    expect(first.disabled).toBe(true);
  });

  it("Apply all applies every correction, each at its position moved by the ones already applied before it", async () => {
    const three = { corrections: [{ original: "我", replacement: "我们", why: "Plural." }, { original: "了", replacement: "", why: "x" }, { original: "商店", replacement: "超市", why: "y" }] };
    const { root, view } = make({ action: "proofread", proof: three });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(btn(root, "Apply all")).toBeTruthy());
    btn(root, "Apply all").click();
    // text order: 我 at 0 (+1 char), 了 at 4 (delete, -1), 商店 at 5; positions are in the note (from 100)
    expect(view.replaceRange.mock.calls).toEqual([
      [100, 101, "我", "我们"],
      [105, 106, "了", ""],
      [105, 107, "商店", "超市"],
    ]);
    expect((btn(root, "Apply all") as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelectorAll(".cci-proof-item button")[0].textContent).toBe("Applied ✓");
  });

  it("does not mark a correction applied when the note refused it (it changed since the selection)", async () => {
    const { root, view } = make({ action: "proofread", proof: two, replace: false });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(root.querySelectorAll(".cci-proof-item")).toHaveLength(2));
    (root.querySelectorAll(".cci-proof-item button")[0] as HTMLButtonElement).click();
    expect(view.replaceRange).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll(".cci-proof-item button")[0].textContent).toBe("Apply");
  });

  it("cannot apply without the reader, or when the text in the note is no longer what was shown", async () => {
    const noView = make({ action: "proofread", proof: two, sel: { view: null } });
    btn(noView.root, "Proof read").click();
    await vi.waitFor(() => expect(noView.root.querySelectorAll(".cci-proof-item")).toHaveLength(2));
    for (const b of Array.from(noView.root.querySelectorAll(".cci-proof-item button")) as HTMLButtonElement[]) {
      expect(b.disabled).toBe(true);
      expect(b.title).toContain("copy the corrected text instead");
    }
    expect((btn(noView.root, "Apply all") as HTMLButtonElement).disabled).toBe(true);
  });

  it("with markup in the note it finds a span by searching for it in the note's own text", async () => {
    const { root, view } = make({
      action: "proofread",
      proof: { corrections: [{ original: "去了", replacement: "去", why: "a" }, { original: "昨天", replacement: "今天", why: "b" }] },
      sel: { text: "我昨天去了商店。", raw: "我**昨天**去了商店。", hasMarkup: true },
    });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(root.querySelectorAll(".cci-proof-item")).toHaveLength(2));
    const buttons = Array.from(root.querySelectorAll(".cci-proof-item button")) as HTMLButtonElement[];
    // 昨天 is in the note wrapped in ** **, so it is found there; 去了 is plain
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
    buttons[1].click();
    // in the note 去了 starts at index 7 ("我**昨天**" is 7 characters)
    expect(view.replaceRange).toHaveBeenCalledWith(107, 109, "去了", "去");
  });

  it("says so when the text to replace can no longer be found in the note", async () => {
    const m = make({ action: "proofread", proof: { corrections: [{ original: "昨天", replacement: "今天", why: "b" }] }, sel: { text: "我昨天去了商店。", raw: "我**昨**天去了商店。", hasMarkup: true } });
    btn(m.root, "Proof read").click();
    await vi.waitFor(() => expect(m.root.querySelectorAll(".cci-proof-item")).toHaveLength(1));
    const apply = m.root.querySelector(".cci-proof-item button") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    apply.disabled = false;
    apply.click();
    expect(lastNotice()).toBe("Could not find that text in the note any more. Select it again.");
    expect(m.view.replaceRange).not.toHaveBeenCalled();
  });

  it("Apply all skips a correction that cannot be applied and applies the rest; a forced click without the reader does nothing", async () => {
    const m = make({
      action: "proofread",
      proof: { corrections: [{ original: "昨天", replacement: "今天", why: "a" }, { original: "去了", replacement: "去", why: "b" }] },
      sel: { text: "我昨天去了商店。", raw: "我**昨**天去了商店。", hasMarkup: true },
    });
    btn(m.root, "Proof read").click();
    await vi.waitFor(() => expect(btn(m.root, "Apply all")).toBeTruthy());
    btn(m.root, "Apply all").click();
    expect(m.view.replaceRange).toHaveBeenCalledTimes(1);
    expect(m.view.replaceRange).toHaveBeenCalledWith(107, 109, "去了", "去");
    document.body.innerHTML = "";
    const noView = make({ action: "proofread", proof: { corrections: [{ original: "昨天", replacement: "今天", why: "a" }] }, sel: { view: null } });
    btn(noView.root, "Proof read").click();
    await vi.waitFor(() => expect(noView.root.querySelector(".cci-proof-item button")).toBeTruthy());
    const apply = noView.root.querySelector(".cci-proof-item button") as HTMLButtonElement;
    apply.disabled = false;
    apply.click();
    expect(Notice.instances).toHaveLength(0);
    expect(apply.textContent).toBe("Apply");
  });

  it("Copy corrected text puts the whole corrected selection on the clipboard", async () => {
    const write = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const { root } = make({ action: "proofread", proof: two });
    btn(root, "Proof read").click();
    await vi.waitFor(() => expect(btn(root, "Copy corrected text")).toBeTruthy());
    btn(root, "Copy corrected text").click();
    await vi.waitFor(() => expect(lastNotice()).toBe("Corrected text copied."));
    expect(write.mock.calls[0][0]).toBe("我今天去商店。");
  });

  it("says what the plugin could not verify, shows the cost, and reports a failure with Try again", async () => {
    const a = make({ action: "proofread", proof: two, issues: ["Overlap."], usage: true });
    btn(a.root, "Proof read").click();
    await vi.waitFor(() => expect(text(a.root)).toContain("even after asking again: Overlap."));
    expect(text(a.root)).toContain("Cost on OpenAI: $0.0011 (1 request).");
    btn(a.root, "Close").click();
    document.body.innerHTML = "";
    let n = 0;
    const b = make({ action: "proofread" });
    b.plugin.proofread.proofread = vi.fn(async () => {
      if (n++ === 0) throw new Error("boom");
      return { result: { corrections: [] }, issues: [] };
    });
    btn(b.root, "Proof read").click();
    await vi.waitFor(() => expect(text(b.root)).toContain("That failed: boom"));
    btn(b.root, "Try again").click();
    await vi.waitFor(() => expect(text(b.root)).toContain("No mistakes found."));
  });

  it("ignores an answer that arrives after the dialog was closed", async () => {
    const d = deferred<any>();
    const m = make({ action: "proofread" });
    m.plugin.proofread.proofread = vi.fn(() => d.promise);
    btn(m.root, "Proof read").click();
    m.modal.close();
    d.resolve({ result: { corrections: [] }, issues: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(text(m.root)).toBe("");
  });
});

describe("simplifying", () => {
  it("is the confirm step first: the text, the likely cost, and nothing sent", () => {
    const { root, plugin } = make({ action: "simplify" });
    expect(root.querySelector("h2")!.textContent).toBe("Simplify this text");
    expect(text(root)).toMatch(/Estimated cost (under \$0\.01|about \$\d\.\d\d) on OpenAI\./);
    expect(plugin.simplify.simplify).not.toHaveBeenCalled();
  });

  it("shows the simplest rewrite with the measured gain and what it changes, the others folded away, and writes nothing yet", async () => {
    const { root, plugin, view } = make({ action: "simplify", simplify: SIMPLER });
    btn(root, "Simplify").click();
    expect(text(root)).toContain("Finding simpler ways to say it…");
    await vi.waitFor(() => expect(root.querySelector("h2")!.textContent).toBe("A simpler way to say it"));
    expect(plugin.simplify.simplify).toHaveBeenCalledWith(TEXT);
    const quotes = Array.from(root.querySelectorAll("blockquote")).map((q) => q.textContent);
    expect(quotes).toEqual([TEXT, "我昨天去商店。", "昨天我去了商店。"]);
    expect(text(root)).toContain("Words you don't know yet: 3 → 1 · Hardest of them: HSK 5 → HSK 1");
    expect(text(root)).toContain("What changes: Drops 了.");
    expect(root.querySelector("details summary")!.textContent).toBe("Other ways to say it (1)");
    expect(view.replaceRange).not.toHaveBeenCalled();
  });

  it("Apply replaces the whole selection, then marks it applied and leaves the other rewrites unusable", async () => {
    const { root, view } = make({ action: "simplify", simplify: SIMPLER });
    btn(root, "Simplify").click();
    await vi.waitFor(() => expect(btn(root, "Apply")).toBeTruthy());
    const applies = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".cci-proof-item button")).filter((b) => b.textContent !== "Copy");
    expect(applies().map((b) => b.disabled)).toEqual([false, false]);
    applies()[0].click();
    expect(view.replaceRange).toHaveBeenCalledWith(100, 100 + TEXT.length, TEXT, "我昨天去商店。");
    expect(applies().map((b) => [b.textContent, b.disabled])).toEqual([["Applied ✓", true], ["Apply", true]]);
  });

  it("applying another rewrite after a change in the note is refused by the reader and nothing is marked applied", async () => {
    const { root, view } = make({ action: "simplify", simplify: SIMPLER, replace: false });
    btn(root, "Simplify").click();
    await vi.waitFor(() => expect(btn(root, "Apply")).toBeTruthy());
    btn(root, "Apply").click();
    expect(view.replaceRange).toHaveBeenCalled();
    expect(btn(root, "Apply").textContent).toBe("Apply");
    expect(btn(root, "Apply").disabled).toBe(false);
  });

  it("cannot apply without the reader, or when the selection had formatting a replacement would lose; Copy still works", async () => {
    const write = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    for (const sel of [{ view: null }, { hasMarkup: true }]) {
      document.body.innerHTML = "";
      const { root } = make({ action: "simplify", simplify: SIMPLER, sel });
      btn(root, "Simplify").click();
      await vi.waitFor(() => expect(btn(root, "Apply")).toBeTruthy());
      const apply = btn(root, "Apply") as HTMLButtonElement;
      expect(apply.disabled).toBe(true);
      expect(!!apply.title).toBe("hasMarkup" in sel);
      apply.click();
      (root.querySelector(".cci-proof-item button:last-of-type") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(lastNotice()).toBe("Simpler text copied."));
    }
    expect(write.mock.calls.at(-1)![0]).toBe("我昨天去商店。");
  });

  it("when the rewrite is the same text as the note there is nothing to apply", async () => {
    const same = { original: meas(TEXT), ranked: [{ ...PLAIN, text: TEXT }], best: { ...PLAIN, text: TEXT } };
    const { root } = make({ action: "simplify", simplify: same });
    btn(root, "Simplify").click();
    await vi.waitFor(() => expect(btn(root, "Apply")).toBeTruthy());
    expect((btn(root, "Apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the text is already simple when nothing was found, or when no rewrite beats the original, and lists what was tried", async () => {
    const a = make({ action: "simplify", simplify: NOTHING });
    btn(a.root, "Simplify").click();
    await vi.waitFor(() => expect(a.root.querySelector("h2")!.textContent).toBe("Already about as simple as it gets"));
    expect(text(a.root)).toContain("No simpler way to say this was found.");
    expect(a.root.querySelector("details")).toBeNull();
    expect(a.root.querySelector(".cci-proof-item")).toBeNull();
    document.body.innerHTML = "";
    const b = make({ action: "simplify", simplify: { original: meas(TEXT, { cost: 1 }), ranked: [MIDDLE], best: null } });
    btn(b.root, "Simplify").click();
    await vi.waitFor(() => expect(text(b.root)).toContain("None of the rewrites uses easier words than the original."));
    expect(b.root.querySelector("details summary")!.textContent).toBe("The rewrites that were tried (1)");
  });

  it("shows what the plugin could not verify and the cost, regenerates, and reports a failure with Try again", async () => {
    const a = make({ action: "simplify", simplify: SIMPLER, issues: ["One was unusable."], usage: true });
    btn(a.root, "Simplify").click();
    await vi.waitFor(() => expect(text(a.root)).toContain("even after asking again: One was unusable."));
    expect(text(a.root)).toContain("Cost on OpenAI: $0.0011 (1 request).");
    btn(a.root, "Regenerate").click();
    await vi.waitFor(() => expect(a.plugin.simplify.simplify).toHaveBeenCalledTimes(2));
    btn(a.root, "Close").click();
    document.body.innerHTML = "";
    let n = 0;
    const b = make({ action: "simplify" });
    b.plugin.simplify.simplify = vi.fn(async () => {
      if (n++ === 0) throw new Error("boom");
      return { ...NOTHING, issues: [] };
    });
    btn(b.root, "Simplify").click();
    await vi.waitFor(() => expect(text(b.root)).toContain("That failed: boom"));
    btn(b.root, "Try again").click();
    await vi.waitFor(() => expect(text(b.root)).toContain("Already about as simple as it gets"));
  });

  it("ignores an answer that arrives after the dialog was closed", async () => {
    const d = deferred<any>();
    const m = make({ action: "simplify" });
    m.plugin.simplify.simplify = vi.fn(() => d.promise);
    btn(m.root, "Simplify").click();
    m.modal.close();
    d.resolve({ ...NOTHING, issues: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(text(m.root)).toBe("");
  });
});
