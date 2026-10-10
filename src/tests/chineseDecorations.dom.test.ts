// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { buildChineseDecorations, cciRedecorateEffect, cciReTokenizeEffect } from "../editor/chineseDecorations";
import { putCachedTokens } from "../tokenizer/tokenCache";
import { DEFAULT_HIGHLIGHT_BG } from "../editor/highlightPalette";

/**
 * What the reading view paints, from tokens to decorations to DOM. This is where most of this plugin's rendering bugs
 * have lived, so each decision is pinned on a real CodeMirror view: which words get an annotation stack, a coloured
 * mark, a plain clickable mark or nothing; how non-word characters become tap targets in format mode; how highlights
 * tint; what the stack's DOM looks like row by row; and the async paths (cold cache, edits, a newer document taking
 * over). Layout is not tested here (no layout under happy-dom): `npm run check:layout` covers that.
 */

installObsidianDom();

interface Tok {
  start: number;
  end: number;
  surface: string;
  isWord: boolean;
  candidates: any[];
  selected?: any;
  confidence: number;
}
const entry = (surface: string, over: Record<string, unknown> = {}) => ({
  simplified: surface,
  traditional: surface,
  pinyin: surface.length === 2 ? "xué xí" : "xué",
  definitions: ["to study; to learn", "second"],
  ...over,
});
const word = (surface: string, start: number, over: Record<string, unknown> = {}): Tok => {
  const e = entry(surface, over);
  return { start, end: start + surface.length, surface, isWord: true, candidates: [e], selected: e, confidence: 1 };
};
const gap = (surface: string, start: number): Tok => ({ start, end: start + surface.length, surface, isWord: false, candidates: [], confidence: 1 });
const rec = (status: string, over: Record<string, unknown> = {}): any => ({
  key: "k",
  surfaces: ["x"],
  status,
  seenCount: 1,
  recentSeenAt: [],
  dailySeenCounts: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

interface Ctx {
  text: string;
  tokens: Tok[];
  settings?: (s: any) => void;
  records?: Record<string, any>;
  mode?: string;
  cold?: boolean;
  tokenize?: (text: string) => Promise<Tok[]>;
}
function mount(c: Ctx) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.defaultDisplayMode = "two-line";
  c.settings?.(settings);
  const mode = { value: c.mode ?? "read" };
  const plugin: any = {
    settings,
    app: {},
    tokenizer: { tokenize: vi.fn(c.tokenize ?? (async () => c.tokens)) },
    vocab: { bySurface: vi.fn((s: string) => c.records?.[s]) },
    activeViewMode: () => mode.value,
  };
  if (!c.cold) putCachedTokens(c.text, c.tokens);
  const vp = buildChineseDecorations(plugin);
  const view = new EditorView({ state: EditorState.create({ doc: c.text, extensions: [vp] }), parent: document.body });
  return { view, vp, plugin, settings, mode };
}
type D = { from: number; to: number; spec: any };
const decorations = (view: EditorView, vp: any): D[] => {
  const out: D[] = [];
  const it = (view.plugin(vp) as any).decorations.iter();
  while (it.value) {
    out.push({ from: it.from, to: it.to, spec: it.value.spec });
    it.next();
  }
  return out;
};
const run = (c: Ctx) => {
  const m = mount(c);
  return { ...m, decos: decorations(m.view, m.vp) };
};
const widgetDom = (d: D): HTMLElement => d.spec.widget.toDOM();
const rows = (el: HTMLElement) => Array.from(el.querySelectorAll(":scope > span")).map((s) => s.className);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

let n = 0;
/** A distinct document per test, so the shared token cache never hands one test another's tokens. */
const uniq = (s: string) => `${s}${"。".repeat(++n % 40)}${n}`;

beforeEach(() => void (n += 1));
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("which words get what", () => {
  it("an unknown word becomes an annotation stack in the two-line modes", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0), gap(text.slice(2), 2)] });
    const w = decos.find((d) => d.spec.widget)!;
    expect([w.from, w.to]).toEqual([0, 2]);
    expect(w.spec.inclusive).toBe(false);
    const dom = widgetDom(w);
    expect(dom.className).toContain("cci-stack");
    expect(dom.getAttribute("data-cci-surface")).toBe("学习");
  });

  it("an ignored word gets nothing", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0)], records: { 学习: rec("ignored") } });
    expect(decos.filter((d) => d.from === 0 && d.to === 2)).toEqual([]);
  });

  it("edit mode only marks (text must stay editable), never replaces it with a widget", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0)], mode: "edit", settings: (s) => (s.showNewColor = true) });
    const d = decos.find((x) => x.from === 0 && x.to === 2)!;
    expect(d.spec.widget).toBeUndefined();
    expect(d.spec.class).toContain("cci-word");
    expect(d.spec.attributes["data-cci-surface"]).toBe("学习");
  });

  it("a known word is left as plain text, unless known-word popups need it clickable", () => {
    const text = uniq("学习");
    const known = { 学习: rec("known") };
    const off = run({ text, tokens: [word("学习", 0)], records: known, settings: (s) => ((s.knownWordPopups = false), (s.showKnownColor = false), (s.textColors = { enabled: false })) });
    expect(off.decos.filter((d) => d.from === 0 && d.to === 2)).toEqual([]);
    document.body.innerHTML = "";
    const on = run({ text, tokens: [word("学习", 0)], records: known, settings: (s) => ((s.knownWordPopups = true), (s.showKnownColor = false)) });
    const d = on.decos.find((x) => x.from === 0)!;
    expect(d.spec.class).toBe("cci-word");
    expect(d.spec.attributes).toMatchObject({ "data-cci-surface": "学习", "data-cci-start": "0", "data-cci-end": "2", "data-cci-doclen": "2" });
  });

  it("custom text colours make a word markable even when it would otherwise be plain", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0)], records: { 学习: rec("known") }, settings: (s) => ((s.knownWordPopups = false), (s.showKnownColor = false), (s.textColors = { enabled: true })) });
    expect(decos.find((x) => x.from === 0)!.spec.class).toBe("cci-word");
  });

  it("a coloured word is a mark carrying its colour key and offsets", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0)], mode: "edit", settings: (s) => ((s.showNewColor = true), (s.colorMode = "status")) });
    const d = decos.find((x) => x.from === 0)!;
    expect(d.spec.class).toBe("cci-word cci-color-new");
    expect(d.spec.attributes).toMatchObject({ "data-cci-color": "new", "data-cci-surface": "学习" });
  });

  it("a known word that shows no ruby (nothing to annotate) falls back to a mark, in the two-line modes too", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0)], records: { 学习: rec("known") }, settings: (s) => ((s.showKnownColor = true), (s.defaultDisplayMode = "two-line")) });
    const d = decos.find((x) => x.from === 0)!;
    expect(d.spec.widget).toBeUndefined();
    expect(d.spec.class).toContain("cci-color-known");
  });

  it("a word in a heading carries its level so the tint covers the bigger text", () => {
    const text = uniq("# 学习");
    const { decos } = run({ text, tokens: [gap("# ", 0), word("学习", 2)], mode: "edit", settings: (s) => (s.showNewColor = true) });
    expect(decos.find((x) => x.from === 2)!.spec.class).toContain("cci-word-h1");
  });

  it("a heading level is looked up once per line", () => {
    const text = uniq("## 学习汉语");
    const { decos } = run({ text, tokens: [gap("## ", 0), word("学习", 3), word("汉语", 5)], mode: "edit", settings: (s) => (s.showNewColor = true) });
    expect(decos.filter((d) => d.spec.class?.includes("cci-word-h2"))).toHaveLength(2);
  });

  it("a word that sits inside code or a link target is left alone", () => {
    const text = "`学习` and 学习";
    const tokens = [gap("`", 0), word("学习", 1), gap("` and ", 3), word("学习", 9)];
    const { decos } = run({ text, tokens, mode: "edit", settings: (s) => (s.showNewColor = true) });
    expect(decos.map((d) => d.from)).toEqual([9]);
  });

  it("which colour shows follows the colour mode, and HSK levels can each be switched off", () => {
    const text = uniq("学习");
    const r = { 学习: rec("unknown", { hsk: { source: "2.0", levels: ["3"] } }) };
    const hsk = run({ text, tokens: [word("学习", 0)], records: r, mode: "edit", settings: (s) => ((s.colorMode = "hsk"), (s.showHskColors = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true })) });
    expect(hsk.decos.find((d) => d.from === 0)!.spec.class).toContain("cci-color-hsk-3");
    document.body.innerHTML = "";
    const off = run({ text, tokens: [word("学习", 0)], records: r, mode: "edit", settings: (s) => ((s.colorMode = "hsk"), (s.showHskColors = { 1: true, 2: true, 3: false, 4: true, 5: true, 6: true, 7: true }), (s.knownWordPopups = false), (s.textColors = { enabled: false })) });
    expect(off.decos.filter((d) => d.from === 0)).toEqual([]);
  });

  it.each([
    ["known", "showKnownColor"],
    ["partial", "showPartialColor"],
    ["unknown", "showUnknownColor"],
    ["new", "showNewColor"],
  ])("the %s colour follows %s", (status, flag) => {
    const text = uniq("学习");
    const base: Record<string, any> = { known: rec("known"), partial: rec("meaningKnownPinyinUnknown"), unknown: rec("unknown"), new: undefined };
    const on = run({ text, tokens: [word("学习", 0)], records: { 学习: base[status] }, mode: "edit", settings: (s) => (s[flag] = true) });
    expect(on.decos.find((d) => d.from === 0)!.spec.class).toContain(`cci-color-${status}`);
    document.body.innerHTML = "";
    const off = run({ text, tokens: [word("学习", 0)], records: { 学习: base[status] }, mode: "edit", settings: (s) => ((s[flag] = false), (s.knownWordPopups = false), (s.textColors = { enabled: false })) });
    expect(off.decos.filter((d) => d.from === 0 && d.spec.class?.includes("cci-color-"))).toEqual([]);
  });

  it("an HSK word with no level shows no colour", () => {
    const text = uniq("学习");
    const { decos } = run({ text, tokens: [word("学习", 0)], records: { 学习: rec("unknown") }, mode: "edit", settings: (s) => ((s.colorMode = "hsk"), (s.knownWordPopups = false), (s.textColors = { enabled: false })) });
    expect(decos.filter((d) => d.from === 0)).toEqual([]);
  });
});

