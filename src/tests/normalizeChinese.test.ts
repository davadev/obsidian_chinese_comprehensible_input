import { describe, it, expect } from "vitest";
import {
  makeKey,
  numbersToToneMarks,
  toneMarksToNumbers,
  findCjkSpans,
  hasCjk,
  isCjkChar,
  shortenDefinition,
  repairPinyin,
} from "../dictionary/normalizeChinese";

describe("makeKey", () => {
  it("returns just the surface when no pinyin", () => {
    expect(makeKey("好")).toBe("好");
  });

  it("formats canonical key with simplified|numbered-pinyin from tone marks", () => {
    expect(makeKey("好", "hǎo")).toBe("好|hao3");
  });

  it("includes a pipe separator before the pinyin segment", () => {
    expect(makeKey("好", "hǎo")).toContain("|");
  });

  it("is stable across calls", () => {
    expect(makeKey("苹果", "píng guǒ")).toBe(makeKey("苹果", "píng guǒ"));
  });
});

describe("numbersToToneMarks", () => {
  it("converts numbered pinyin to tone marks", () => {
    expect(numbersToToneMarks("ni3 hao3")).toBe("nǐ hǎo");
  });

  it("leaves neutral tone (5) untouched in the syllable", () => {
    // tone 5 is documented as no-tone; the function leaves the syllable as
    // its base letters.
    expect(numbersToToneMarks("de5")).toBe("de");
  });

  it("places the mark on the priority vowel (a > o > e > i > u)", () => {
    // mai3 → mǎi: mark goes on 'a', not 'i'
    expect(numbersToToneMarks("mai3")).toBe("mǎi");
    // hou4 → hòu: mark goes on 'o'
    expect(numbersToToneMarks("hou4")).toBe("hòu");
  });

  it("round-trips through toneMarksToNumbers", () => {
    const numbered = "ni3 hao3 ma5";
    const marks = numbersToToneMarks(numbered);
    expect(toneMarksToNumbers(marks)).toBe(numbered);
  });
});

describe("CJK detection", () => {
  it("isCjkChar recognises ideographs", () => {
    expect(isCjkChar("好")).toBe(true);
    expect(isCjkChar("苹")).toBe(true);
    expect(isCjkChar("a")).toBe(false);
    expect(isCjkChar(" ")).toBe(false);
  });

  it("hasCjk is true iff any CJK char is present", () => {
    expect(hasCjk("hello")).toBe(false);
    expect(hasCjk("Hello 世界")).toBe(true);
  });

  it("hasCjk is stable across repeated calls", () => {
    expect(hasCjk("世界")).toBe(true);
    expect(hasCjk("世界")).toBe(true);
    expect(hasCjk("hello")).toBe(false);
    expect(hasCjk("你好")).toBe(true);
  });

  it("findCjkSpans returns contiguous CJK runs with offsets", () => {
    const spans = findCjkSpans("Hello 世界 foo 朋友!");
    expect(spans.length).toBe(2);
    expect(spans[0].text).toBe("世界");
    expect(spans[1].text).toBe("朋友");
    expect(spans[0].start).toBe(6);
    expect(spans[0].end).toBe(8);
  });
});

