import { describe, it, expect } from "vitest";
import { counterpartSurface, displayPinyin, displaySurface } from "../dictionary/displayForms";

const unambiguous = { distinctTraditionalForms: () => 1 };
const ambiguous = { distinctTraditionalForms: () => 2 };

describe("displayPinyin", () => {
  it("uses the Mainland reading by default", () => {
    expect(displayPinyin({ pinyin: "lā jī", pinyinTaiwan: "lè sè" }, undefined, "mainland")).toBe("lā jī");
  });

  it("uses the Taiwan reading when the region asks for it", () => {
    expect(displayPinyin({ pinyin: "lā jī", pinyinTaiwan: "lè sè" }, undefined, "taiwan")).toBe("lè sè");
  });

  it("falls back to the Mainland reading when no Taiwan one is recorded", () => {
    // True of all but ~500 of the 125k entries.
    expect(displayPinyin({ pinyin: "xué xí" }, undefined, "taiwan")).toBe("xué xí");
  });

  it("prefers the live entry over a stale record snapshot", () => {
    // A WordRecord's pinyin predates the tone repair, so it can still say
    // "jǐu" where the dictionary now says "jiǔ".
    expect(displayPinyin({ pinyin: "jiǔ" }, { pinyin: "jǐu" }, "mainland")).toBe("jiǔ");
  });

  it("falls back to the record when there is no entry", () => {
    expect(displayPinyin(undefined, { pinyin: "hǎo" }, "mainland")).toBe("hǎo");
  });

  it("returns an empty string when neither has pinyin", () => {
    expect(displayPinyin(undefined, undefined, "taiwan")).toBe("");
  });
});

describe("displaySurface", () => {
  const met = { surfaces: ["學習", "学习"], simplified: "学习", traditional: "學習" };
  const simplifiedOnly = { surfaces: ["学习"], simplified: "学习", traditional: "學習" };

  it("shows the simplified form in simplified mode", () => {
    expect(displaySurface(met, "simplified", unambiguous)).toBe("学习");
  });

  it("shows the traditional form the learner has actually met", () => {
    expect(displaySurface(met, "traditional", unambiguous)).toBe("學習");
  });

  it("offers the traditional form when the mapping is unambiguous", () => {
    expect(displaySurface(simplifiedOnly, "traditional", unambiguous)).toBe("學習");
  });

  it("does NOT convert when the mapping is ambiguous", () => {
    // 发 is 發 (emit) or 髮 (hair). Guessing teaches the wrong character.
    const ambiguousWord = { surfaces: ["头发"], simplified: "头发", traditional: "頭發" };
    expect(displaySurface(ambiguousWord, "traditional", ambiguous)).toBe("头发");
  });

  it("does not convert when no dictionary is supplied to vet the mapping", () => {
    expect(displaySurface(simplifiedOnly, "traditional")).toBe("学习");
  });

  it("returns the encountered surface for a word with no dictionary entry", () => {
    const oov = { surfaces: ["大安區"] };
    expect(displaySurface(oov, "traditional", unambiguous)).toBe("大安區");
    expect(displaySurface(oov, "simplified", unambiguous)).toBe("大安區");
  });

  it("handles a word written the same in both scripts", () => {
    const same = { surfaces: ["中文"], simplified: "中文", traditional: "中文" };
    expect(displaySurface(same, "traditional", unambiguous)).toBe("中文");
    expect(displaySurface(same, "simplified", unambiguous)).toBe("中文");
  });

  it("returns an empty string for an empty record", () => {
    expect(displaySurface({}, "traditional", unambiguous)).toBe("");
  });
});

describe("counterpartSurface", () => {
  const entry = {
    simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["to study"],
  };

  it("shows the simplified form beside a traditional headword", () => {
    expect(counterpartSurface(entry, "學習", "traditional", unambiguous))
      .toEqual({ label: "Simplified", value: "学习" });
  });

  it("shows the traditional form beside a simplified headword", () => {
    expect(counterpartSurface(entry, "学习", "simplified", unambiguous))
      .toEqual({ label: "Traditional", value: "學習" });
  });

  it("shows nothing when the mapping is ambiguous", () => {
    expect(counterpartSurface(entry, "学习", "simplified", ambiguous)).toBeUndefined();
  });

  it("shows nothing when both scripts write the word the same way", () => {
    const same = { simplified: "中文", traditional: "中文", pinyin: "zhōng wén", definitions: [] };
    expect(counterpartSurface(same, "中文", "simplified", unambiguous)).toBeUndefined();
    expect(counterpartSurface(same, "中文", "traditional", unambiguous)).toBeUndefined();
  });

  it("shows nothing without an entry", () => {
    expect(counterpartSurface(undefined, "学习", "simplified", unambiguous)).toBeUndefined();
  });
});
