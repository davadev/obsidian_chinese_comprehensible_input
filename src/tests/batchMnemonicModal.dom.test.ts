// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { BatchMnemonicModal } from "../ui/BatchMnemonicModal";

/**
 * The batch dialog: it says what it is about to do before it does it, saves each mnemonic as it is made so Stop or a
 * closed dialog keeps the work, never reports a failure as a success, and lets a failed set be retried on its own.
 */

installObsidianDom();

const entry = (s: string) => ({ simplified: s, traditional: s, pinyin: s === "学习" ? "xué xí" : "x", definitions: ["d"] });
const tok = (surface: string, start: number): any => ({ start, end: start + surface.length, surface, isWord: true, candidates: [entry(surface)], selected: entry(surface), confidence: 1 });
const WORDS = ["学习", "朋友", "图书馆"];
const TEXT = "我学习。你朋友。去图书馆。";
const tokensFor = (words: string[]) => words.map((w, i) => tok(w, TEXT.indexOf(w) >= 0 ? TEXT.indexOf(w) : i));

function make(
  opts: {
    provider?: string;
    scope?: string;
    words?: string[];
    records?: Record<string, any>;
    generate?: (input: any) => Promise<any>;
    tokenize?: () => Promise<any>;
    text?: string;
  } = {}
) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.ai.enabled = true;
  settings.ai.provider = opts.provider ?? "openai";
  settings.batchMnemonicScope = opts.scope ?? "notKnown";
  const records = opts.records ?? {};
  const plugin: any = {
    settings,
    tokenizer: { tokenize: vi.fn(opts.tokenize ?? (async () => tokensFor(opts.words ?? WORDS))) },
    vocab: { bySurface: (s: string) => records[s], updateMnemonic: vi.fn() },
    dictionary: { lookup: (s: string) => [entry(s)] },
    mnemonic: { generate: vi.fn(opts.generate ?? (async () => ({ mnemonic: "📖¹", story: "A scene." }))) },
    refreshChineseViews: vi.fn(),
  };
  const modal = new BatchMnemonicModal(new App() as any, plugin, opts.text ?? TEXT);
  modal.open();
  const root = modal.contentEl as HTMLElement;
  return { modal, root, plugin };
}
const btn = (r: HTMLElement, text: string | RegExp) =>
  Array.from(r.querySelectorAll("button")).find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")))!;
const text = (r: HTMLElement) => r.textContent ?? "";
const settle = () => vi.waitFor(() => expect(true).toBe(true));
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

