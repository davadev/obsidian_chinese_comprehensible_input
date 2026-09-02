import { describe, it, expect } from "vitest";
import { extractTaiwanReading } from "../dictionary/taiwanReading";

describe("extractTaiwanReading", () => {
  it("reads the spaced bracket form", () => {
    expect(extractTaiwanReading(["trash", "Taiwan pr. [le4 se4]"])).toBe("lè sè");
  });

  it("reads the unspaced bracket form", () => {
    // CC-CEDICT is inconsistent: 下颏 stores "[xia4hai2]" with no space.
    expect(extractTaiwanReading(["chin", "Taiwan pr. [xia4hai2]"])).toBe("xià hái");
  });

  it("preserves capitalisation of proper nouns", () => {
    expect(extractTaiwanReading(["Asia", "Taiwan pr. [Ya3]"])).toBe("Yǎ");
  });

  it("finds the gloss wherever it sits in the definition list", () => {
    expect(
      extractTaiwanReading(["pleasant to hear", "to one's liking", "Taiwan pr. [zhong4 ting1]"])
    ).toBe("zhòng tīng");
  });

  it("returns undefined when there is no Taiwan gloss", () => {
    expect(extractTaiwanReading(["good", "well", "OK"])).toBeUndefined();
  });

  it("ignores 'also pr.', which is not regional", () => {
    expect(extractTaiwanReading(["to know", "also pr. [zhi1dao5]"])).toBeUndefined();
  });

  it("skips a prose Taiwan note that carries no bracketed reading", () => {
    // 夹 — the one entry in the shipped dictionary shaped like this.
    expect(
      extractTaiwanReading(["Taiwan pr. used in 夾生|夹生[jia1 sheng1] and 夾竹桃|夹竹桃[jia1 zhu2 tao2]"])
    ).toBeUndefined();
  });

  it("leaves no bare tone digits in the result", () => {
    expect(extractTaiwanReading(["trash", "Taiwan pr. [le4 se4]"])).not.toMatch(/[1-5]/);
  });

  it("handles an empty definition list", () => {
    expect(extractTaiwanReading([])).toBeUndefined();
  });

  it("survives a malformed entry from a hand-edited dictionary file", () => {
    // The vault dictionary is user-supplied and the loader only validates
    // `simplified` and `pinyin`, so this must never throw during load.
    expect(extractTaiwanReading(undefined)).toBeUndefined();
    expect(extractTaiwanReading(null as unknown as string[])).toBeUndefined();
    expect(extractTaiwanReading([null, undefined, 42] as unknown as string[])).toBeUndefined();
    expect(extractTaiwanReading(["ok", null] as unknown as string[])).toBeUndefined();
  });
});
