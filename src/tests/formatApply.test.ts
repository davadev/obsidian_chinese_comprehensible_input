import { describe, it, expect } from "vitest";
import {
  buildFormatChanges,
  composeInline,
  conflictDisabled,
} from "../editor/formatApply";

describe("composeInline", () => {
  it("returns text unchanged with no inline format", () => {
    expect(composeInline("你好", [])).toBe("你好");
  });

  it("wraps single inline formats", () => {
    expect(composeInline("你好", ["bold"])).toBe("**你好**");
    expect(composeInline("你好", ["italic"])).toBe("*你好*");
    expect(composeInline("你好", ["highlight"])).toBe("==你好==");
    expect(composeInline("你好", ["strike"])).toBe("~~你好~~");
  });

  it("nests bold + highlight deterministically (highlight outer)", () => {
    expect(composeInline("你好", ["bold", "highlight"])).toBe("==**你好**==");
  });

  it("code short-circuits and ignores other inline formats", () => {
    expect(composeInline("你好", ["code", "bold"])).toBe("`你好`");
  });
});

describe("buildFormatChanges", () => {
  const doc = "我爱学中文。";

  it("returns no changes for an empty range", () => {
    expect(buildFormatChanges(doc, 2, 2, ["bold"])).toEqual([]);
  });

  it("returns no changes with no formats", () => {
    expect(buildFormatChanges(doc, 0, 3, [])).toEqual([]);
  });

  it("wraps an inline range", () => {
    const changes = buildFormatChanges(doc, 1, 3, ["highlight"]);
    expect(changes).toEqual([{ from: 1, to: 3, insert: "==爱学==" }]);
  });

  it("normalizes a reversed range", () => {
    const changes = buildFormatChanges(doc, 3, 1, ["bold"]);
    expect(changes).toEqual([{ from: 1, to: 3, insert: "**爱学**" }]);
  });

  it("prefixes a heading at the line start", () => {
    const changes = buildFormatChanges(doc, 1, 3, ["h2"]);
    expect(changes).toEqual([{ from: 0, to: 0, insert: "## " }]);
  });

  it("prefixes a quote on every covered line, no inline overlap", () => {
    const multi = "第一行\n第二行";
    const changes = buildFormatChanges(multi, 1, 6, ["quote"]);
    expect(changes).toEqual([
      { from: 0, to: 0, insert: "> " },
      { from: 4, to: 0 + 4, insert: "> " },
    ]);
  });

  it("does not re-add an existing prefix", () => {
    const quoted = "> 已引用";
    expect(buildFormatChanges(quoted, 2, 5, ["quote"])).toEqual([]);
  });

  it("combines inline + block without overlapping changes", () => {
    const changes = buildFormatChanges(doc, 1, 3, ["bold", "h1"]);
    // Block prefix at line start (0) precedes inline wrap (1..3); sorted, no overlap.
    expect(changes).toEqual([
      { from: 0, to: 0, insert: "# " },
      { from: 1, to: 3, insert: "**爱学**" },
    ]);
  });
});

describe("conflictDisabled", () => {
  it("does not disable an already-enabled format", () => {
    expect(conflictDisabled("bold", ["bold"])).toBe(false);
  });

  it("disables other inline formats when code is armed", () => {
    expect(conflictDisabled("bold", ["code"])).toBe(true);
    expect(conflictDisabled("highlight", ["code"])).toBe(true);
  });

  it("disables code when another inline format is armed", () => {
    expect(conflictDisabled("code", ["bold"])).toBe(true);
  });

  it("allows combining distinct inline formats", () => {
    expect(conflictDisabled("highlight", ["bold"])).toBe(false);
  });

  it("allows one block format at a time", () => {
    expect(conflictDisabled("quote", ["h1"])).toBe(true);
    expect(conflictDisabled("h2", ["quote"])).toBe(true);
  });

  it("allows inline + block together", () => {
    expect(conflictDisabled("h1", ["bold"])).toBe(false);
    expect(conflictDisabled("bold", ["h1"])).toBe(false);
  });
});