describe("before it starts", () => {
  it("says how many words, what the estimate is, what leaves the device, and lists the words", async () => {
    const { root } = make({ records: { 朋友: { surfaces: ["朋友"], status: "unknown", mnemonic: { text: "🤝" } } } });
    await vi.waitFor(() => expect(btn(root, /^Generate 2 mnemonics$/)).toBeTruthy());
    expect(text(root)).toContain("2 words in this note have no mnemonic yet (words that are not known yet).");
    expect(text(root)).toContain("1 that already has one is left alone.");
    expect(text(root)).toMatch(/Estimated cost (under \$0\.01|about \$\d\.\d\d) on OpenAI\./);
    expect(text(root)).toContain("sent to OpenAI");
    expect(root.querySelector(".cci-batch-words div")!.textContent).toBe("学习、图书馆");
  });

  it("counts several mnemonics that are left alone in the plural", async () => {
    const have = (w: string) => ({ surfaces: [w], status: "unknown", mnemonic: { text: "x" } });
    const { root } = make({ records: { 朋友: have("朋友"), 图书馆: have("图书馆") } });
    await vi.waitFor(() => expect(text(root)).toContain("2 that already have one are left alone."));
  });

  it("is free and local on Ollama, and speaks in the singular for one word", async () => {
    const { root } = make({ provider: "ollama", words: ["学习"] });
    await vi.waitFor(() => expect(btn(root, "Generate 1 mnemonic")).toBeTruthy());
    expect(text(root)).toContain("1 word in this note has no mnemonic yet");
    expect(text(root)).toContain("Runs on your own model; nothing is billed.");
    expect(text(root)).toContain("your Ollama server");
  });

  it("says plainly when there is nothing to do", async () => {
    const none = make({ words: [] });
    await vi.waitFor(() => expect(text(none.root)).toContain("There are no words that are not known yet in this note."));
    const closeNone = vi.spyOn(none.modal, "close");
    btn(none.root, "Close").click();
    expect(closeNone).toHaveBeenCalled();
    document.body.innerHTML = "";
    const all = make({ scope: "unknown", records: Object.fromEntries(WORDS.map((w) => [w, { surfaces: [w], status: "unknown", mnemonic: { text: "x" } }])) });
    await vi.waitFor(() => expect(text(all.root)).toContain("All the words you marked unknown in this note already have a mnemonic."));
  });

  it("Cancel closes without generating anything", async () => {
    const { root, plugin, modal } = make();
    await vi.waitFor(() => expect(btn(root, "Cancel")).toBeTruthy());
    const close = vi.spyOn(modal, "close");
    btn(root, "Cancel").click();
    expect(close).toHaveBeenCalled();
    expect(plugin.mnemonic.generate).not.toHaveBeenCalled();
  });

  it("shows a readable message when the note cannot be read", async () => {
    const { root } = make({ tokenize: async () => { throw new Error("tokenizer not ready"); } });
    await vi.waitFor(() => expect(text(root)).toContain("Could not read the note: tokenizer not ready"));
    expect(btn(root, "Close")).toBeTruthy();
  });

  it("ignores a scan that finishes after the dialog was closed", async () => {
    const d = deferred<any>();
    const { modal, root } = make({ tokenize: () => d.promise });
    modal.close();
    d.resolve(tokensFor(WORDS));
    await settle();
    expect(root.querySelector("button")).toBeNull();
    const e = deferred<any>();
    const second = make({ tokenize: () => e.promise });
    second.modal.close();
    e.reject(new Error("late"));
    await settle();
    expect(text(second.root)).toBe("");
  });
});