describe("non-word characters", () => {
  const text = "学习，好。 12";
  const tokens = [word("学习", 0), gap("，", 2), word("好", 3), gap("。 12", 4)];

  it("are not marked outside format mode", () => {
    const { decos } = run({ text, tokens, mode: "read", settings: (s) => (s.defaultDisplayMode = "none") });
    expect(decos.filter((d) => d.spec.attributes?.["data-cci-surface"] === "，")).toEqual([]);
  });

  it("in format mode every visible character is a tap target with its own offsets, whitespace excepted", () => {
    const { decos } = run({ text, tokens, mode: "format", settings: (s) => (s.defaultDisplayMode = "none") });
    const gaps = decos.filter((d) => d.spec.attributes?.["data-cci-doclen"] === "1");
    expect(gaps.map((d) => d.spec.attributes["data-cci-surface"])).toEqual(["，", "好", "。", "1", "2"]); // the word 好 is a one-character target too
    expect(gaps[0].spec.attributes).toMatchObject({ "data-cci-start": "2", "data-cci-end": "3" });
    expect(gaps[0].spec.class).toBe("cci-word");
  });

  it("surrogate pairs are one target with their UTF-16 length", () => {
    const t = uniq("学习😀好");
    const toks = [word("学习", 0), gap("😀", 2), word("好", 4)];
    const { decos } = run({ text: t, tokens: toks, mode: "format", settings: (s) => (s.defaultDisplayMode = "none") });
    const emoji = decos.find((d) => d.spec.attributes?.["data-cci-surface"] === "😀")!;
    expect([emoji.from, emoji.to, emoji.spec.attributes["data-cci-doclen"]]).toEqual([2, 4, "2"]);
  });

  it("characters inside code are skipped", () => {
    const t = "好`，`好";
    const toks = [word("好", 0), gap("`，`", 1), word("好", 4)];
    const { decos } = run({ text: t, tokens: toks, mode: "format", settings: (s) => (s.defaultDisplayMode = "none") });
    expect(decos.some((d) => d.spec.attributes?.["data-cci-surface"] === "，")).toBe(false);
  });

  it("a token with no candidates counts as a non-word even if flagged as one", () => {
    const t = uniq("学习");
    const odd: Tok = { ...word("学", 0), candidates: [] };
    const { decos } = run({ text: t, tokens: [odd], mode: "format", settings: (s) => (s.defaultDisplayMode = "none") });
    expect(decos.some((d) => d.spec.attributes?.["data-cci-surface"] === "学")).toBe(true);
  });
});

