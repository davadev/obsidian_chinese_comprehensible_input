import { describe, expect, it, vi } from "vitest";
import {
  BatchItem,
  batchInput,
  estimateBatchUsd,
  formatUsd,
  runBatch,
  selectBatchWords,
  statusInScope,
} from "../vocabulary/batchMnemonics";
import { charGlossesFor } from "../ai/mnemonicFacts";
import type { Token } from "../tokenizer/tokenizerTypes";

/**
 * "Generate mnemonics for this note": which words are covered, what is sent for each, and when a run gives up. The
 * rules that protect the learner: known and ignored words are never touched, a mnemonic that exists is never overwritten.
 */

const entry = (simplified: string, pinyin: string) => ({ simplified, traditional: simplified, pinyin, definitions: ["d"] });
const tok = (surface: string, start: number, pinyin = surface, isWord = true): Token => ({
  start,
  end: start + surface.length,
  surface,
  isWord,
  candidates: isWord ? [entry(surface, pinyin) as any] : [],
  selected: isWord ? (entry(surface, pinyin) as any) : undefined,
  confidence: 1,
});
const rec = (surface: string, status: string, mnemonic?: object): any => ({ key: surface, surfaces: [surface], status, mnemonic });

describe("statusInScope", () => {
  it("never includes known or ignored words", () => {
    for (const scope of ["notKnown", "marked", "unknown"] as const) {
      expect(statusInScope("known", scope)).toBe(false);
      expect(statusInScope("ignored", scope)).toBe(false);
    }
  });

  it("notKnown covers new, unknown and every partial status", () => {
    for (const s of ["new", "unknown", "meaningKnownPinyinUnknown", "pinyinKnownMeaningUnknown", "charactersUnknown"] as const) {
      expect(statusInScope(s, "notKnown")).toBe(true);
    }
  });

  it("marked leaves out words never classified, and unknown keeps only unknown", () => {
    expect(statusInScope("new", "marked")).toBe(false);
    expect(statusInScope("charactersUnknown", "marked")).toBe(true);
    expect(statusInScope("unknown", "marked")).toBe(true);
    expect(statusInScope("charactersUnknown", "unknown")).toBe(false);
    expect(statusInScope("unknown", "unknown")).toBe(true);
  });
});

describe("selectBatchWords", () => {
  const text = "我学习。你好吗？学习好。";
  const tokens = [tok("我", 0), tok("学习", 1, "xue2xi2"), tok("。", 3, "。", false), tok("你好", 4), tok("学习", 9, "xue2xi2"), tok("囧", 11, "囧", true)];
  const records: Record<string, any> = {
    我: rec("我", "known"),
    你好: rec("你好", "unknown", { text: "👋" }),
    学习: rec("学习", "pinyinKnownMeaningUnknown"),
  };
  const vocab = { bySurface: (s: string) => records[s] };

  it("lists each distinct word once, in order, with the sentence of its first occurrence", () => {
    const { items, haveMnemonic } = selectBatchWords(text, tokens, vocab, "notKnown");
    expect(items.map((i) => i.surface)).toEqual(["学习", "囧"]);
    expect(items[0]).toMatchObject({ storage: "学习", sentence: "我学习。", status: "pinyinKnownMeaningUnknown" });
    expect(items[1].status).toBe("new");
    // 你好 is in scope but already has a mnemonic: counted, never listed
    expect(haveMnemonic).toBe(1);
  });

  it("uses the first dictionary candidate when the tokenizer chose none", () => {
    const t = { ...tok("囧", 0), selected: undefined };
    expect(selectBatchWords("囧", [t], { bySurface: () => undefined }, "notKnown").items.map((i) => i.surface)).toEqual(["囧"]);
  });

  it("honours the scope", () => {
    expect(selectBatchWords(text, tokens, vocab, "marked").items.map((i) => i.surface)).toEqual(["学习"]);
    expect(selectBatchWords(text, tokens, vocab, "unknown").items).toEqual([]);
  });

  it("treats a story-only mnemonic as an existing one and skips tokens that are not words", () => {
    const v = { bySurface: (s: string) => (s === "学习" ? rec("学习", "unknown", { story: "s" }) : undefined) };
    const r = selectBatchWords("学习。", [tok("学习", 0), tok("x", 2, "x", false)], v, "notKnown");
    expect(r).toEqual({ items: [], haveMnemonic: 1 });
  });

  it("stores under the record's first-seen surface", () => {
    const v = { bySurface: () => ({ key: "k", surfaces: ["學習", "学习"], status: "unknown" }) as any };
    expect(selectBatchWords("学习", [tok("学习", 0)], v, "notKnown").items[0].storage).toBe("學習");
  });
});