describe("generating", () => {
  it("saves each mnemonic under its stored surface as it is made, then summarises", async () => {
    const { root, plugin, modal } = make();
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate 3/).click();
    await vi.waitFor(() => expect(text(root)).toContain("Saved 3 mnemonics."));
    expect(plugin.mnemonic.generate).toHaveBeenCalledTimes(3);
    const close = vi.spyOn(modal, "close");
    btn(root, "Close").click();
    expect(close).toHaveBeenCalled();
    expect(plugin.mnemonic.generate.mock.calls[0][0]).toMatchObject({ surface: "学习", sentence: "我学习。", pinyin: "xué xí" });
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledTimes(3);
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledWith("学习", { text: "📖¹", story: "A scene." });
    expect(plugin.refreshChineseViews).toHaveBeenCalledTimes(1);
    expect(Notice.instances.at(-1)!.message).toBe("Saved 3 mnemonics.");
  });

  it("runs one at a time on Ollama and keeps an empty story out of the record", async () => {
    let running = 0;
    let most = 0;
    const { root, plugin } = make({
      provider: "ollama",
      generate: async () => {
        running++;
        most = Math.max(most, running);
        await Promise.resolve();
        running--;
        return { mnemonic: "🍎" };
      },
    });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(text(root)).toContain("Saved 3 mnemonics."));
    expect(most).toBe(1);
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledWith("学习", { text: "🍎", story: undefined });
  });

  it("shows progress while it works and Stop keeps what is done", async () => {
    const gate = deferred<any>();
    let calls = 0;
    const { root, plugin } = make({
      provider: "ollama",
      generate: async () => {
        calls++;
        if (calls === 1) return { mnemonic: "🍎" };
        return gate.promise;
      },
    });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(text(root)).toContain("1 / 3 — 学习"));
    expect(root.querySelector("progress")!.value).toBe(1);
    const stop = btn(root, "Stop");
    stop.click();
    expect(stop.textContent).toBe("Stopping…");
    expect(stop.disabled).toBe(true);
    gate.resolve({ mnemonic: "🍐" });
    await vi.waitFor(() => expect(text(root)).toContain("Stopped; 1 not started."));
    expect(text(root)).toContain("Saved 2 mnemonics.");
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledTimes(2);
  });

  it("lists failures, never counts them as saved, and retries only those", async () => {
    let attempt = 0;
    const { root, plugin } = make({
      generate: async (input) => {
        if (input.surface === "朋友" && attempt++ === 0) throw new Error("rate limited\nmore");
        return { mnemonic: "🍎" };
      },
    });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(text(root)).toContain("Saved 2 mnemonics."));
    expect(text(root)).toContain("1 failed:");
    expect(text(root)).toContain("朋友 — rate limited");
    btn(root, "Retry the failed ones").click();
    await vi.waitFor(() => expect(text(root)).toContain("Saved 1 mnemonic."));
    expect(plugin.mnemonic.generate).toHaveBeenCalledTimes(4);
    expect(text(root)).not.toContain("failed:");
    expect(btn(root, "Retry the failed ones")).toBeUndefined();
  });

  it("gives up after a run of failures and says to check the provider, and caps a long failure list", async () => {
    const words = Array.from({ length: 14 }, (_, i) => `词${i}`);
    const { root } = make({ provider: "ollama", words, text: words.join("。"), generate: async () => { throw new Error("401"); } });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(text(root)).toContain("Stopped after several failures in a row (9 not started)."));
    expect(text(root)).toContain("5 failed:");
    expect(text(root)).not.toContain("Saved");
    const many = make({ provider: "openai", words, text: words.join("。"), generate: async (i) => { if (Number(i.surface.slice(1)) % 5 !== 4) throw new Error("x"); return { mnemonic: "🍎" }; } });
    await vi.waitFor(() => expect(btn(many.root, /^Generate/)).toBeTruthy());
    btn(many.root, /^Generate/).click();
    await vi.waitFor(() => expect(text(many.root)).toContain("failed:"));
    expect(text(many.root)).toMatch(/…and \d+ more/);
  });

  it("treats an answer that is empty after cleaning as a failure, and saves a story without a line", async () => {
    const { root, plugin } = make({
      generate: async (i) => (i.surface === "学习" ? { mnemonic: "" } : i.surface === "朋友" ? { mnemonic: "", story: "only a story" } : { mnemonic: "🏛️" }),
    });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(text(root)).toContain("学习 — The AI returned nothing usable."));
    expect(text(root)).toContain("Saved 2 mnemonics.");
    expect(plugin.vocab.updateMnemonic).toHaveBeenCalledWith("朋友", { text: undefined, story: "only a story" });
    expect(plugin.vocab.updateMnemonic).not.toHaveBeenCalledWith("学习", expect.anything());
  });

  it("points out mnemonics saved with a caveat so they can be checked", async () => {
    const { root } = make({ generate: async (i) => (i.surface === "图书馆" ? { mnemonic: "🏛️", notes: ["x"] } : { mnemonic: "🍎" }) });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(text(root)).toContain("Saved with a caveat — worth a look: 图书馆"));
  });

  it("a closed dialog stops the run and shows nothing late", async () => {
    const gate = deferred<any>();
    const { root, modal, plugin } = make({ provider: "ollama", generate: () => gate.promise });
    await vi.waitFor(() => expect(btn(root, /^Generate/)).toBeTruthy());
    btn(root, /^Generate/).click();
    await vi.waitFor(() => expect(plugin.mnemonic.generate).toHaveBeenCalled());
    modal.close();
    gate.resolve({ mnemonic: "🍎" });
    await settle();
    await vi.waitFor(() => expect(plugin.refreshChineseViews).toHaveBeenCalled());
    expect(text(root)).toBe("");
    expect(plugin.mnemonic.generate).toHaveBeenCalledTimes(1);
  });
});
