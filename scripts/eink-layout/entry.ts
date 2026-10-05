/**
 * Browser-side half of scripts/check-eink-layout.mjs. Bundled by that script and
 * run in headless Chromium; it is NOT part of the plugin.
 *
 * It mounts REAL CodeMirror editors using the REAL RubyWidget (the script exposes
 * the class with a load-time transform, so src/ is untouched) and the real
 * styles.css, then measures what E-ink mode does to the layout across every
 * combination of the controls a reader can resize. The first version of this
 * harness hand-wrote the annotated-word markup and so missed the default
 * per-character layout entirely; generating it from the widget is the point.
 *
 * Tasks (chosen with the query string the script injects as window.__QS):
 *   matrix  one display mode, every font x spacing x annotation x number-size cell
 *   extras  edit-mode guard, and one-number-per-word at every width that splits a word
 *   rects   layout of every config with E-ink OFF, for the "off is inert" comparison
 */
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { RubyWidget } from "../../src/editor/chineseDecorations";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

// ---- Obsidian augments the DOM with these; RubyWidget.toDOM() relies on them. Same
// semantics as the app: the global form makes a DETACHED element, the method form
// makes AND appends.
const mkEl = (tag: string, o?: any) => {
  const el = document.createElement(tag);
  if (o?.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
  if (o?.text != null) el.textContent = o.text;
  return el;
};
(globalThis as any).createSpan = (o?: any) => mkEl("span", o);
(globalThis as any).createDiv = (o?: any) => mkEl("div", o);
(globalThis as any).createEl = (t: string, o?: any) => mkEl(t, o);
for (const [name, tag] of [["createSpan", "span"], ["createDiv", "div"]] as const)
  (HTMLElement.prototype as any)[name] = function (o?: any) { const el = mkEl(tag, o); this.appendChild(el); return el; };
(HTMLElement.prototype as any).createEl = function (t: string, o?: any) { const el = mkEl(t, o); this.appendChild(el); return el; };

const Q = new URLSearchParams((window as any).__QS ?? location.search);

type Cfg = {
  mode: "none" | "two-line" | "three-line";
  branch: "plain" | "perchar" | "wordcell";
  len: 1 | 2 | 4; font: number; spacing: number; annot: number;
  heading?: number; mixed?: boolean;
};

const WORDS: Record<number, string[]> = {
  1: ["好", "学", "难", "新", "高", "大", "小"],
  2: ["你好", "学习", "聊天", "经济", "政府", "繁荣", "朋友"],
  4: ["一心一意", "学而不厌", "自由自在", "朋友之间", "经济发展", "政府工作", "繁荣昌盛"],
};
const SYL = ["wǒ", "nǐ", "hǎo", "xué", "xí", "liáo", "tiān", "jīng", "jì", "zhèng", "fǔ", "fán", "róng", "péng", "yǒu"];
// Alternate long and short glosses so that sometimes the translation row is the widest
// row and sometimes the characters are: the gutter only matters in the second case.
const LONG = "to chat; informal conversation (colloquial usage)";
const SHORT = "hi";

const SCALES = (Q.get("scales") ?? "100").split(",").map(Number);
const FLOOR = Number(Q.get("floor") ?? 9);
const px = (s: string) => parseFloat(s);
const shown = (c: string) => !!c && c !== "none" && c !== "normal" && c !== '""';
/** Emulates the re-measure the plugin always gets: every setting change redecorates, which
 *  dispatches a transaction. Without it CodeMirror's cached heights go stale after an
 *  out-of-band CSS change and posAtCoords resolves to the wrong word (measured: 38 mis-hits). */
const settle = (v: EditorView) => (v as any).measure(true);

function mount(cfg: Cfg, editable = false) {
  document.body.innerHTML = "";
  const toks: any[] = [];
  let doc = "我";
  WORDS[cfg.len].forEach((w, i) => {
    if (i) doc += "说";
    const start = doc.length;
    doc += w;
    const sy = Array.from({ length: Array.from(w).length }, (_, k) => SYL[(i * 3 + k) % SYL.length]).join(" ");
    toks.push({ start, end: start + w.length, surface: w, isWord: true, confidence: 1, candidates: [], selected: { simplified: w, pinyin: sy, definitions: [i % 2 ? SHORT : LONG] } });
  });
  doc += "。";
  const settings: any = { ...DEFAULT_SETTINGS, line2Content: cfg.branch === "wordcell" ? "english" : "pinyin", line3Content: "english", pinyinStyle: "marks", stripGlossParentheticals: false };
  const root = document.createElement("div");
  root.className = "cci-view";
  root.setAttribute("data-display", cfg.mode);
  // The CSS variables the real view writes (applyReaderFont / applyReaderLineSpacing / applyAnnotationScales).
  // The e-ink floor is deliberately NOT set: the shipped fallback in styles.css is what gets measured.
  root.style.cssText = `width:${Q.get("w") ?? 9000}px;--cci-reader-font:${cfg.font}px;--cci-line-spacing:${cfg.spacing};--cci-annotation-scale:${cfg.annot / 100};`;
  const host = document.createElement("div");
  host.className = "cci-editor";
  root.appendChild(host);
  document.body.appendChild(root);
  const b = new RangeSetBuilder<Decoration>();
  toks.forEach((t, i) => {
    const key = `hsk-${i + 1}`;
    // Known words take the plain-mark path even inside a ruby-mode line (chineseDecorations.ts
    // `wantsRuby`), so a "mixed" line puts plain marks and stacks side by side.
    const plain = cfg.mode === "none" || (cfg.mixed && i % 2 === 1);
    if (plain) b.add(t.start, t.end, Decoration.mark({ class: `cci-word cci-color-${key}`, attributes: { "data-cci-surface": t.surface } }));
    else {
      const rec: any = { status: "unknown", axes: { chars: false, pinyin: false, meaning: false }, surfaces: [t.surface] };
      b.add(t.start, t.end, Decoration.replace({ widget: new RubyWidget(t.surface, t, rec, cfg.mode, settings, cfg.heading ?? 0, key as any, undefined), inclusive: false }));
    }
  });
  const deco = b.finish();
  const view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions: [EditorView.lineWrapping, EditorView.editable.of(editable), EditorView.decorations.of(deco), EditorView.atomicRanges.of(() => deco)] }) });
  return { view, root, toks };
}

