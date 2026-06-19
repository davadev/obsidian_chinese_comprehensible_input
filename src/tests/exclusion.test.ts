import { describe, it, expect } from "vitest";
import { computeExcludedRanges, isRangeExcluded } from "../editor/markdownExclusionRanges";

describe("markdown exclusion ranges", () => {
  it("excludes frontmatter", () => {
    const text = "---\ntitle: foo\n---\n你好";
    const ranges = computeExcludedRanges(text);
    expect(isRangeExcluded(ranges, 4, 8)).toBe(true);
    expect(isRangeExcluded(ranges, text.indexOf("你"), text.indexOf("你") + 2)).toBe(false);
  });

  it("excludes fenced code", () => {
    const text = "Hi\n```\n你好 inside\n```\n你好 outside";
    const ranges = computeExcludedRanges(text);
    const insideStart = text.indexOf("你好 inside");
    const outsideStart = text.indexOf("你好 outside");
    expect(isRangeExcluded(ranges, insideStart, insideStart + 2)).toBe(true);
    expect(isRangeExcluded(ranges, outsideStart, outsideStart + 2)).toBe(false);
  });

  it("excludes inline code", () => {
    const text = "正常 `代码 inside` 后";
    const ranges = computeExcludedRanges(text);
    const codeStart = text.indexOf("代码");
    expect(isRangeExcluded(ranges, codeStart, codeStart + 2)).toBe(true);
  });

  it("does NOT exclude image embeds — they own their replace decoration", () => {
    // Regression guard for 0.3.7: previously `![[...]]` ranges were added
    // to the exclusion set, which caused scanEmbeds to skip its own
    // matches and the embed never rendered as an image.
    const text = "前 ![[Pasted image 20260617210039.png]] 后";
    const ranges = computeExcludedRanges(text);
    const embedStart = text.indexOf("![[");
    const embedEnd = text.indexOf("]]") + 2;
    expect(isRangeExcluded(ranges, embedStart, embedEnd)).toBe(false);
  });
});
