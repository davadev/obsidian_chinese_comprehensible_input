// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { TFile } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { buildMarkdownRendering, markdownLinkClickHandler, openHref } from "../editor/markdownRendering";
import { cciRedecorateEffect } from "../editor/chineseDecorations";
import { DEFAULT_HIGHLIGHT_BG } from "../editor/highlightPalette";

/**
 * The Markdown the reading view draws itself: hidden syntax characters, bullets, rules, task boxes, links, embeds and
 * highlights. The rendering is all decisions about which ranges to hide or replace, and getting one wrong shows raw
 * syntax in the middle of a note, or (for replace decorations off-screen) breaks CodeMirror's measuring, so each
 * construct is pinned on a real parse tree, with the widgets' DOM and the click and tap handlers.
 */

installObsidianDom();

interface Ctx {
  doc: string;
  mode?: string;
  display?: string;
  interactive?: boolean;
  files?: Record<string, any>;
  active?: any;
}
const file = (path: string, extension = "md", basename = path.replace(/\.[^.]+$/, "")): any => Object.assign(new TFile(), { path, extension, basename });

function mount(c: Ctx) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.defaultDisplayMode = c.display ?? "none";
  const mode = { value: c.mode ?? "read" };
  const plugin: any = {
    settings,
    app: {
      plugins: undefined,
      workspace: { getActiveFile: vi.fn(() => c.active ?? null), openLinkText: vi.fn(async () => {}) },
      metadataCache: { getFirstLinkpathDest: vi.fn((t: string) => c.files?.[t] ?? null) },
      vault: { getResourcePath: vi.fn((f: any) => `app://res/${f.path}`) },
    },
    activeViewMode: () => mode.value,
    isInteractiveMode: vi.fn(() => c.interactive ?? false),
    openFileInChineseView: vi.fn(async () => {}),
  };
  const reached = { value: false };
  const vp = buildMarkdownRendering(plugin);
  const view = new EditorView({
    state: EditorState.create({ doc: c.doc, extensions: [markdown({ base: markdownLanguage }), vp, markdownLinkClickHandler(plugin), Prec.lowest(EditorView.domEventHandlers({ mousedown: () => ((reached.value = true), true) }))] }),
    parent: document.body,
  });
  return { view, vp, plugin, mode, reached };
}
type D = { from: number; to: number; spec: any; kind: string };
const decos = (view: EditorView, vp: any): D[] => {
  const out: D[] = [];
  const it = (view.plugin(vp) as any).decorations.iter();
  while (it.value) {
    const s = it.value.spec;
    const kind = s.widget ? s.widget.constructor.name : s.class ? `mark:${s.class}` : it.value.point ? "hide" : "line";
    out.push({ from: it.from, to: it.to, spec: s, kind });
    it.next();
  }
  return out;
};
const run = (c: Ctx) => {
  const m = mount(c);
  return { ...m, d: decos(m.view, m.vp) };
};
const slices = (doc: string, d: D[], kind: string) => d.filter((x) => x.kind === kind).map((x) => doc.slice(x.from, x.to));

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("modes", () => {
  it("edit mode draws nothing: raw syntax stays visible", () => {
    expect(run({ doc: "# 标题\n**粗**", mode: "edit" }).d).toEqual([]);
  });
});