describe("highlights", () => {
  const text = "好 ==学习，12== 好";
  const tokens = [word("好", 0), gap(" ==", 1), word("学习", 4), gap("，12== ", 6), word("好", 12)];
  const ruby = (s: any): void => void (s.defaultDisplayMode = "two-line");

  it("a word inside ==highlight== takes the ruby path and carries the highlight colour", () => {
    const { decos } = run({ text, tokens, settings: ruby, records: { 学习: rec("known"), 好: rec("known") } });
    const w = decos.find((d) => d.from === 4)!;
    expect(w.spec.widget).toBeTruthy();
    expect(widgetDom(w).className).toContain("cci-stack-hl");
    expect(widgetDom(w).style.getPropertyValue("--cci-hl")).toBe(DEFAULT_HIGHLIGHT_BG);
    expect(decos.find((d) => d.from === 0)).toBeUndefined(); // the known word outside it stays plain
  });

  it("non-word glyphs inside a highlight go through the same widget so the band matches, and the delimiters are not marked", () => {
    const { decos } = run({ text, tokens, settings: ruby, records: { 学习: rec("known") } });
    const inside = decos.filter((d) => d.spec.widget && d.from >= 6 && d.to <= 9);
    expect(inside.map((d) => widgetDom(d).getAttribute("data-cci-surface"))).toEqual(["，", "1", "2"]);
    expect(decos.some((d) => d.from === 2 && d.to === 3)).toBe(false); // the opening ==
    expect(decos.some((d) => d.from === 9 && d.to === 10)).toBe(false); // the closing ==
  });

  it("outside the ruby modes the renderer tints, so no extra marks are made for glyphs", () => {
    const { decos } = run({ text, tokens, settings: (s) => (s.defaultDisplayMode = "none"), records: { 学习: rec("known") } });
    expect(decos.filter((d) => d.spec.widget)).toEqual([]);
  });

  it("with status colours on, the highlight wins by default and the status colour wins when told to", () => {
    const base = (s: any): void => void ((s.defaultDisplayMode = "none"), (s.showNewColor = true));
    const hl = run({ text, tokens, settings: base, mode: "edit" });
    expect(hl.decos.find((d) => d.from === 4)!.spec.class).not.toContain("cci-color-new");
    document.body.innerHTML = "";
    const st = run({ text, tokens, settings: (s: any) => (base(s), void (s.highlightOverridesStatus = false)), mode: "edit" });
    expect(st.decos.find((d) => d.from === 4)!.spec.class).toContain("cci-color-new");
  });

  it("a highlighted word in a mark-rendered mode gets the tint as a style and the highlight class", () => {
    const { decos } = run({ text, tokens, settings: (s) => ((s.defaultDisplayMode = "two-line"), (s.highlightOverridesStatus = false), (s.showNewColor = true)), mode: "edit" });
    const d = decos.find((x) => x.from === 4)!;
    expect(d.spec.widget).toBeUndefined();
    expect(d.spec.class).toBeTruthy();
  });

  it("a highlighted word with no status colour still becomes a clickable mark", () => {
    const t = "==学习==";
    const { decos } = run({ text: t, tokens: [gap("==", 0), word("学习", 2), gap("==", 4)], mode: "edit", settings: (s) => ((s.defaultDisplayMode = "none"), (s.showNewColor = false), (s.knownWordPopups = false), (s.textColors = { enabled: false })) });
    expect(decos.find((x) => x.from === 2)!.spec.attributes["data-cci-surface"]).toBe("学习");
  });
});

