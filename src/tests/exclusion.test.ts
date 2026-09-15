import { describe, it, expect } from "vitest";
import { computeExcludedRanges, isInExcluded, isRangeExcluded } from "../editor/markdownExclusionRanges";

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

describe("link URLs, math and HTML", () => {
  it("excludes only the URL part of a link, not its label", () => {
    // The capture-group branch of pushInline — the only caller that uses it,
    // and previously unreached because no test contained a link.
    const text = "看 [标题](http://example.com/你好) 后";
    const ranges = computeExcludedRanges(text);
    const label = text.indexOf("标题");
    const url = text.indexOf("http");
    expect(isRangeExcluded(ranges, label, label + 2)).toBe(false);
    expect(isRangeExcluded(ranges, url, url + 4)).toBe(true);
  });

  it("excludes inline and block math", () => {
    const inline = computeExcludedRanges("前 $x 你好$ 后");
    expect(isRangeExcluded(inline, 4, 6)).toBe(true);
    const block = "前\n$$\n你好\n$$\n后";
    const blockRanges = computeExcludedRanges(block);
    const inner = block.indexOf("你好");
    expect(isRangeExcluded(blockRanges, inner, inner + 2)).toBe(true);
  });

  it("excludes HTML tags but not the text between them", () => {
    const text = "<span class=\"x\">你好</span>";
    const ranges = computeExcludedRanges(text);
    const inner = text.indexOf("你好");
    expect(isRangeExcluded(ranges, 0, 5)).toBe(true);
    expect(isRangeExcluded(ranges, inner, inner + 2)).toBe(false);
  });

  it("excludes to end of text when a fence is never closed", () => {
    const text = "前\n```\n你好 forever";
    const ranges = computeExcludedRanges(text);
    const inner = text.indexOf("你好");
    expect(isRangeExcluded(ranges, inner, text.length)).toBe(true);
    expect(ranges.at(-1)?.end).toBe(text.length);
  });
});

describe("mergeRanges", () => {
  it("keeps disjoint exclusions separate", () => {
    const text = "`一` 中间 `二`";
    const ranges = computeExcludedRanges(text);
    expect(ranges).toHaveLength(2);
    const middle = text.indexOf("中间");
    expect(isRangeExcluded(ranges, middle, middle + 2)).toBe(false);
  });

  it("merges overlapping exclusions into one range", () => {
    // The HTML-tag and inline-code scanners both claim part of this text, so
    // the merge loop has to fold them rather than emit overlapping ranges.
    const text = "`<b>` 后";
    const ranges = computeExcludedRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBeGreaterThan(ranges[i - 1].end);
    }
  });

  it("returns ranges sorted and non-overlapping for a mixed document", () => {
    const text = "---\na: b\n---\n`x` 文 $y$ [t](u) <i> ```\nz\n```";
    const ranges = computeExcludedRanges(text);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBeGreaterThan(ranges[i - 1].end);
    }
  });
});

describe("isInExcluded", () => {
  it("reports single positions, treating the range end as exclusive", () => {
    const ranges = [
      { start: 2, end: 5 },
      { start: 10, end: 12 },
    ];
    expect(isInExcluded(ranges, 1)).toBe(false);
    expect(isInExcluded(ranges, 2)).toBe(true);
    expect(isInExcluded(ranges, 4)).toBe(true);
    expect(isInExcluded(ranges, 5)).toBe(false);
    expect(isInExcluded(ranges, 11)).toBe(true);
    expect(isInExcluded(ranges, 99)).toBe(false);
  });

  it("returns false for an empty range list", () => {
    expect(isInExcluded([], 0)).toBe(false);
  });
});