describe("headings, quotes, emphasis, code", () => {
  it("hides the # marks with the space after them, up to the text", () => {
    const doc = "## 标题\n\n正文";
    expect(slices(doc, run({ doc }).d, "hide")).toEqual(["## "]);
  });

  it("a heading mark at the very end of the document hides just itself", () => {
    const doc = "#";
    expect(slices(doc, run({ doc }).d, "hide")).toEqual(["#"]);
  });

  it("hides > and its space, and marks each quoted line for the bar and indent", () => {
    const doc = "> 引用一\n> 引用二";
    const { d } = run({ doc });
    expect(slices(doc, d, "hide")).toEqual(["> ", "> "]);
    const lines = d.filter((x) => x.spec.class === "cci-md-quote-line");
    expect(lines.map((l) => [l.from, l.to])).toEqual([[0, 0], [6, 6]]);
  });

  it("a nested or indented quote marks the line it is on, not the mark's own position", () => {
    const doc = "  > > 嵌套";
    const lines = run({ doc }).d.filter((x) => x.spec.class === "cci-md-quote-line");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.from === 0 && l.to === 0)).toBe(true);
  });

  it("a quote mark at the end of the text hides without running past it", () => {
    const doc = ">";
    expect(slices(doc, run({ doc }).d, "hide")).toEqual([">"]);
  });

  it("hides strikethrough marks (the format writes ~~, so the grammar must be the one that parses it)", () => {
    const doc = "~~删~~";
    expect(slices(doc, run({ doc }).d, "hide")).toEqual(["~~", "~~"]);
  });

  it("strikes through ~~ text ~~ with spaces inside too, as Obsidian does: marks hidden, text struck", () => {
    for (const doc of ["~~test ~~", "~~ test~~", "~~ test ~~"]) {
      const { d } = run({ doc });
      expect(slices(doc, d, "hide"), doc).toEqual(["~~", "~~"]);
      const struck = d.find((x) => x.spec.class === "cci-md-strike")!;
      expect(doc.slice(struck.from, struck.to), doc).toBe(doc.slice(2, -2));
      document.body.innerHTML = "";
    }
  });

  it("a strikethrough the grammar parsed is not drawn twice", () => {
    const doc = "~~ok~~ ~~spaced ~~";
    const { d } = run({ doc });
    expect(slices(doc, d, "hide")).toEqual(["~~", "~~", "~~", "~~"]);
    expect(d.filter((x) => x.spec.class === "cci-md-strike")).toHaveLength(1);
  });

  it("leaves ~~ in code alone, and in edit mode", () => {
    const doc = "`~~a ~~`\n\n~~~\n~~b ~~\n~~~";
    expect(run({ doc }).d.some((x) => x.spec.class === "cci-md-strike")).toBe(false);
    document.body.innerHTML = "";
    expect(run({ doc: "~~a ~~", mode: "edit" }).d).toEqual([]);
  });

  it("only spans wholly in view get replace decorations", () => {
    const doc = "~~一 ~~\n" + "行\n".repeat(40) + "~~二 ~~";
    const m = mount({ doc });
    Object.defineProperty(m.view, "visibleRanges", { value: [{ from: 0, to: 8 }], configurable: true });
    m.view.dispatch({ effects: cciRedecorateEffect.of(null) });
    expect(decos(m.view, m.vp).filter((x) => x.kind === "hide").map((x) => doc.slice(x.from, x.to))).toEqual(["~~", "~~"]);
  });

  it("hides emphasis and strong marks, and inline code backticks", () => {
    const doc = "*斜* **粗** `码`";
    expect(slices(doc, run({ doc }).d, "hide")).toEqual(["*", "*", "**", "**", "`", "`"]);
  });

  it("leaves a code fence's backticks alone", () => {
    const doc = "```\n代码\n```";
    expect(slices(doc, run({ doc }).d, "hide")).toEqual([]);
  });
});