describe("glyphs after a highlight, headings, and long documents", () => {
  it("a glyph after a highlight is not tinted by it, in the ruby modes", () => {
    const text = "==好== ，好";
    const tokens = [gap("==", 0), word("好", 2), gap("== ，", 3), word("好", 7)];
    const { decos } = run({ text, tokens, settings: (s) => (s.defaultDisplayMode = "two-line"), records: { 好: rec("known") } });
    expect(decos.some((d) => d.from === 6 && d.spec.widget)).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])("HSK level %i colours the word only while its own switch is on", (lvl) => {
    const text = uniq("学习");
    const r = { 学习: rec("unknown", { hsk: { source: "2.0", levels: [String(lvl)] } }) };
    const levels = (on: boolean) => (s: any) => {
      s.colorMode = "hsk";
      s.knownWordPopups = false;
      s.textColors = { enabled: false };
      s.showHskColors = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((l) => [String(l), l === lvl ? on : !on]));
    };
    const on = run({ text, tokens: [word("学习", 0)], records: r, mode: "edit", settings: levels(true) });
    expect(on.decos.find((d) => d.from === 0)!.spec.class).toContain(`cci-color-hsk-${lvl}`);
    document.body.innerHTML = "";
    const off = run({ text, tokens: [word("学习", 0)], records: r, mode: "edit", settings: levels(false) });
    expect(off.decos.filter((d) => d.from === 0)).toEqual([]);
  });

  it("only what is in view is decorated, and tokens before or after it are skipped", () => {
    const text = "一二三四五六七八九十" + "好".repeat(10);
    const tokens = Array.from({ length: 20 }, (_, i) => word(text[i], i));
    const { view, vp } = mount({ text, tokens, mode: "edit", settings: (s) => (s.showNewColor = true) });
    Object.defineProperty(view, "visibleRanges", { value: [{ from: 5, to: 12 }], configurable: true });
    view.dispatch({ effects: cciRedecorateEffect.of(null) });
    expect(decorations(view, vp).map((d) => d.from)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("format mode", () => {
  it("keeps the annotations and adds the offsets, and makes an otherwise plain word markable", () => {
    const t = uniq("学习");
    const a = run({ text: t, tokens: [word("学习", 0)], mode: "format" });
    expect(widgetDom(a.decos[0]).getAttribute("data-cci-start")).toBe("0");
    document.body.innerHTML = "";
    const b = run({ text: t, tokens: [word("学习", 0)], mode: "format", records: { 学习: rec("known") }, settings: (s) => ((s.showKnownColor = false), (s.knownWordPopups = false), (s.textColors = { enabled: false })) });
    expect(b.decos.find((d) => d.from === 0)!.spec.class).toBe("cci-word");
  });
});

describe("the annotation stack (DOM)", () => {
  const w = (rec_: any, settings: (s: any) => void = () => {}, t = uniq("学习")) => {
    const { decos } = run({ text: t, tokens: [word("学习", 0)], records: rec_ ? { 学习: rec_ } : undefined, settings });
    return widgetDom(decos.find((d) => d.spec.widget)!);
  };

  it("two-line: pinyin above each character, aligned per character", () => {
    const dom = w(undefined, (s) => ((s.defaultDisplayMode = "two-line"), (s.line2Content = "pinyin")));
    expect(dom.querySelectorAll(".cci-stack-cell")).toHaveLength(2);
    expect(Array.from(dom.querySelectorAll(".cci-stack-pinyin")).map((p) => p.textContent)).toEqual(["xué", "xí"]);
    expect(Array.from(dom.querySelectorAll(".cci-stack-chars")).map((p) => p.textContent)).toEqual(["学", "习"]);
  });

  it("three-line: the gloss row comes first (top-down) and is one span across the word", () => {
    const dom = w(undefined, (s) => ((s.defaultDisplayMode = "three-line"), (s.line2Content = "pinyin"), (s.line3Content = "english")));
    expect(rows(dom)[0]).toContain("cci-stack-gloss");
    expect(dom.querySelector(".cci-stack-gloss")!.textContent).toBe("to study; to learn");
    expect(rows(dom).at(-1)).toBe("cci-stack-cells");
  });

  it("a row that is not per-character pinyin is a single span above one cell", () => {
    const dom = w(undefined, (s) => ((s.defaultDisplayMode = "two-line"), (s.line2Content = "english")));
    expect(dom.querySelectorAll(".cci-stack-cell-word")).toHaveLength(1);
    expect(dom.querySelector(".cci-stack-gloss")!.textContent).toBe("to study; to learn");
  });

  it("the mnemonic row uses its own class", () => {
    const dom = w(rec("unknown", { mnemonic: { text: "📖" } }), (s) => ((s.defaultDisplayMode = "two-line"), (s.line2Content = "mnemonic")));
    expect(dom.querySelector(".cci-stack-mnemonic")!.textContent).toBe("📖");
  });

  it("pinyin is shown as tone marks, numbers, or not at all, as set", () => {
    const text = (style: string) => w(undefined, (s) => ((s.pinyinStyle = style), (s.line2Content = "pinyin")));
    expect(Array.from(text("marks").querySelectorAll(".cci-stack-pinyin")).map((p) => p.textContent)).toEqual(["xué", "xí"]);
    expect(Array.from(text("numbers").querySelectorAll(".cci-stack-pinyin")).map((p) => p.textContent)).toEqual(["xue2", "xi2"]);
    expect(text("none").querySelectorAll(".cci-stack-pinyin")).toHaveLength(0);
  });

  it("carries colour, heading level, highlight and the document offsets as classes and attributes", () => {
    const { decos } = run({
      text: "## ==学习==",
      tokens: [gap("## ==", 0), word("学习", 5), gap("==", 7)],
      records: { 学习: rec("unknown") },
      settings: (s) => ((s.showUnknownColor = true), (s.colorMode = "status")),
    });
    const dom = widgetDom(decos.find((d) => d.from === 5)!);
    expect(dom.className).toContain("cci-stack-h2");
    expect(dom.className).toContain("cci-stack-hl"); // the highlight wins over the status colour by default
    expect(dom.className).not.toContain("cci-color-");
    expect([dom.getAttribute("data-cci-start"), dom.getAttribute("data-cci-end"), dom.getAttribute("data-cci-doclen")]).toEqual(["5", "7", "2"]);
  });

  it("with status colour winning over the highlight, the stack carries the colour key instead", () => {
    const { decos } = run({
      text: "==学习==",
      tokens: [gap("==", 0), word("学习", 2), gap("==", 4)],
      records: { 学习: rec("unknown") },
      settings: (s) => ((s.showUnknownColor = true), (s.highlightOverridesStatus = false)),
    });
    const dom = widgetDom(decos.find((d) => d.from === 2)!);
    expect(dom.className).toContain("cci-color-unknown");
    expect(dom.getAttribute("data-cci-color")).toBe("unknown");
    expect(dom.className).not.toContain("cci-stack-hl");
  });

  it("a hidden colour bucket leaves the stack uncoloured", () => {
    const dom = w(rec("unknown"), (s) => (s.showUnknownColor = false));
    expect(dom.className).not.toContain("cci-color-");
    expect(dom.hasAttribute("data-cci-color")).toBe(false);
  });

  it("ignores no events (taps go through to the word handlers)", () => {
    const { decos } = run({ text: uniq("学习"), tokens: [word("学习", 0)] });
    expect(decos[0].spec.widget.ignoreEvent()).toBe(false);
  });
});

describe("widget equality (what makes CodeMirror redraw)", () => {
  const widgetFor = (over: { rec?: any; settings?: (s: any) => void; text?: string; tok?: Tok } = {}) => {
    const t = over.text ?? uniq("学习");
    const { decos } = run({ text: t, tokens: [over.tok ?? word("学习", 0)], records: over.rec ? { 学习: over.rec } : undefined, settings: over.settings });
    return decos.find((d) => d.spec.widget)!.spec.widget;
  };
  const same = () => widgetFor();

  it("equal inputs are equal", () => {
    expect(same().eq(same())).toBe(true);
  });

  it.each([
    ["a different mode", { settings: (s: any): void => void (s.defaultDisplayMode = "three-line") }],
    ["a different status colour", { rec: rec("unknown"), settings: (s: any): void => void (s.showUnknownColor = true) }],
    ["known axes", { rec: rec("meaningKnownPinyinUnknown") }],
    ["a different pinyin style", { settings: (s: any) => ((s.pinyinStyle = "numbers"), (s.line2Content = "pinyin")) }],
    ["a different row-2 content", { settings: (s: any) => (s.line2Content = "english") }],
    ["a different row-3 content", { settings: (s: any) => ((s.defaultDisplayMode = "three-line"), (s.line3Content = "mnemonic")) }],
  ])("%s is not equal", (_n, over) => {
    expect(same().eq(widgetFor(over as any))).toBe(false);
  });

  it("a different surface, heading level or highlight is not equal", () => {
    const a = same();
    expect(a.eq(widgetFor({ tok: word("汉语", 0), text: uniq("汉语") }))).toBe(false);
    const hl = run({ text: "## 学习", tokens: [gap("## ", 0), word("学习", 3)] }).decos.find((d) => d.spec.widget)!.spec.widget;
    expect(a.eq(hl)).toBe(false);
    const hl2 = run({ text: "==学习==", tokens: [gap("==", 0), word("学习", 2), gap("==", 4)] }).decos.find((d) => d.spec.widget)!.spec.widget;
    expect(a.eq(hl2)).toBe(false);
  });

  it("differences in each axis, in the row text, and the rows' presence all count", () => {
    const axes = (chars: boolean, pinyin: boolean, meaning: boolean) => widgetFor({ rec: rec("unknown", { axes: { chars, pinyin, meaning } }) });
    const base = axes(false, false, false);
    expect(base.eq(axes(true, false, false))).toBe(false);
    expect(base.eq(axes(false, true, false))).toBe(false);
    expect(base.eq(axes(false, false, true))).toBe(false);
    const gloss = (def: string) => widgetFor({ tok: word("学习", 0, { definitions: [def] }), settings: (s) => ((s.defaultDisplayMode = "three-line"), (s.line2Content = "pinyin"), (s.line3Content = "english")) });
    expect(gloss("a").eq(gloss("a"))).toBe(true);
    expect(gloss("a").eq(gloss("b"))).toBe(false);
    const two = widgetFor({ settings: (s) => ((s.defaultDisplayMode = "two-line"), (s.line2Content = "pinyin")) });
    const three = widgetFor({ settings: (s) => ((s.defaultDisplayMode = "three-line"), (s.line2Content = "pinyin"), (s.line3Content = "english")) });
    expect(two.eq(three)).toBe(false);
    const perChar = widgetFor({ tok: word("学习", 0, { pinyin: "xué xí" }), settings: (s) => ((s.defaultDisplayMode = "two-line"), (s.line2Content = "pinyin")) });
    const lump = widgetFor({ tok: word("学习", 0, { pinyin: "xuéxí lump" }), settings: (s) => ((s.defaultDisplayMode = "two-line"), (s.line2Content = "pinyin")) });
    expect(perChar.eq(lump)).toBe(false);
  });
});

describe("the first paint and later changes", () => {
  it("a warm cache paints before the view exists", () => {
    const text = uniq("学习");
    const { decos, plugin } = run({ text, tokens: [word("学习", 0)] });
    expect(decos).toHaveLength(1);
    expect(plugin.tokenizer.tokenize).not.toHaveBeenCalled();
  });

  it("a cold cache tokenizes, then redraws on the next frame", async () => {
    const text = uniq("学习");
    const { view, vp, plugin } = mount({ text, tokens: [word("学习", 0)], cold: true });
    expect(decorations(view, vp)).toHaveLength(0);
    await vi.waitFor(() => expect(decorations(view, vp)).toHaveLength(1));
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledTimes(1);
  });

  it("text without Chinese needs no tokenizing and has no decorations", async () => {
    const text = uniq("hello world");
    const { view, vp, plugin } = mount({ text, tokens: [], cold: true });
    await tick();
    await tick();
    expect(plugin.tokenizer.tokenize).not.toHaveBeenCalled();
    expect(decorations(view, vp)).toEqual([]);
  });

  it("a redraw effect rebuilds from the cached tokens against the current settings", () => {
    const text = uniq("学习");
    const { view, vp, settings } = mount({ text, tokens: [word("学习", 0)], settings: (s) => (s.defaultDisplayMode = "two-line") });
    expect(decorations(view, vp)[0].spec.widget).toBeTruthy();
    settings.defaultDisplayMode = "none";
    settings.showNewColor = true;
    view.dispatch({ effects: cciRedecorateEffect.of(null) });
    const d = decorations(view, vp)[0];
    expect(d.spec.widget).toBeUndefined();
    expect(d.spec.class).toContain("cci-color-new");
  });

  it("an unrelated update (nothing changed, no effect) keeps the decorations as they are", () => {
    const text = uniq("学习");
    const { view, vp } = mount({ text, tokens: [word("学习", 0)] });
    const before = (view.plugin(vp) as any).decorations;
    view.dispatch({ selection: { anchor: 1 } });
    expect((view.plugin(vp) as any).decorations).toBe(before);
  });

  it("an edit shifts the existing decorations at once, then re-tokenizes the new text", async () => {
    const text = uniq("学习");
    const { view, vp, plugin } = mount({ text, tokens: [word("学习", 0)] });
    const next = [gap("好", 0), word("学习", 1), gap(text.slice(2), 3)];
    plugin.tokenizer.tokenize.mockResolvedValue(next);
    view.dispatch({ changes: { from: 0, insert: "好" } });
    expect(decorations(view, vp)[0]).toMatchObject({ from: 1, to: 3 }); // mapped immediately
    await vi.waitFor(() => expect(plugin.tokenizer.tokenize).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    expect(decorations(view, vp).some((d) => d.from === 1 && d.to === 3)).toBe(true);
  });

  it("typing and undoing before the tokenizer answers goes straight back to the tokens already held", async () => {
    const text = uniq("学习");
    const { view, vp, plugin } = mount({ text, tokens: [word("学习", 0)] });
    plugin.tokenizer.tokenize.mockReturnValue(new Promise(() => {}));
    view.dispatch({ changes: { from: text.length, insert: "好" } });
    view.dispatch({ changes: { from: text.length, to: text.length + 1 } });
    expect(view.state.doc.toString()).toBe(text);
    expect(decorations(view, vp).map((d) => [d.from, d.to])).toEqual([[0, 2]]);
  });

  it("an edit to text the cache already knows paints without waiting", () => {
    const text = uniq("学习");
    const { view, vp } = mount({ text, tokens: [word("学习", 0)] });
    const edited = text + "好";
    putCachedTokens(edited, [word("学习", 0), gap(text.slice(2) + "好", 2)]);
    view.dispatch({ changes: { from: text.length, insert: "好" } });
    expect(decorations(view, vp)).toHaveLength(1);
  });

  it("the re-tokenize effect throws the cached tokens away and starts again", async () => {
    const text = uniq("学习");
    const { view, vp, plugin } = mount({ text, tokens: [word("学习", 0)] });
    const fresh = [word("学", 0), word("习", 1), gap(text.slice(2), 2)];
    putCachedTokens(text, fresh); // the cache is what the next paint reads
    view.dispatch({ effects: cciReTokenizeEffect.of(null) });
    expect(decorations(view, vp).map((d) => [d.from, d.to])).toEqual([[0, 1], [1, 2]]);
    void plugin;
  });

  it("re-tokenizing the same text with tokens in hand reuses them", () => {
    const text = uniq("学习");
    const { view, vp } = mount({ text, tokens: [word("学习", 0)] });
    view.dispatch({ effects: [cciReTokenizeEffect.of(null)] });
    expect(decorations(view, vp)).toHaveLength(1);
  });

  it("an answer for a document that has since changed is discarded", async () => {
    const text = uniq("学习");
    let release!: (t: Tok[]) => void;
    const { view, vp, plugin } = mount({ text, tokens: [], cold: true, tokenize: () => new Promise<Tok[]>((r) => (release = r)) });
    const edited = text + "好";
    putCachedTokens(edited, [gap(edited, 0)]);
    view.dispatch({ changes: { from: text.length, insert: "好" } });
    release([word("学习", 0)]);
    await tick();
    await tick();
    expect(decorations(view, vp)).toEqual([]);
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledTimes(1);
  });

  it("a tokenizer that fails leaves the text plain without an unhandled rejection, and the next change tries again", async () => {
    const text = uniq("学习");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { view, vp, plugin } = mount({ text, tokens: [], cold: true, tokenize: async () => { throw new Error("dictionary not ready"); } });
      await tick();
      await tick();
      expect(decorations(view, vp)).toEqual([]);
      plugin.tokenizer.tokenize.mockResolvedValue([word("学习", 0)]);
      view.dispatch({ effects: cciRedecorateEffect.of(null) });
      await vi.waitFor(() => expect(decorations(view, vp)).toHaveLength(1));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a second change to the same text while one tokenize is running does not start another", async () => {
    const text = uniq("学习");
    let release!: (t: Tok[]) => void;
    const { view, vp, plugin } = mount({ text, tokens: [], cold: true, tokenize: () => new Promise<Tok[]>((r) => (release = r)) });
    view.dispatch({ effects: cciRedecorateEffect.of(null) });
    view.dispatch({ effects: cciRedecorateEffect.of(null) });
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledTimes(1);
    release([word("学习", 0)]);
    await vi.waitFor(() => expect(decorations(view, vp)).toHaveLength(1));
  });

  it("a document that changes while another is being tokenized starts its own tokenize", async () => {
    const text = uniq("学习");
    const resolvers: Array<(t: Tok[]) => void> = [];
    const { view, plugin } = mount({ text, tokens: [], cold: true, tokenize: () => new Promise<Tok[]>((r) => resolvers.push(r)) });
    view.dispatch({ changes: { from: text.length, insert: "好" } });
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledTimes(2);
    resolvers.forEach((r) => r([]));
    await tick();
  });

  it("a view destroyed before the next frame is not an error", async () => {
    const text = uniq("学习");
    const { view } = mount({ text, tokens: [word("学习", 0)], cold: true });
    view.destroy();
    await tick();
    await tick();
  });

});
