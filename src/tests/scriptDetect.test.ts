import { describe, it, expect } from "vitest";
import { countTraditionalMarkers, looksTraditional } from "../dictionary/scriptDetect";

// Stand-in for the dictionary: characters written only in Traditional.
// Deliberately excludes 台, 只, 后, 里 — they are simplified headwords in
// their own right and appear constantly in Taiwan writing, so they are not
// evidence of anything.
const TRADITIONAL_ONLY = new Set([
  "灣", "氣", "熱", "圖", "書", "館", "學", "習", "網", "軟", "體", "來", "個", "們", "說", "為",
]);
const dict = { isTraditionalMarker: (ch: string) => TRADITIONAL_ONLY.has(ch) };

describe("countTraditionalMarkers", () => {
  it("counts distinct markers, not occurrences", () => {
    expect(countTraditionalMarkers("學學學", dict)).toBe(1);
    expect(countTraditionalMarkers("學習", dict)).toBe(2);
  });

  it("returns 0 for simplified text", () => {
    expect(countTraditionalMarkers("台湾的天气很热", dict)).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(countTraditionalMarkers("", dict)).toBe(0);
  });
});

describe("looksTraditional", () => {
  it.each([
    "台灣的天氣很熱",
    "我昨天去圖書館學習中文",
    "網路上的影片很有趣，我用軟體看",
  ])("fires on traditional text: %s", (text) => {
    expect(looksTraditional(text, dict)).toBe(true);
  });

  it.each([
    "台湾的天气很热",
    "我昨天去图书馆学习中文",
    "这个星期我很忙，因为要准备考试",
    // The adversarial cases: every character here is a simplified headword,
    // so a symmetric detector would wrongly call some of these traditional.
    "你好我是人今天",
    "台北只有后面那家",
  ])("never fires on simplified text: %s", (text) => {
    expect(looksTraditional(text, dict)).toBe(false);
  });

  it("does not fire on an incidental traditional quotation", () => {
    // Two markers is below the threshold on purpose.
    expect(looksTraditional("学习中文 and 學習 both fine", dict)).toBe(false);
  });

  it("ignores non-Chinese text", () => {
    expect(looksTraditional("hello world 123", dict)).toBe(false);
  });
});