describe("lists, rules and task boxes", () => {
  it("replaces an unordered bullet with a dot and leaves ordered numbers", () => {
    const doc = "- 一\n* 二\n+ 三\n1. 四";
    const { d } = run({ doc });
    expect(slices(doc, d, "BulletWidget")).toEqual(["-", "*", "+"]);
  });

  it("a task line gets a checkbox in place of the bullet, not both", () => {
    const doc = "- [x] 完成\n- [ ] 待办";
    const { d } = run({ doc });
    expect(slices(doc, d, "BulletWidget")).toEqual([]);
    expect(slices(doc, d, "CheckboxWidget")).toEqual(["- [x] ", "- [ ] "]);
  });

  it("only complete task markers count (the bullet stays for `- [ and the like`)", () => {
    const doc = "- [ab] 不是\n- [";
    expect(slices(doc, run({ doc }).d, "BulletWidget")).toEqual(["-", "-"]);
  });

  it("a bullet is only skipped for a real task marker: `[` then a character, `]`, then a space", () => {
    const doc = "- [x]没空格\n- [xy] 多字\n- [\n- [x";
    expect(slices(doc, run({ doc }).d, "BulletWidget")).toEqual(["-", "-", "-", "-"]);
  });

  it("a task inside a code block is left as text", () => {
    const doc = "```\n- [x] 代码\n```";
    expect(slices(doc, run({ doc }).d, "CheckboxWidget")).toEqual([]);
  });

  it("horizontal rules become a rule widget, however they are written", () => {
    const doc = "上\n\n---\n\n***\n\n___\n\n下";
    const { d } = run({ doc });
    expect(slices(doc, d, "HrWidget").length).toBeGreaterThanOrEqual(3);
  });
});

describe("links and images", () => {
  it("[label](url) shows the label as a link and hides the rest", () => {
    const doc = "见[官网](https://example.com/a)吧";
    const { d } = run({ doc });
    const link = d.find((x) => x.spec.class === "cci-md-link")!;
    expect(doc.slice(link.from, link.to)).toBe("官网");
    expect(link.spec.attributes["data-cci-href"]).toBe("https://example.com/a");
    expect(slices(doc, d, "hide")).toEqual(["[", "](https://example.com/a)"]);
  });

  it("a link written without a closing parenthesis, and reference-style links, are left as they are", () => {
    for (const doc of ["[官网](https://example.com", "[官网][ref]\n\n[ref]: https://example.com", "[官网]"]) {
      expect(run({ doc }).d.some((x) => x.spec.class === "cci-md-link"), doc).toBe(false);
      document.body.innerHTML = "";
    }
  });

  it("an image becomes an image widget with its url", () => {
    const doc = "![图](https://example.com/a.png)";
    const { d } = run({ doc });
    const w = d.find((x) => x.kind === "ImgWidget")!;
    const img = w.spec.widget.toDOM() as HTMLImageElement;
    expect(img.src).toBe("https://example.com/a.png");
    expect(img.className).toBe("cci-md-embed-img");
    expect(w.spec.widget.eq(w.spec.widget)).toBe(true);
    expect(w.spec.widget.ignoreEvent()).toBe(true);
  });

  it("an image whose url cannot be read is left as raw text", () => {
    const doc = "![图]()";
    expect(run({ doc }).d.some((x) => x.kind === "ImgWidget")).toBe(false);
  });
});