function snapshot(view: EditorView) {
  const dom = view.contentDOM;
  const line = dom.querySelector(".cm-line") as HTMLElement;
  const words = [...dom.querySelectorAll(".cci-word")] as HTMLElement[];
  return { lineH: line.getBoundingClientRect().height, words: words.map((w) => { const r = w.getBoundingClientRect(); return { w, left: r.left, width: r.width, top: r.top, h: r.height }; }) };
}

const fails: Record<string, { n: number; ex: string[] }> = {};
const stat: any = { cells: 0, maxNumberLineDelta: 0, maxUnderlineLineDelta: 0, maxRatio: 0, maxClickErr: 0 };
const fail = (code: string, key: string, detail: string) => {
  const f = (fails[code] ??= { n: 0, ex: [] });
  f.n++;
  if (f.ex.length < 5) f.ex.push(`${key} :: ${detail}`);
};
const probeWidth = (root: HTMLElement, text: string, size: number) => {
  const p = document.createElement("span");
  p.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:${size}px;font-weight:700`;
  p.textContent = text;
  root.appendChild(p);
  const w = p.getBoundingClientRect().width;
  p.remove();
  return w;
};

function runConfig(cfg: Cfg) {
  const key = `${cfg.mode}/${cfg.branch}${cfg.mixed ? "+mixed" : ""}/len${cfg.len}/font${cfg.font}/spacing${cfg.spacing}/annot${cfg.annot}${cfg.heading ? "/heading" : ""}`;
  const { view, root, toks } = mount(cfg);
  const rows = (v: HTMLElement | null) => { if (!v) return null; const g = (sel: string) => { const e = v.querySelector(sel) as HTMLElement | null; if (!e) return null; const c = getComputedStyle(e); return `${c.fontSize}|${c.lineHeight}`; }; return { pinyin: g(".cci-stack-pinyin"), gloss: g(".cci-stack-gloss") }; };
  const off = snapshot(view);
  const offRows = rows(view.contentDOM.querySelector(".cci-stack"));
  root.setAttribute("data-eink", "");
  settle(view);
  for (const sc of SCALES) {
    root.style.setProperty("--cci-eink-number-scale", String(sc / 100));
    settle(view);
    stat.cells++;
    const k = `${key}/size${sc}`;
    // The underline alone (numbers suppressed by the script's test-only stylesheet) separates
    // two different effects: what the NUMBER does, and what the thicker underline does.
    root.classList.add("no-num");
    const underline = snapshot(view);
    root.classList.remove("no-num");
    const on = snapshot(view);

    const numberDelta = Math.abs(on.lineH - underline.lineH);
    stat.maxNumberLineDelta = Math.max(stat.maxNumberLineDelta, numberDelta);
    if (numberDelta > 0.5) fail("number-changes-line-height", k, `${underline.lineH.toFixed(2)} -> ${on.lineH.toFixed(2)}`);
    const underlineDelta = Math.abs(underline.lineH - off.lineH);
    stat.maxUnderlineLineDelta = Math.max(stat.maxUnderlineLineDelta, underlineDelta);
    // The underline is a text-decoration, which has no layout effect. A thicker border used to add 1-2px
    // to a line in two/three-line mode at tight spacing; if that comes back this fails.
    if (underlineDelta > 0.5) fail("underline-changes-line-height", k, `${off.lineH.toFixed(2)} -> ${underline.lineH.toFixed(2)}`);

    const s0 = view.contentDOM.querySelector(".cci-stack") as HTMLElement | null;
    if (s0 && offRows) {
      const now = rows(s0);
      if (now?.pinyin !== offRows.pinyin || now?.gloss !== offRows.gloss) fail("annotation-rows-changed", k, JSON.stringify({ was: offRows, now }));
    }

    if (sc === SCALES[0]) {
      // Both kinds of word must carry the SAME underline, drawn from the same font at the same baseline.
      // A border put them at different heights (the gap is (ascent + descent - 1)/2 em of the font in use,
      // so it varies by font and no fixed offset fixes it). Geometry of a decoration is not exposed to
      // script, so this checks what determines it: the decoration, the font, and that no border is drawn.
      const sig = (w: HTMLElement) => {
        const stack = w.classList.contains("cci-stack");
        const el = (stack ? w.querySelector(".cci-stack-chars") : w) as HTMLElement;
        const c = getComputedStyle(el);
        const own = getComputedStyle(w);
        return { stack, line: c.textDecorationLine, style: c.textDecorationStyle, thick: c.textDecorationThickness, offset: c.textUnderlineOffset, colour: c.textDecorationColor, font: c.fontSize + c.fontFamily, border: own.borderBottomWidth + " " + own.borderBottomColor, ownLine: own.textDecorationLine };
      };
      const sigs = on.words.map((o) => sig(o.w));
      const ref = sigs[0];
      sigs.forEach((g, i) => {
        const same = g.line === ref.line && g.style === ref.style && g.thick === ref.thick && g.offset === ref.offset && g.colour === ref.colour && g.font === ref.font;
        if (!same) fail("underline-differs-between-kinds-of-word", key, `word${i + 1} ${JSON.stringify(g)} vs ${JSON.stringify(ref)}`);
        // The border stays (1px, to keep the layout identical to colour mode) but must be invisible; a visible one
        // would be a second underline at a different height.
        if (g.border !== "1px rgba(0, 0, 0, 0)") fail("visible-border-underline-reintroduced", key, `word${i + 1} border-bottom ${g.border}`);
        // Declared on the annotated word's own box it would also underline the pinyin and translation rows.
        if (g.stack && g.ownLine !== "none") fail("decoration-on-annotated-box", key, `word${i + 1} ${g.ownLine}`);
      });
    }
    on.words.forEach((o, i) => {
      const w = o.w;
      const level = i + 1;
      const isStack = w.classList.contains("cci-stack");
      const cells = isStack ? ([...w.querySelectorAll(".cci-stack-cell")] as HTMLElement[]) : [];
      const last = isStack ? cells[cells.length - 1] : w;
      const contents = isStack ? cells.map((c) => getComputedStyle(c, "::after").content) : [getComputedStyle(w, "::after").content];
      const nShown = contents.filter(shown).length;
      if (nShown !== 1 || (isStack && !shown(contents[contents.length - 1]))) fail("not-exactly-one-number", k, `word${level} stack=${isStack} ${contents.join(",")}`);

      const pseudo = getComputedStyle(last, "::after");
      const numPx = px(pseudo.fontSize);
      const charsPx = px(getComputedStyle((isStack ? w.querySelector(".cci-stack-chars") : w) as HTMLElement).fontSize);
      const ratio = numPx / charsPx;
      stat.maxRatio = Math.max(stat.maxRatio, ratio);
      if (ratio > 0.8 + 1e-6) fail("number-too-large-vs-character", k, `${numPx.toFixed(2)} / ${charsPx.toFixed(2)} = ${ratio.toFixed(3)}`);
      // The number is em of the CELL (so it follows the reader font and ignores annotation size).
      const cellPx = px(getComputedStyle(last).fontSize);
      const model = Math.max(0.55 * cellPx * (sc / 100), FLOOR);
      if (Math.abs(model - numPx) > 0.15) fail("size-not-following-font-or-ignoring-annotation", k, `${numPx.toFixed(2)} vs ${model.toFixed(2)}`);

      if (isStack) {
        const gutter = px(getComputedStyle(last).paddingRight);
        const dw = probeWidth(root, String(level), numPx);
        if (gutter + 0.01 < dw + 0.05 * numPx + 1) fail("gutter-narrower-than-number", k, `${gutter.toFixed(2)} < ${dw.toFixed(2)}+${(0.05 * numPx).toFixed(2)}+1`);
        const nh = px(pseudo.height);
        const ch = (w.querySelector(".cci-stack-chars") as HTMLElement).getBoundingClientRect().height;
        if (Number.isFinite(nh) && nh > ch + 0.5) fail("number-taller-than-character-row", k, `${nh.toFixed(2)} > ${ch.toFixed(2)}`);
        // Width model: a word is as wide as its widest row, so the gutter widens it only when
        // the characters row is the widest. expected = max(0, cells + gutter - widthOff).
        const cellsW = cells.reduce((a, c) => a + c.getBoundingClientRect().width, 0) - gutter;
        const dW = o.width - off.words[i].width;
        const expect = Math.max(0, cellsW + gutter - off.words[i].width);
        if (Math.abs(dW - expect) > 0.6) fail("word-width-delta-unexplained", k, `word${level} ${dW.toFixed(2)} vs ${expect.toFixed(2)}`);
      }
    });

    on.words.forEach((o, i) => {
      const t = toks[i];
      const y = o.top + o.h / 2;
      for (const x of [o.left + o.width / 2, o.left + o.width - 1.5]) {
        const pos = view.posAtCoords({ x, y });
        const err = pos == null ? 99 : pos < t.start ? t.start - pos : pos > t.end ? pos - t.end : 0;
        stat.maxClickErr = Math.max(stat.maxClickErr, err);
        if (err) fail("click-lands-on-wrong-word", k, `word${i + 1} x=${x.toFixed(1)} -> ${pos} want ${t.start}..${t.end}`);
      }
    });
  }
  view.destroy();
}

function* configs(mode: string): Generator<Cfg> {
  // Real ranges: font 12 is the clamp floor (UI min 14), 48 the clamp max (UI max 40);
  // line spacing 0.15 is the slider's minimum and 1.5 its clamp max.
  const fonts = [12, 14, 22, 40, 48], spacings = [0.15, 0.3, 0.5, 1.0, 1.2, 1.5], annots = [50, 100, 200], lens: (1 | 2 | 4)[] = [1, 2, 4];
  if (mode === "none") {
    for (const len of lens) for (const font of fonts) for (const spacing of spacings) yield { mode: "none", branch: "plain", len, font, spacing, annot: 100 };
    return;
  }
  // The two widget DOM branches: per-character cells (line 2 = pinyin and syllables = characters,
  // i.e. almost every ordinary word, and the default) and the single word cell.
  for (const branch of ["perchar", "wordcell"] as const)
    for (const len of lens) for (const font of fonts) for (const spacing of spacings) for (const annot of annots)
      yield { mode: mode as any, branch, len, font, spacing, annot };
  for (const len of lens) for (const font of [14, 22, 40]) for (const spacing of [0.15, 1.0]) for (const annot of [50, 200])
    yield { mode: mode as any, branch: "perchar", len, font, spacing, annot, mixed: true };
  for (const len of [1, 2] as const) for (const font of [22, 40]) yield { mode: mode as any, branch: "perchar", len, font, spacing: 1.0, annot: 100, heading: 1 };
}

function editModeGuard() {
  const out: Record<string, string> = {};
  for (const editable of [true, false]) {
    const { view, root } = mount({ mode: "none", branch: "plain", len: 2, font: 22, spacing: 1, annot: 100 }, editable);
    root.setAttribute("data-eink", "");
    out[editable ? "editable" : "readonly"] = getComputedStyle(view.contentDOM.querySelector(".cci-word") as HTMLElement, "::after").content;
    view.destroy();
  }
  return out;
}

/** CJK words wrap mid-word constantly. At every container width where one does, each word must
 *  still carry exactly one number. (An absolutely positioned number was stranded in exactly
 *  these cases.) */
function splitWords() {
  let widths = 0, wrong = 0, detached = 0;
  for (let w = 300; w <= 700; w += 2) {
    const { view, root } = mount({ mode: "none", branch: "plain", len: 2, font: 22, spacing: 1, annot: 100 });
    root.style.width = w + "px";
    root.setAttribute("data-eink", "");
    settle(view);
    const els = [...view.contentDOM.querySelectorAll(".cci-word")] as HTMLElement[];
    if (els.some((e) => e.getClientRects().length > 1)) {
      widths++;
      if (els.filter((e) => shown(getComputedStyle(e, "::after").content)).length !== els.length) wrong++;
      // The number must stay with its word. Without a word joiner a break was allowed between the last
      // character and the number, and at the end of a line the number dropped to the next line alone:
      // its piece of the word is then no wider than the digit.
      let bad = false;
      for (const e of els) {
        const rs = [...e.getClientRects()];
        if (rs.length > 1) { const numPx = parseFloat(getComputedStyle(e, "::after").fontSize); if (rs[rs.length - 1].width <= numPx * 1.3) bad = true; }
      }
      if (bad) detached++;
    }
    view.destroy();
  }
  return { widths, wrong, detached };
}

function rects() {
  const all: number[][] = [];
  for (const mode of ["none", "two-line", "three-line"]) for (const cfg of configs(mode)) {
    const { view } = mount(cfg);
    const s = snapshot(view);
    all.push([Number(s.lineH.toFixed(3)), ...s.words.flatMap((o) => [o.left, o.width, o.top, o.h].map((n) => Number(n.toFixed(3))))]);
    view.destroy();
  }
  return all;
}

const task = Q.get("task") ?? "matrix";
const t0 = performance.now();
let result: any;
if (task === "matrix") {
  for (const cfg of configs(Q.get("display") ?? "none")) runConfig(cfg);
  result = { task, ms: Math.round(performance.now() - t0), stat, fails };
} else if (task === "extras") {
  result = { task, edit: editModeGuard(), split: splitWords() };
} else if (task === "rects") {
  result = { task, rects: rects() };
}
document.documentElement.setAttribute("data-result", JSON.stringify(result));
