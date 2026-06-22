import { describe, it, expect } from "vitest";
import {
  buildFormatChanges,
  buildUnformatChanges,
  composeInline,
  conflictDisabled,
} from "../editor/formatApply";

/** Apply a change list to a doc the way CodeMirror would (descending order). */
function applyChanges(doc: string, changes: { from: number; to: number; insert: string }[]): string {
  let out = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

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

  it("wraps a colored highlight outermost using hlWrap", () => {
    const wrap = { open: '<mark style="background:#FFB8EBA6;">', close: "</mark>" };
    expect(composeInline("你好", ["hl:pink", "bold"], wrap)).toBe(
      '<mark style="background:#FFB8EBA6;">**你好**</mark>'
    );
  });

  it("plain highlight ignores hlWrap and uses ==", () => {
    expect(composeInline("你好", ["highlight"])).toBe("==你好==");
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

describe("buildUnformatChanges", () => {
  it("strips highlight wrapping when inner words are tapped", () => {
    // doc: 我==爱学==中  — tap 爱(idx3) start, 学 end (idx5); == sit outside.
    const doc = "我==爱学==中";
    // 我=0, ==1-2, 爱=3, 学=4, ==5-6, 中=7
    const changes = buildUnformatChanges(doc, 3, 5);
    expect(applyChanges(doc, changes)).toBe("我爱学中");
  });

  it("strips nested bold+highlight", () => {
    const doc = "==**爱学**==";
    const changes = buildUnformatChanges(doc, 4, 6);
    expect(applyChanges(doc, changes)).toBe("爱学");
  });

  it("removes a heading prefix", () => {
    const doc = "## 标题";
    const changes = buildUnformatChanges(doc, 3, 5);
    expect(applyChanges(doc, changes)).toBe("标题");
  });

  it("removes a quote prefix", () => {
    const doc = "> 引用";
    const changes = buildUnformatChanges(doc, 2, 4);
    expect(applyChanges(doc, changes)).toBe("引用");
  });

  it("returns no changes for unformatted text", () => {
    expect(buildUnformatChanges("纯文本", 0, 3)).toEqual([]);
  });

  it("strips a colored <mark> highlight", () => {
    const doc = '<mark style="background:#FFB8EBA6;">你好</mark>';
    const inner = doc.indexOf("你好");
    const changes = buildUnformatChanges(doc, inner, inner + 2);
    expect(applyChanges(doc, changes)).toBe("你好");
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

  it("allows only one highlight variant at a time", () => {
    expect(conflictDisabled("hl:pink", ["highlight"])).toBe(true);
    expect(conflictDisabled("highlight", ["hl:pink"])).toBe(true);
    expect(conflictDisabled("hl:red", ["hl:pink"])).toBe(true);
  });

  it("treats colored highlight as inline (combinable with bold, exclusive with code)", () => {
    expect(conflictDisabled("hl:pink", ["bold"])).toBe(false);
    expect(conflictDisabled("hl:pink", ["code"])).toBe(true);
    expect(conflictDisabled("code", ["hl:pink"])).toBe(true);
  });

  it("allows inline + block together", () => {
    expect(conflictDisabled("h1", ["bold"])).toBe(false);
    expect(conflictDisabled("bold", ["h1"])).toBe(false);
  });
});