describe("batchInput", () => {
  const item: BatchItem = { surface: "图书馆", storage: "图书馆", sentence: "去图书馆。", status: "new" };
  const dictEntry = { simplified: "图书馆", traditional: "圖書館", pinyin: "tú shū guǎn", pinyinTaiwan: "tú shū guǎn", definitions: ["library"], hsk: { source: "2.0", levels: ["3"] } };
  const lookup = (s: string) => (s === "图书馆" ? [dictEntry] : s === "图" ? [{ ...dictEntry, definitions: ["picture; map"] }] : []);

  it("sends the dictionary's view of a word the learner has no record of yet, with a gloss per character", () => {
    const input = batchInput(item, { lookup: lookup as any, bySurface: () => undefined, region: "mainland" });
    expect(input).toEqual({
      surface: "图书馆",
      pinyin: "tú shū guǎn",
      traditional: "圖書館",
      definitions: ["library"],
      sentence: "去图书馆。",
      hskLevels: ["3"],
      charGlosses: ["picture; map", "", ""],
    });
  });

  it("prefers the record's HSK levels and falls back to its stored fields when the dictionary lost the word", () => {
    const r: any = { traditional: "圖書館", definitions: ["lib"], pinyin: "tu shu guan", hsk: { source: "x", levels: ["2"] } };
    const input = batchInput(item, { lookup: () => [], bySurface: () => r, region: "mainland" });
    expect(input).toMatchObject({ pinyin: "tu shu guan", traditional: "圖書館", definitions: ["lib"], hskLevels: ["2"] });
    const bare = batchInput(item, { lookup: () => [], bySurface: () => undefined, region: "mainland" });
    expect(bare).toMatchObject({ definitions: [], hskLevels: [], traditional: undefined });
  });
});

describe("charGlossesFor", () => {
  it("gives a single character none", () => {
    expect(charGlossesFor("学", () => [])).toBeUndefined();
    expect(charGlossesFor("abc", () => [])).toBeUndefined();
  });
});

describe("cost estimate", () => {
  it("prices OpenAI per model and bills nothing for a local model", () => {
    expect(estimateBatchUsd(100, "ollama", "x")).toBeNull();
    const luna = estimateBatchUsd(100, "openai", "gpt-6-luna")!;
    const mini = estimateBatchUsd(100, "openai", "gpt-5.4-mini")!;
    expect(luna).toBeCloseTo(0.0135, 4);
    expect(mini).toBeGreaterThan(luna * 5);
  });

  it("words the amount without false precision", () => {
    expect(formatUsd(0.004)).toBe("under $0.01");
    expect(formatUsd(0.0135)).toBe("about $0.01");
    expect(formatUsd(1.234)).toBe("about $1.23");
  });
});

describe("runBatch", () => {
  const items = (n: number): BatchItem[] => Array.from({ length: n }, (_, i) => ({ surface: `w${i}`, storage: `w${i}`, sentence: "", status: "new" }));
  const base = { concurrency: 2, shouldStop: () => false, onProgress: () => {} };

  it("runs every item, reports progress and carries caveats", async () => {
    const progress = vi.fn();
    const { outcomes, stopped } = await runBatch(items(3), async (i) => (i.surface === "w1" ? ["careful"] : undefined), { ...base, onProgress: progress });
    expect(stopped).toBeNull();
    expect(outcomes).toHaveLength(3);
    expect(outcomes.find((o) => o.item.surface === "w1")).toMatchObject({ ok: true, caveats: ["careful"] });
    expect(outcomes.find((o) => o.item.surface === "w0")).toEqual({ item: expect.anything(), ok: true });
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls.at(-1)![0]).toBe(3);
  });

  it("a failure does not stop the others and keeps only the first line of the message", async () => {
    const { outcomes, stopped } = await runBatch(
      items(3),
      async (i) => {
        if (i.surface === "w1") throw new Error("rate limited\nretry later");
        return undefined;
      },
      base
    );
    expect(stopped).toBeNull();
    expect(outcomes.filter((o) => !o.ok)).toEqual([{ item: expect.objectContaining({ surface: "w1" }), ok: false, error: "rate limited" }]);
  });

  it("copes with a thrown value that is not an Error", async () => {
    const { outcomes } = await runBatch(items(1), async () => Promise.reject("plain"), base);
    expect(outcomes[0].error).toBe("plain");
    const empty = await runBatch(items(1), async () => Promise.reject({}), base);
    expect(empty.outcomes[0].error).toBe("[object Object]");
  });

  it("stops starting new items when asked, and keeps what finished", async () => {
    let stop = false;
    const { outcomes, stopped } = await runBatch(items(6), async () => { stop = true; return undefined; }, { ...base, concurrency: 1, shouldStop: () => stop });
    expect(stopped).toBe("user");
    expect(outcomes).toHaveLength(1);
  });

  it("gives up after five failures in a row, but a success resets the count", async () => {
    const calls: string[] = [];
    const failing = await runBatch(items(9), async (i) => { calls.push(i.surface); throw new Error("401"); }, { ...base, concurrency: 1 });
    expect(failing.stopped).toBe("failures");
    expect(failing.outcomes).toHaveLength(5);
    const flaky = await runBatch(items(9), async (i) => { if (Number(i.surface.slice(1)) % 3 !== 2) throw new Error("x"); return undefined; }, { ...base, concurrency: 1 });
    expect(flaky.stopped).toBeNull();
    expect(flaky.outcomes).toHaveLength(9);
  });

  it("always runs at least one lane", async () => {
    const { outcomes } = await runBatch(items(2), async () => undefined, { ...base, concurrency: 0 });
    expect(outcomes).toHaveLength(2);
  });
});
