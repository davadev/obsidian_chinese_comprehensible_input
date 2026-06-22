import { describe, it, expect } from "vitest";
import {
  applyChangesToString,
  buildFormatChanges,
  buildRemoveFormatChanges,
  buildSetFormatChanges,
  buildUnformatChanges,
  composeInline,
  conflictDisabled,
  formattingPlainText,
  formattingPreservesContent,
} from "../editor/formatApply";

/** Apply a change list to a doc the way CodeMirror composes it. */
const applyChanges = applyChangesToString;

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

  it("colored <mark> highlight leaves a wikilink/embed bare so it stays linkable", () => {
    const wrap = { open: '<mark style="background:#BBFABBA6;">', close: "</mark>" };
    expect(composeInline("前 [[note]] 后", ["hl:green"], wrap)).toBe(
      '<mark style="background:#BBFABBA6;">前 </mark>[[note]]<mark style="background:#BBFABBA6;"> 后</mark>'
    );
    // No `<mark>` wraps the link syntax itself.
    expect(composeInline("![[img.png]]", ["hl:green"], wrap)).toBe("![[img.png]]");
  });

  it("== highlight and bold leave a link whole (Obsidian parses links inside them)", () => {
    expect(composeInline("前[[note]]后", ["highlight"])).toBe("==前[[note]]后==");
    expect(composeInline("前[[note]]后", ["bold"])).toBe("**前[[note]]后**");
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

describe("buildSetFormatChanges (exact mode)", () => {
  it("keeps H3, drops the highlight", () => {
    const doc = "### ==标题==";
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildSetFormatChanges(doc, inner, inner + 2, ["h3"]));
    expect(out).toBe("### 标题");
  });

  it("drops H3, keeps the highlight", () => {
    const doc = "### ==标题==";
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildSetFormatChanges(doc, inner, inner + 2, ["highlight"]));
    expect(out).toBe("==标题==");
  });

  it("replaces highlight with bold over highlighted text", () => {
    const doc = "==字==";
    const out = applyChanges(doc, buildSetFormatChanges(doc, 2, 3, ["bold"]));
    expect(out).toBe("**字**");
  });

  it("empty formats clears everything", () => {
    const doc = "### ==字==";
    const inner = doc.indexOf("字");
    const out = applyChanges(doc, buildSetFormatChanges(doc, inner, inner + 1, []));
    expect(out).toBe("字");
  });
});

describe("buildFormatChanges (add mode)", () => {
  it("adds a highlight over a heading, keeping the heading", () => {
    const doc = "### 标题";
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildFormatChanges(doc, inner, inner + 2, ["highlight"]));
    expect(out).toBe("### ==标题==");
  });

  it("replaces the heading level instead of stacking prefixes", () => {
    const doc = "# 标题";
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildFormatChanges(doc, inner, inner + 2, ["h2"]));
    expect(out).toBe("## 标题");
  });

  it("leaves an existing heading untouched when no block is checked", () => {
    const doc = "## 标题";
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildFormatChanges(doc, inner, inner + 2, ["bold"]));
    expect(out).toBe("## **标题**");
  });
});

describe("buildRemoveFormatChanges (reverse mode)", () => {
  it("removes the highlight, keeps the heading", () => {
    const doc = "### ==标题==";
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildRemoveFormatChanges(doc, inner, inner + 2, ["highlight"]));
    expect(out).toBe("### 标题");
  });

  it("removes the heading, keeps a colored highlight verbatim", () => {
    const doc = '### <mark style="background:#FFB8EBA6;">标题</mark>';
    const inner = doc.indexOf("标题");
    const out = applyChanges(doc, buildRemoveFormatChanges(doc, inner, inner + 2, ["h3"]));
    expect(out).toBe('<mark style="background:#FFB8EBA6;">标题</mark>');
  });

  it("removes bold but keeps the highlight", () => {
    const doc = "==**字**==";
    const out = applyChanges(doc, buildRemoveFormatChanges(doc, 4, 5, ["bold"]));
    expect(out).toBe("==字==");
  });

  it("empty remove set is a no-op", () => {
    expect(buildRemoveFormatChanges("==字==", 2, 3, [])).toEqual([]);
  });

  it("removes a highlight when an INNER character is tapped", () => {
    const doc = "==你好世界==";
    const m = doc.indexOf("好"); // a middle char, not adjacent to the ==
    const out = applyChanges(doc, buildRemoveFormatChanges(doc, m, m + 1, ["highlight"]));
    expect(out).toBe("你好世界");
  });

  it("removes a colored <mark> when an inner character is tapped", () => {
    const doc = '前<mark style="background:#FFB8EBA6;">你好世界</mark>后';
    const m = doc.indexOf("好");
    const out = applyChanges(doc, buildRemoveFormatChanges(doc, m, m + 1, ["highlight"]));
    expect(out).toBe("前你好世界后");
  });

  it("leaves no orphan </mark> when the range only partially overlaps the span", () => {
    // Range covers the open tag + first chars but stops before </mark>.
    const doc = '<mark style="background:#BBFABBA6;">你好世界</mark>';
    const from = 0;
    const to = doc.indexOf("好"); // mid-content, before </mark>
    const out = applyChanges(doc, buildRemoveFormatChanges(doc, from, to, ["highlight"]));
    expect(out).toBe("你好世界");
    expect(out).not.toContain("</mark>");
    expect(out).not.toContain("<mark");
  });
});

describe("inline + block at line start (guard regression)", () => {
  it("highlight + heading on a line starting at col 0 composes valid markup", () => {
    const doc = "1. 你好？";
    const changes = buildFormatChanges(doc, 0, doc.length, ["highlight", "h1"]);
    // Block prefix insert at 0 must order before the inline replace at 0.
    expect(applyChangesToString(doc, changes)).toBe("# ==1. 你好？==");
    expect(formattingPreservesContent(doc, changes)).toBe(true);
  });

  it("applyChangesToString composes an insert + replace sharing a position", () => {
    const doc = "abc";
    const changes = [
      { from: 0, to: 3, insert: "==abc==" },
      { from: 0, to: 0, insert: "# " },
    ];
    expect(applyChangesToString(doc, changes)).toBe("# ==abc==");
  });
});

describe("formatting data-loss guard", () => {
  it("plain text ignores markup", () => {
    expect(formattingPlainText("### ==**你好**==")).toBe("你好");
    expect(formattingPlainText("> 引用")).toBe("引用");
    expect(formattingPlainText('<mark style="background:#fff;">字</mark>')).toBe("字");
  });

  it("real format builders preserve content", () => {
    const doc = "我爱学中文。";
    expect(formattingPreservesContent(doc, buildFormatChanges(doc, 1, 3, ["bold"]))).toBe(true);
    expect(
      formattingPreservesContent(doc, buildSetFormatChanges(doc, 1, 3, ["h2", "highlight"]))
    ).toBe(true);
    expect(formattingPreservesContent(doc, buildUnformatChanges(doc, 0, 6))).toBe(true);
  });

  it("flags a change that would delete content", () => {
    const doc = "我爱学中文。";
    // A bogus change that drops characters.
    expect(formattingPreservesContent(doc, [{ from: 1, to: 4, insert: "X" }])).toBe(false);
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
