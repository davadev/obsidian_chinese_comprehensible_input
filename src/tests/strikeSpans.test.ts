import { describe, expect, it } from "vitest";
import { findLooseStrikeSpans } from "../editor/strikeSpans";

const texts = (doc: string, parsed: Array<{ from: number; to: number }> = []) =>
  findLooseStrikeSpans(doc, parsed).map((s) => doc.slice(s.contentFrom, s.contentTo));

describe("findLooseStrikeSpans", () => {
  it("finds ~~text~~ and the spaced forms Obsidian strikes through", () => {
    expect(texts("~~test~~")).toEqual(["test"]);
    expect(texts("~~test ~~")).toEqual(["test "]);
    expect(texts("~~ test~~")).toEqual([" test"]);
    expect(texts("~~ test ~~")).toEqual([" test "]);
  });

  it("reports the delimiter and content positions", () => {
    expect(findLooseStrikeSpans("a ~~b ~~ c")).toEqual([{ openFrom: 2, contentFrom: 4, contentTo: 6, closeTo: 8 }]);
  });

  it("finds several on a line and across lines, but never across a line break", () => {
    expect(texts("~~一 ~~ 和 ~~ 二~~\n~~三 ~~")).toEqual(["一 ", " 二", "三 "]);
    expect(texts("~~一\n二~~")).toEqual([]);
  });

  it("needs something to strike: empty or blank content is not a span", () => {
    expect(texts("~~~~")).toEqual([]);
    expect(texts("~~  ~~")).toEqual([]);
  });

  it("content cannot contain ~", () => {
    expect(texts("~~a~b~~")).toEqual([]);
  });

  it("skips what the grammar already parsed, and keeps the rest", () => {
    const doc = "~~ok~~ and ~~spaced ~~";
    expect(texts(doc, [{ from: 0, to: 6 }])).toEqual(["spaced "]);
    expect(texts(doc, [{ from: 11, to: 22 }])).toEqual(["ok"]);
  });

  it("finds nothing in text without ~~", () => {
    expect(texts("plain text, ~ one tilde")).toEqual([]);
  });
});