describe("wikilinks and embeds", () => {
  const files = { 笔记: file("笔记.md"), 图: file("图.png", "png"), 文档: file("文档.pdf", "pdf") };

  it("[[note]] and [[note|alias]] become link widgets showing the alias, or the target", () => {
    const doc = "[[笔记]] [[笔记|别名]]";
    const { d } = run({ doc, files });
    const ws = d.filter((x) => x.kind === "WikilinkWidget");
    expect(ws.map((w) => (w.spec.widget.toDOM() as HTMLElement).textContent)).toEqual(["笔记", "别名"]);
    expect(ws.map((w) => doc.slice(w.from, w.to))).toEqual(["[[笔记]]", "[[笔记|别名]]"]);
  });

  it("an embed is not also read as a wikilink", () => {
    const doc = "![[图]]";
    const { d } = run({ doc, files });
    expect(d.filter((x) => x.kind === "WikilinkWidget")).toEqual([]);
    expect(d.filter((x) => x.kind === "EmbedWidget")).toHaveLength(1);
  });

  it("links inside code are left alone", () => {
    const doc = "`[[笔记]]` and ```\n![[图]]\n```";
    const { d } = run({ doc, files });
    expect(d.filter((x) => x.kind === "WikilinkWidget" || x.kind === "EmbedWidget")).toEqual([]);
  });

  it("the link widget carries its target in the tooltip, and in format mode becomes a tap target over the whole markup", () => {
    const doc = "[[笔记|别名]]";
    const read = run({ doc, files }).d[0].spec.widget.toDOM() as HTMLElement;
    expect(read.title).toBe("Open: 笔记");
    expect(read.classList.contains("cci-word")).toBe(false);
    document.body.innerHTML = "";
    const fmt = run({ doc, files, mode: "format" }).d[0].spec.widget.toDOM() as HTMLElement;
    expect(fmt.classList.contains("cci-word")).toBe(true);
    expect([fmt.dataset.cciSurface, fmt.dataset.cciStart, fmt.dataset.cciEnd, fmt.dataset.cciDoclen]).toEqual(["别名", "0", "9", "9"]);
  });

  it("widget equality follows target, alias, mode, offsets and tint", () => {
    const mk = (doc: string, mode = "read") => run({ doc, files, mode }).d.find((x) => x.spec.widget)!.spec.widget;
    const a = mk("[[笔记]]");
    expect(a.eq(mk("[[笔记]]"))).toBe(true);
    document.body.innerHTML = "";
    expect(a.eq(mk("[[文档]]"))).toBe(false);
    document.body.innerHTML = "";
    expect(a.eq(mk("[[笔记|x]]"))).toBe(false);
    document.body.innerHTML = "";
    expect(a.eq(mk("[[笔记]]", "format"))).toBe(false);
    document.body.innerHTML = "";
    expect(a.eq(mk(" [[笔记]]"))).toBe(false);
    document.body.innerHTML = "";
    expect(a.eq(mk("==[[笔记]]=="))).toBe(false);
    expect(a.ignoreEvent()).toBe(true);
  });

  it("an image embed renders the vault file, a note embed a card with the note's name, an unknown one a card with its target", () => {
    const doc = "![[图]] ![[笔记]] ![[没有]]";
    const { d, plugin } = run({ doc, files });
    const [img, card, ghost] = d.filter((x) => x.kind === "EmbedWidget").map((x) => x.spec.widget.toDOM() as HTMLElement);
    expect(decodeURIComponent((img as HTMLImageElement).src)).toContain("app://res/图.png");
    expect(img.className).toBe("cci-md-embed-img");
    expect((img as HTMLImageElement).alt).toBe("图");
    expect(card.className).toBe("cci-md-embed cci-md-embed-card");
    expect(card.textContent).toBe("笔记");
    expect(ghost.textContent).toBe("没有");
    expect(plugin.app.vault.getResourcePath).toHaveBeenCalledWith(files.图);
  });

  it("in format mode embeds are tap targets too (image and card)", () => {
    const doc = "![[图]] ![[笔记]] ![[没有]]";
    const { d } = run({ doc, files, mode: "format" });
    const els = d.filter((x) => x.kind === "EmbedWidget").map((x) => x.spec.widget.toDOM() as HTMLElement);
    expect(els.map((e) => e.dataset.cciSurface)).toEqual(["图", "笔记", "没有"]);
    expect(els[0].dataset.cciDoclen).toBe(String("![[图]]".length));
  });

  it("embed equality follows target, mode, offsets and tint", () => {
    const mk = (doc: string, mode = "read") => run({ doc, files, mode }).d.find((x) => x.spec.widget)!.spec.widget;
    const a = mk("![[笔记]]");
    expect(a.eq(mk("![[笔记]]"))).toBe(true);
    for (const other of [mk("![[文档]]"), mk("![[笔记]]", "format"), mk(" ![[笔记]]"), mk("==![[笔记]]==")]) expect(a.eq(other)).toBe(false);
    expect(a.ignoreEvent()).toBe(true);
  });

  it("a link or embed fully inside a highlight is tinted by its own widget", () => {
    const doc = "==[[笔记]] ![[图]] ![[笔记]]==";
    const { d } = run({ doc, files, display: "two-line" });
    const els = d.filter((x) => x.kind.endsWith("Widget") && x.kind !== "HrWidget").map((x) => x.spec.widget.toDOM() as HTMLElement);
    expect(els).toHaveLength(3);
    for (const el of els) {
      expect(el.classList.contains("cci-md-link-hl")).toBe(true);
      expect(el.style.getPropertyValue("--cci-mark-bg")).toBe(DEFAULT_HIGHLIGHT_BG);
    }
  });

  it("a link after a highlight is not tinted by it", () => {
    const doc = "==一== [[笔记]]";
    const { d } = run({ doc, files, display: "two-line" });
    const w = d.find((x) => x.kind === "WikilinkWidget")!.spec.widget.toDOM() as HTMLElement;
    expect(w.classList.contains("cci-md-link-hl")).toBe(false);
  });

  it("opening: a tap or click opens a note in the Chinese view, anything else through Obsidian, and nothing if it does not resolve", () => {
    const doc = "[[笔记]] [[文档]] [[没有]]";
    const { d, plugin } = run({ doc, files });
    const [note, pdf, ghost] = d.map((x) => x.spec.widget.toDOM() as HTMLElement);
    const ev = new Event("mousedown", { cancelable: true, bubbles: true });
    note.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(plugin.openFileInChineseView).toHaveBeenCalledWith(files.笔记);
    pdf.dispatchEvent(new Event("touchstart", { cancelable: true }));
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith("文档", "", false);
    ghost.dispatchEvent(new Event("mousedown", { cancelable: true }));
    expect(plugin.openFileInChineseView).toHaveBeenCalledTimes(1);
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledTimes(1);
  });

  it("looks the target up from the note that is open", () => {
    const { d, plugin } = run({ doc: "[[笔记]]", files, active: { path: "dir/当前.md" } });
    (d[0].spec.widget.toDOM() as HTMLElement).dispatchEvent(new Event("mousedown", { cancelable: true }));
    expect(plugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("笔记", "dir/当前.md");
  });

  it("in a tool mode a tap on a link is left for the tool (not prevented, nothing opened)", () => {
    const { d, plugin } = run({ doc: "[[笔记]]", files, interactive: true });
    const ev = new Event("mousedown", { cancelable: true });
    (d[0].spec.widget.toDOM() as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(plugin.openFileInChineseView).not.toHaveBeenCalled();
  });
});

describe("highlights", () => {
  it("hides the == delimiters and tints the text between them", () => {
    const doc = "我==学习==好";
    const { d } = run({ doc });
    expect(slices(doc, d, "hide")).toEqual(["==", "=="]);
    const tint = d.find((x) => x.spec.class === "cci-md-highlight")!;
    expect(doc.slice(tint.from, tint.to)).toBe("学习");
  });

  it("in the two-line modes only the delimiters are hidden: the ruby widgets draw the tint", () => {
    const doc = "我==学习==好";
    for (const display of ["two-line", "three-line"]) {
      const { d } = run({ doc, display });
      expect(slices(doc, d, "hide")).toEqual(["==", "=="]);
      expect(d.some((x) => x.spec.class?.includes("cci-md-highlight"))).toBe(false);
      document.body.innerHTML = "";
    }
  });

  it("a coloured <mark> hides its tags and tints with its own colour", () => {
    const open = '<mark style="background:#abcdef;">';
    const doc = `我${open}学习</mark>好`;
    const { d } = run({ doc });
    expect(slices(doc, d, "hide")).toEqual([open, "</mark>"]);
    const tint = d.find((x) => x.spec.class === "cci-md-highlight cci-md-colored")!;
    expect(tint.spec.attributes.style).toBe("--cci-mark-bg:#abcdef;");
  });

  it("a highlight inside code is left alone", () => {
    const doc = "`==码==`";
    expect(run({ doc }).d.some((x) => x.spec.class?.includes("cci-md-highlight"))).toBe(false);
  });

  it("a highlight that is not wholly inside the visible range is skipped (no replace decorations off-screen)", () => {
    const doc = "==一==\n" + "行\n".repeat(40) + "==二==";
    const m = mount({ doc });
    Object.defineProperty(m.view, "visibleRanges", { value: [{ from: 0, to: 8 }], configurable: true });
    m.view.dispatch({ effects: cciRedecorateEffect.of(null) });
    const found = decos(m.view, m.vp).filter((x) => x.kind === "hide").map((x) => doc.slice(x.from, x.to));
    expect(found).toEqual(["==", "=="]);
    const spanTo = doc.indexOf("二");
    expect(decos(m.view, m.vp).every((x) => x.to < spanTo)).toBe(true);
  });
});

describe("keeping up with the document", () => {
  it("rebuilds on an edit and on a redraw effect, and leaves things alone otherwise", () => {
    const m = mount({ doc: "我==学习==好" });
    const first = (m.view.plugin(m.vp) as any).decorations;
    m.view.dispatch({ selection: { anchor: 1 } });
    expect((m.view.plugin(m.vp) as any).decorations).toBe(first);
    m.view.dispatch({ effects: cciRedecorateEffect.of(null) });
    expect((m.view.plugin(m.vp) as any).decorations).not.toBe(first);
    m.view.dispatch({ changes: { from: 0, insert: "# " } });
    expect(decos(m.view, m.vp).some((x) => x.kind === "hide" && x.from === 0 && x.to === 2)).toBe(true);
  });

  it("switching to edit mode and redrawing clears everything, switching back restores it", () => {
    const m = mount({ doc: "# 标题" });
    expect(decos(m.view, m.vp)).not.toEqual([]);
    m.mode.value = "edit";
    m.view.dispatch({ effects: cciRedecorateEffect.of(null) });
    expect(decos(m.view, m.vp)).toEqual([]);
    m.mode.value = "read";
    m.view.dispatch({ effects: cciRedecorateEffect.of(null) });
    expect(decos(m.view, m.vp)).not.toEqual([]);
  });
});

describe("the small widgets", () => {
  it("a bullet is a dot, always equal, and lets clicks through", () => {
    const { d } = run({ doc: "- 一" });
    const w = d.find((x) => x.kind === "BulletWidget")!.spec.widget;
    const el = w.toDOM() as HTMLElement;
    expect([el.className, el.textContent]).toEqual(["cci-md-bullet", "•"]);
    expect(w.eq()).toBe(true);
    expect(w.ignoreEvent()).toBe(false);
  });

  it("a rule is an hr, always equal, and swallows events", () => {
    const { d } = run({ doc: "上\n\n---\n\n下" });
    const w = d.find((x) => x.kind === "HrWidget")!.spec.widget;
    expect((w.toDOM() as HTMLElement).className).toBe("cci-md-hr");
    expect(w.eq()).toBe(true);
    expect(w.ignoreEvent()).toBe(true);
  });

  it.each([
    [" ", "square", "cci-md-task-c32", []],
    ["x", "check-square-2", "cci-md-task-x", ["is-done"]],
    ["X", "check-square-2", "cci-md-task-X", ["is-done"]],
    ["-", "square-x", "cci-md-task-c45", ["is-cancel"]],
    ["f", "flame", "cci-md-task-f", []],
    ["?", "help-circle", "cci-md-task-c63", []],
    ["~", "square", "cci-md-task-c126", []],
  ])("the task box for [%s] is the %s icon", (char, icon, cls, extra) => {
    const doc = `- [${char}] 事`;
    const w = run({ doc }).d.find((x) => x.kind === "CheckboxWidget")!.spec.widget;
    const el = w.toDOM() as HTMLElement;
    expect(el.getAttribute("data-icon")).toBe(icon);
    expect(el.classList.contains(cls)).toBe(true);
    for (const e of extra) expect(el.classList.contains(e)).toBe(true);
    expect(el.getAttribute("data-cci-task")).toBe(char);
    expect(el.title).toBe(`Task: [${char}]`);
    expect(w.eq(w)).toBe(true);
    expect(w.ignoreEvent()).toBe(true);
  });

  it("if the icon cannot be drawn the box shows its marker as text", async () => {
    const obsidian = await import("obsidian");
    const spy = vi.spyOn(obsidian, "setIcon").mockImplementation(() => {
      throw new Error("no icon");
    });
    try {
      const w = run({ doc: "- [x] 事" }).d.find((x) => x.kind === "CheckboxWidget")!.spec.widget;
      expect((w.toDOM() as HTMLElement).textContent).toBe("[x]");
    } finally {
      spy.mockRestore();
    }
  });

  it("task boxes with different characters are not equal", () => {
    const a = run({ doc: "- [x] 事" }).d.find((x) => x.kind === "CheckboxWidget")!.spec.widget;
    document.body.innerHTML = "";
    const b = run({ doc: "- [ ] 事" }).d.find((x) => x.kind === "CheckboxWidget")!.spec.widget;
    expect(a.eq(b)).toBe(false);
  });
});

describe("clicking a plain link", () => {
  const click = (target: Element) => target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  const linkEl = (view: EditorView) => view.contentDOM.querySelector(".cci-md-link")!;

  it("opens an external address in a new window and stops the editor handling the click", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, reached } = mount({ doc: "[官网](https://example.com/a)" });
    click(linkEl(view));
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
    expect(reached.value).toBe(false);
  });

  it("leaves clicks that are not on a link, or not on an HTML element, to the editor", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, plugin, reached } = mount({ doc: "[官网](https://example.com/a) 文字" });
    const plain = document.createElement("span");
    view.contentDOM.appendChild(plain);
    click(plain);
    expect(reached.value).toBe(true);
    reached.value = false;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    view.contentDOM.appendChild(svg);
    click(svg);
    expect(reached.value).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(plugin.openFileInChineseView).not.toHaveBeenCalled();
  });

  it("a link element with no address is left to the editor", () => {
    const { view, reached } = mount({ doc: "x" });
    const bad = document.createElement("span");
    bad.className = "cci-md-link";
    view.contentDOM.appendChild(bad);
    click(bad);
    expect(reached.value).toBe(true);
  });

  it("in a tool mode the click is left for the tool", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, reached } = mount({ doc: "[官网](https://example.com/a)", interactive: true });
    click(linkEl(view));
    expect(reached.value).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("openHref", () => {
  const files = { 笔记: file("笔记.md"), 图: file("图.png", "png") };
  const setup = (interactive = false) => mount({ doc: "x", files, interactive }).plugin;

  it.each(["https://example.com", "HTTP://example.com", "mailto:a@b.c"])("%s opens in a new window", (href) => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openHref(setup(), href);
    expect(open).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer");
  });

  it("a vault note opens in the Chinese view, any other path through Obsidian", () => {
    const plugin = setup();
    openHref(plugin, "笔记");
    expect(plugin.openFileInChineseView).toHaveBeenCalledWith(files.笔记);
    openHref(plugin, "图");
    openHref(plugin, "没有");
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith("图", "", false);
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith("没有", "", false);
  });

  it("never navigates while a tool mode is active", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const plugin = setup(true);
    openHref(plugin, "https://example.com");
    openHref(plugin, "笔记");
    expect(open).not.toHaveBeenCalled();
    expect(plugin.openFileInChineseView).not.toHaveBeenCalled();
  });
});
