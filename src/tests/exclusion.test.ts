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
});
