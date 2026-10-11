import { describe, it, expect } from "vitest";
import {
  bigramDiversity,
  cjkLength,
  levelProfile,
  mean,
  meanPairwiseSimilarity,
  paragraphs,
  pct,
  segment,
  similarity,
  simplifiedSlips,
  targetCounts,
} from "../../scripts/lib/storyMetrics.mjs";

/** The measurements behind the model comparison: they decide what the numbers mean, so they are pinned. */

const HSK = { 学习: 1, 图书馆: 3, 我: 1, 去: 1, 效率: 5, 趋势: 6 };

describe("segment", () => {
  it("takes the longest HSK word, and leaves everything else as single off-list characters", () => {
    expect(segment("我去图书馆", HSK)).toEqual([
      { word: "我", level: 1 },
      { word: "去", level: 1 },
      { word: "图书馆", level: 3 },
    ]);
    expect(segment("我吃饭", HSK).map((s) => [s.word, s.level])).toEqual([["我", 1], ["吃", 0], ["饭", 0]]);
  });

  it("ignores non-Chinese characters and does not trip on prototype names", () => {
    expect(segment("ok, 我 constructor!", HSK).map((s) => s.word)).toEqual(["我"]);
  });
});

describe("levelProfile", () => {
  it("splits the characters into at/below target, one above, too hard (>1 above) and off-list", () => {
    // target HSK3: 我(1) 学习(1) -> at/below, 效率(5) -> too hard (5 > 3+1), 吃 -> off list
    const p = levelProfile("我学习效率吃", HSK, 3);
    expect(p.chars).toBe(6);
    expect(p.atOrBelow).toBeCloseTo(3 / 6);
    expect(p.tooHard).toBeCloseTo(2 / 6);
    expect(p.offList).toBeCloseTo(1 / 6);
    expect(p.tooHardWords).toEqual(["效率"]);
  });

  it("counts a word exactly one level above separately from too hard", () => {
    const p = levelProfile("效率", { 效率: 4 }, 3);
    expect(p.aboveByOne).toBe(1);
    expect(p.tooHard).toBe(0);
  });

  it("is all zeros for text with no Chinese", () => {
    expect(levelProfile("hello", HSK, 3)).toMatchObject({ chars: 0, tooHard: 0, tooHardWords: [] });
  });
});

describe("shape", () => {
  it("counts paragraphs by blank lines, ignoring empty ones", () => {
    expect(paragraphs("一\n\n二\n\n\n三")).toBe(3);
    expect(paragraphs("一\n二")).toBe(1);
    expect(paragraphs("\n\n")).toBe(0);
  });

  it("counts only CJK characters", () => {
    expect(cjkLength("你好, world 123 再见")).toBe(4);
  });

  it("counts every occurrence of a target, so one use and several differ", () => {
    expect(targetCounts("我学习，你也学习", ["学习", "游泳", ""])).toEqual([
      { word: "学习", count: 2 },
      { word: "游泳", count: 0 },
      { word: "", count: 0 },
    ]);
  });

  it("flags common simplified-only characters in a Traditional story", () => {
    expect(simplifiedSlips("我們這個學校")).toBe(0);
    expect(simplifiedSlips("我们这个")).toBe(3);
  });
});

describe("repetitiveness", () => {
  it("bigram diversity falls as text repeats itself", () => {
    expect(bigramDiversity("一")).toBe(0);
    expect(bigramDiversity("春夏秋冬")).toBe(1);
    expect(bigramDiversity("好好好好好")).toBeLessThan(0.5);
  });

  it("similarity is 1 for identical text, 0 for none shared, and 0 when a side has no bigrams", () => {
    expect(similarity("春夏秋冬", "春夏秋冬")).toBe(1);
    expect(similarity("春夏秋冬", "山水花鸟")).toBe(0);
    expect(similarity("春", "春夏")).toBe(0);
  });

  it("mean pairwise similarity is high for a model that repeats itself, and 0 with fewer than two texts", () => {
    expect(meanPairwiseSimilarity(["春夏秋冬", "春夏秋冬", "春夏秋冬"])).toBe(1);
    expect(meanPairwiseSimilarity(["春夏秋冬"])).toBe(0);
    expect(meanPairwiseSimilarity([])).toBe(0);
  });
});

describe("formatting helpers", () => {
  it("mean of nothing is 0 and pct is one decimal", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(pct(0.1234)).toBe("12.3%");
  });
});