describe("shortenDefinition", () => {
  it("returns input unchanged when within limit", () => {
    expect(shortenDefinition("short", 40)).toBe("short");
  });

  it("truncates with ellipsis when over limit", () => {
    const out = shortenDefinition("x".repeat(100), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("tone mark placement", () => {
  // The -iu/-ui rule: an a/o/e always takes the mark, otherwise it goes on
  // the LAST vowel. The old a>o>e>i>u ranking produced jǐu / lìu / qíu for
  // every -iu final, which is core HSK 1-3 vocabulary.
  it.each([
    ["jiu3", "jiǔ"],
    ["liu4", "liù"],
    ["qiu2", "qiú"],
    ["niu2", "niú"],
    ["diu1", "diū"],
    ["xiu1", "xiū"],
  ])("marks the last vowel of -iu: %s -> %s", (input, want) => {
    expect(numbersToToneMarks(input)).toBe(want);
  });

  it.each([
    ["hui4", "huì"],
    ["gui1", "guī"],
    ["shui3", "shuǐ"],
  ])("keeps -ui correct: %s -> %s", (input, want) => {
    expect(numbersToToneMarks(input)).toBe(want);
  });

  it.each([
    ["hao3", "hǎo"],
    ["xue2", "xué"],
    ["zhuang4", "zhuàng"],
    ["ni3 hao3", "nǐ hǎo"],
  ])("leaves a/o/e syllables unchanged: %s -> %s", (input, want) => {
    expect(numbersToToneMarks(input)).toBe(want);
  });
});

describe("numbersToToneMarks — u: handling", () => {
  // CC-CEDICT writes ü as "u:". The conversion has to happen before the
  // syllable regex, whose character class has no ":" in it. Doing it
  // afterwards stranded the digit and produced the literal "nü3" / "lü4"
  // that every dictionary built so far contains.
  it.each([
    ["nu:3", "nǚ"],
    ["lu:4", "lǜ"],
    ["nu:3 er2", "nǚ ér"],
    ["lu:4 se4", "lǜ sè"],
  ])("converts u: to a tone-marked ü: %s -> %s", (input, want) => {
    expect(numbersToToneMarks(input)).toBe(want);
  });

  it("leaves no bare tone digits behind", () => {
    expect(numbersToToneMarks("nu:3")).not.toMatch(/[1-5]/);
  });
});

describe("numbersToToneMarks — case and non-pinyin", () => {
  it("preserves capitalisation of proper nouns", () => {
    expect(numbersToToneMarks("Ya3")).toBe("Yǎ");
    expect(numbersToToneMarks("Zhong1 guo2")).toBe("Zhōng guó");
  });

  it("leaves standalone numerals alone", () => {
    expect(numbersToToneMarks("11 Qu1")).toBe("11 Qū");
  });

  it("handles the unspaced bracket form CC-CEDICT uses for Taiwan readings", () => {
    expect(numbersToToneMarks("xia4hai2")).toBe("xiàhái");
  });

  it("passes neutral tone through without a mark", () => {
    expect(numbersToToneMarks("de5")).toBe("de");
  });
});

describe("repairPinyin", () => {
  it.each([
    ["jǐu", "jiǔ"],
    ["lìu", "liù"],
    ["níu nǎi", "niú nǎi"],
    ["xīu xi", "xiū xi"],
    ["qīu tiān", "qiū tiān"],
  ])("moves a misplaced -iu tone mark: %s -> %s", (input, want) => {
    expect(repairPinyin(input)).toBe(want);
  });

  it.each([
    ["nü3", "nǚ"],
    ["lü4", "lǜ"],
    ["yī lü4", "yī lǜ"],
  ])("converts a stranded tone digit on a ü syllable: %s -> %s", (input, want) => {
    expect(repairPinyin(input)).toBe(want);
  });

  it.each(["hǎo", "xué", "huì", "nǐ hǎo", "Zhōng guó", "de"])(
    "leaves already-correct pinyin untouched: %s",
    (input) => {
      expect(repairPinyin(input)).toBe(input);
    }
  );

  it("preserves case and literal numerals", () => {
    expect(repairPinyin("11 Qū")).toBe("11 Qū");
    expect(repairPinyin("Shuāng 11")).toBe("Shuāng 11");
  });

  it("is idempotent", () => {
    const once = repairPinyin("jǐu nü3 lìu");
    expect(repairPinyin(once)).toBe(once);
  });

  // The invariant the whole release rests on: repairing the stored pinyin
  // must not move any makeKey()-derived vocabulary key, or every existing
  // WordRecord for these ~4,800 words would be orphaned.
  it.each(["jǐu", "lìu", "níu nǎi", "nü3", "lü4", "xīu xi", "Ya3", "11 Qū", "hǎo"])(
    "does not move the vocabulary key for %s",
    (input) => {
      expect(toneMarksToNumbers(repairPinyin(input))).toBe(toneMarksToNumbers(input));
    }
  );

  it("keeps makeKey stable for a repaired entry", () => {
    expect(makeKey("女", "nü3")).toBe(makeKey("女", "nǚ"));
    expect(makeKey("九", "jǐu")).toBe(makeKey("九", "jiǔ"));
  });
});

describe("toneMarksToNumbers — legacy numbered input", () => {
  it("absorbs a trailing digit as the syllable tone", () => {
    expect(toneMarksToNumbers("nü3")).toBe("nü3");
    expect(toneMarksToNumbers("nǚ")).toBe("nü3");
  });

  it("does not swallow standalone numerals", () => {
    expect(toneMarksToNumbers("11 Qū")).toBe("11 qu1");
  });

  it("still emits neutral tone 5 where there is no digit", () => {
    expect(toneMarksToNumbers("de")).toBe("de5");
  });
});
