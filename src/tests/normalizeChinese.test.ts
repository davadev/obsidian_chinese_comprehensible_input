import { describe, it, expect } from "vitest";
import {
  makeKey,
  numbersToToneMarks,
  toneMarksToNumbers,
  findCjkSpans,
  hasCjk,
  isCjkChar,
  shortenDefinition,
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
