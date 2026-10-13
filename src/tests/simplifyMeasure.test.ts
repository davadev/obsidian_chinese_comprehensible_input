import { describe, expect, it } from "vitest";
import { measureText } from "../ai/simplifyMeasure";
import { UNRATED_LEVEL } from "../ai/simplify";

/** Measuring a sentence (#238): dictionary words only, HSK level from the entry, known from the learner's vocabulary. */

const entry = (levels?: string[]) => ({ simplified: "x", traditional: "x", pinyin: "x", definitions: [], ...(levels ? { hsk: { source: "2.0", levels } } : {}) });
const tok = (surface: string, over: Record<string, unknown> = {}) => ({
  start: 0,
  end: 0,
  surface,
  isWord: true,
  candidates: [entry(["3"])],
  confidence: 1,
  ...over,
});

describe("measureText", () => {
  it("measures dictionary words only, with HSK level and the learner's status", async () => {
    const m = await measureText("我喜欢咖啡，", {
      tokenize: async () =>
        [
          tok("我", { candidates: [entry(["1"])] }),
          tok("喜欢", { candidates: [entry(["2", "3"])] }),
          tok("咖啡", { candidates: [entry()] }),
          tok("，", { isWord: false, candidates: [] }),
          tok("嗯", { candidates: [] }),
        ] as any,
      statusOf: (s) => ({ 我: "known", 喜欢: "unknown", 咖啡: "ignored" }[s] as any),
    });
    expect(m.words).toEqual([
      { surface: "我", level: 1, known: true },
      { surface: "喜欢", level: 3, known: false },
      { surface: "咖啡", level: UNRATED_LEVEL, known: true },
    ]);
    expect(m).toMatchObject({ text: "我喜欢咖啡，", cost: 3, hardest: 3, unknown: 1 });
  });

  it("prefers the entry the tokenizer selected, and treats a word the learner never met as unknown", async () => {
    const m = await measureText("行", {
      tokenize: async () => [tok("行", { candidates: [entry(["6"])], selected: entry(["2"]) })] as any,
      statusOf: () => undefined,
    });
    expect(m.words).toEqual([{ surface: "行", level: 2, known: false }]);
  });

  it("an empty sentence measures as nothing", async () => {
    expect(await measureText("", { tokenize: async () => [], statusOf: () => undefined })).toMatchObject({ words: [], cost: 0, chars: 0 });
  });
});
