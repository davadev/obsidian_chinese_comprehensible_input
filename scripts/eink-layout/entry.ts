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
 *   highlight  computed colours of every kind of highlight, E-ink on and off
 *   bottoms    where a plain word's tint ends vs an annotated word's, per font and heading level
 *   headings   plain word marks inside Markdown headings: is the mark as big as the text in it?
 *   rows       computed colours of the pinyin / translation / mnemonic / characters rows
 */
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { RubyWidget } from "../../src/editor/chineseDecorations";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { cciMarkdownHighlight } from "../../src/editor/markdownHighlight";
import { wordMarkClass } from "../../src/editor/wordMarkClass";
import { installObsidianDom } from "../../src/tests/__mocks__/obsidianDom";

// Obsidian augments the DOM with createDiv/createSpan/createEl & co.; RubyWidget.toDOM() relies on them. The same
// fixture the unit tests use, so the two cannot drift (src/tests/__mocks__/obsidianDom.ts).
installObsidianDom();

const Q = new URLSearchParams((window as any).__QS ?? location.search);

type Cfg = {
  mode: "none" | "two-line" | "three-line";
  branch: "plain" | "perchar" | "wordcell";
  len: 1 | 2 | 4; font: number; spacing: number; annot: number;
  heading?: number; mixed?: boolean;
  /** Real notes are runs of ADJACENT word spans with no separator: repeat the word list `reps` times, no filler. */
  adjacent?: number;
  /** Colour the words by status (known/partial/unknown/new) instead of HSK level. */
  palette?: "status";
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

function mount(cfg: Cfg, editable = false, keep = false) {
  if (!keep) document.body.innerHTML = "";
  const toks: any[] = [];
  let doc = "我";
  const list = Array.from({ length: cfg.adjacent ?? 1 }, () => WORDS[cfg.len]).flat();
  list.forEach((w, i) => {
    if (i && !cfg.adjacent) doc += "说";
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
    const key = cfg.palette === "status" ? ["known", "partial", "unknown", "new"][i % 4] : `hsk-${(i % 7) + 1}`;
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
  p.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:var(--font-interface,system-ui,sans-serif);font-size:${size}px;font-weight:700`;
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
        return { stack, line: c.textDecorationLine, style: c.textDecorationStyle, thick: c.textDecorationThickness, offset: c.textUnderlineOffset, pos: c.textUnderlinePosition, colour: c.textDecorationColor, font: c.fontSize + c.fontFamily, border: own.borderBottomWidth + " " + own.borderBottomColor, ownLine: own.textDecorationLine };
      };
      const sigs = on.words.map((o) => sig(o.w));
      const ref = sigs[0];
      sigs.forEach((g, i) => {
        const same = g.line === ref.line && g.style === ref.style && g.thick === ref.thick && g.offset === ref.offset && g.pos === ref.pos && g.colour === ref.colour && g.font === ref.font;
        if (!same) fail("underline-differs-between-kinds-of-word", key, `word${i + 1} ${JSON.stringify(g)} vs ${JSON.stringify(ref)}`);
        // The border stays (1px, to keep the layout identical to colour mode) but must be invisible, or absent (0px) on a numbered plain word, where an inline-block would count it toward the line height; a visible one
        // would be a second underline at a different height.
        if (g.border !== "1px rgba(0, 0, 0, 0)" && !g.border.startsWith("0px ")) fail("visible-border-underline-reintroduced", key, `word${i + 1} border-bottom ${g.border}`);
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
      // The number follows the characters row of the LAST cell (plain words: the word itself).
      const charsOf = (c: HTMLElement) => c.querySelector(".cci-stack-chars") as HTMLElement;
      const contents = isStack ? cells.map((c) => getComputedStyle(charsOf(c), "::after").content) : [getComputedStyle(w, "::after").content];
      const nShown = contents.filter(shown).length;
      if (nShown !== 1 || (isStack && !shown(contents[contents.length - 1]))) fail("not-exactly-one-number", k, `word${level} stack=${isStack} ${contents.join(",")}`);

      const pseudo = getComputedStyle(isStack ? charsOf(last) : last, "::after");
      const numPx = px(pseudo.fontSize);
      const charsPx = px(getComputedStyle((isStack ? w.querySelector(".cci-stack-chars") : w) as HTMLElement).fontSize);
      const ratio = numPx / charsPx;
      stat.maxRatio = Math.max(stat.maxRatio, ratio);
      if (ratio > 0.8 + 1e-6) fail("number-too-large-vs-character", k, `${numPx.toFixed(2)} / ${charsPx.toFixed(2)} = ${ratio.toFixed(3)}`);
      // The number follows the READER font (not the heading-scaled characters, not the annotation size).
      const model = Math.max(0.55 * cfg.font * (sc / 100), FLOOR);
      if (Math.abs(model - numPx) > 0.15) fail("size-not-following-font-or-ignoring-annotation", k, `${numPx.toFixed(2)} vs ${model.toFixed(2)}`);

      if (isStack) {
        const gutter = px(getComputedStyle(last).paddingRight);
        const dw = probeWidth(root, String(level), numPx);
        if (gutter + 0.01 < dw + 0.05 * numPx + 0.5) fail("gutter-narrower-than-number", k, `${gutter.toFixed(2)} < ${dw.toFixed(2)}+${(0.05 * numPx).toFixed(2)}+0.5`);
        const nh = px(pseudo.height);
        const ch = (w.querySelector(".cci-stack-chars") as HTMLElement).getBoundingClientRect().height;
        if (Number.isFinite(nh) && nh > ch + 0.5) fail("number-taller-than-character-row", k, `${nh.toFixed(2)} > ${ch.toFixed(2)}`);
        // Width model: a word is as wide as its widest row, so the gutter widens it only when
        // the characters row is the widest. expected = max(0, cells + gutter - widthOff).
        const cellsW = cells.reduce((a, c) => a + c.getBoundingClientRect().width, 0) - gutter;
        const dW = o.width - off.words[i].width;
        const expect = Math.max(0, cellsW + gutter - off.words[i].width);
        if (Math.abs(dW - expect) > 0.6) fail("word-width-delta-unexplained", k, `word${level} ${dW.toFixed(2)} vs ${expect.toFixed(2)}`);
      } else {
        // A plain word's number is out of flow in a gutter on the word itself. The gutter must hold the digit
        // (else it overlaps the next character), the word must not wrap (an atomic box, so the number cannot be separated
        // from it, and NOT nowrap: that removed the break between adjacent words in WebKit), and the word is exactly one gutter wider than without E-ink mode.
        const cs = getComputedStyle(w);
        const gutter = px(cs.paddingRight);
        const dw = probeWidth(root, String(level), numPx);
        if (gutter + 0.01 < dw + 0.05 * numPx + 0.5) fail("gutter-narrower-than-number", k, `plain word${level} ${gutter.toFixed(2)} < ${dw.toFixed(2)}+${(0.05 * numPx).toFixed(2)}+0.5`);
        if (cs.display !== "inline-block") fail("numbered-word-not-atomic", k, `word${level} display ${cs.display}`);
        const dW = o.width - off.words[i].width;
        if (Math.abs(dW - gutter) > 0.6) fail("plain-word-width-delta-unexplained", k, `word${level} ${dW.toFixed(2)} vs gutter ${gutter.toFixed(2)}`);
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

/** CJK words wrap mid-word constantly, so a number that is out of flow was once stranded at the far edge
 *  of the line. A numbered plain word is `white-space: nowrap` now. At every container width: it must
 *  never be split across two lines (so the number can never be separated from it), it must carry exactly
 *  one number, and the text must still wrap somewhere (otherwise the check proves nothing). */
function splitWords() {
  let wrapped = 0, wrong = 0, split = 0;
  for (let w = 300; w <= 700; w += 2) {
    const { view, root } = mount({ mode: "none", branch: "plain", len: 2, font: 22, spacing: 1, annot: 100 });
    root.style.width = w + "px";
    root.setAttribute("data-eink", "");
    settle(view);
    const els = [...view.contentDOM.querySelectorAll(".cci-word")] as HTMLElement[];
    if (new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size > 1) wrapped++;
    if (els.filter((e) => shown(getComputedStyle(e, "::after").content)).length !== els.length) wrong++;
    if (els.some((e) => e.getClientRects().length > 1)) split++;
    view.destroy();
  }
  return { wrapped, wrong, split };
}

/** Where the underline and the digit are drawn, so the PIXELS can be compared by the caller. A decoration
 *  has no DOM rect, so this reports each word's box and the screenshot supplies the rest. `installed` is
 *  false when `ff` is not a font on this machine (its Latin glyphs would then be the same fallback under two
 *  different generic families), so the caller skips fonts that silently fell back. */
function fontInstalled(ff: string) {
  if (ff === "sans-serif") return true;
  const probe = (fallback: string) => { const s = document.createElement("span"); s.textContent = "mmmmmmWWWWiiii"; s.style.cssText = `position:absolute;visibility:hidden;font-size:40px;font-family:"${ff}",${fallback}`; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
  return probe("serif") === probe("monospace");
}
function geom() {
  document.body.innerHTML = "";
  document.body.style.cssText = "margin:0;padding:8px;background:#fff;color:#000";
  const ff = Q.get("ff") ?? "sans-serif";
  if (!fontInstalled(ff)) return { installed: false, rows: [], height: 0 };
  const sizes = (Q.get("sizes") ?? "14,22,40,48").split(",").map(Number);
  const rows: any[] = [];
  for (const kind of (Q.get("kinds") ?? "plain,stack,stack3,wordcell").split(",")) for (const size of sizes) for (const sc of SCALES) {
    const cfg: Cfg = kind === "plain" ? { mode: "none", branch: "plain", len: 2, font: size, spacing: 1, annot: 100 }
      : kind === "stack3" ? { mode: "three-line", branch: "perchar", len: 2, font: size, spacing: 1, annot: 100 }
      : kind === "wordcell" ? { mode: "two-line", branch: "wordcell", len: 2, font: size, spacing: 1, annot: 100 }
      : { mode: "two-line", branch: "perchar", len: 2, font: size, spacing: 1, annot: 100 };
    const m = mount(cfg, false, true);
    // On .cm-scroller, not the root: CodeMirror gives the scroller its own font-family, so a font set on an ancestor is
    // silently ignored (every "font" in beta.4's measurement was the same one).
    m.view.scrollDOM.style.fontFamily = ff === "sans-serif" ? ff : `"${ff}", sans-serif`; m.root.style.width = "1100px"; m.root.style.margin = "6px 0";
    m.root.setAttribute("data-eink", ""); m.root.style.setProperty("--cci-eink-number-scale", String(sc / 100)); settle(m.view);
    const words = ([...m.view.contentDOM.querySelectorAll(".cci-word")] as HTMLElement[]).map((w, i) => {
      const stack = w.classList.contains("cci-stack");
      const r = w.getBoundingClientRect();
      const cells = [...w.querySelectorAll(".cci-stack-cell")] as HTMLElement[];
      const chars = stack ? (w.querySelector(".cci-stack-chars") as HTMLElement).getBoundingClientRect() : null;
      const num = parseFloat(getComputedStyle(stack ? (cells[cells.length - 1].querySelector(".cci-stack-chars") as HTMLElement) : w, "::after").fontSize);
      return { lvl: i + 1, stack, left: r.left, right: r.right, bottom: r.bottom, cellRight: stack ? cells[cells.length - 1].getBoundingClientRect().right : null, charsBottom: chars?.bottom, num };
    });
    rows.push({ kind, size, scale: sc, words });
  }
  return { installed: true, rows, height: document.documentElement.scrollHeight };
}

/** The phone bug: a paragraph of adjacent numbered words must wrap to the container. Real notes have no
 *  filler between words, so a rule that forbids breaks at word boundaries leaves NO break in the line and it
 *  overflows sideways (beta.4: `white-space: nowrap` on numbered words). Every width, three kinds of line. */
function overflow() {
  const out: Record<string, { widths: number; over: number; worst: number; multi: number }> = {};
  const variants: [string, Cfg, boolean][] = [
    ["hsk plain", { mode: "none", branch: "plain", len: 2, font: 22, spacing: 1, annot: 100, adjacent: 6 }, true],
    ["hsk mixed", { mode: "two-line", branch: "perchar", len: 2, font: 22, spacing: 1, annot: 100, adjacent: 6, mixed: true }, true],
    ["status plain", { mode: "none", branch: "plain", len: 2, font: 22, spacing: 1, annot: 100, adjacent: 6, palette: "status" }, true],
    ["e-ink off", { mode: "none", branch: "plain", len: 2, font: 22, spacing: 1, annot: 100, adjacent: 6 }, false],
  ];
  for (const [name, cfg, eink] of variants) {
    const r = { widths: 0, over: 0, worst: 0, multi: 0 };
    for (let w = 280; w <= 700; w += 10) {
      const { view, root } = mount(cfg);
      root.style.width = w + "px";
      if (eink) root.setAttribute("data-eink", "");
      settle(view);
      const rr = root.getBoundingClientRect();
      const els = [...view.contentDOM.querySelectorAll(".cci-word")] as HTMLElement[];
      const right = Math.max(...els.map((e) => Math.max(...[...e.getClientRects()].map((q) => q.right))));
      const sideways = Math.max(right - rr.right, view.scrollDOM.scrollWidth - view.scrollDOM.clientWidth);
      r.widths++;
      if (sideways > 1) { r.over++; r.worst = Math.max(r.worst, sideways); }
      if (new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size > 1) r.multi++;
      view.destroy();
    }
    out[name] = r;
  }
  return out;
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

/** Every kind of highlight the plugin can paint, with the inline colours it paints them with, read back
 *  as computed style with E-ink on and off: on must be ONE grey, off must be the original colours. */
function highlights() {
  const out: Record<string, any> = {};
  for (const eink of [true, false]) {
    const { view, root } = mount({ mode: "two-line", branch: "perchar", len: 2, font: 22, spacing: 1, annot: 100 });
    if (eink) root.setAttribute("data-eink", "");
    const stack = view.contentDOM.querySelector(".cci-stack") as HTMLElement;
    // A highlighted word carries no colour class (the plugin drops it, `highlightOverridesStatus`); the
    // colour classes' `background` shorthand would also clear the band.
    stack.classList.remove(...[...stack.classList].filter((c) => c.startsWith("cci-color-")));
    stack.classList.add("cci-stack-hl");
    stack.style.setProperty("--cci-hl", "rgba(255, 85, 130, 0.65)");
    const mk = (cls: string, style: string) => {
      const el = document.createElement("span");
      el.className = cls;
      el.setAttribute("style", style);
      el.textContent = "字";
      view.contentDOM.querySelector(".cm-line")!.appendChild(el);
      return getComputedStyle(el);
    };
    const plain = mk("cci-md-highlight", "");
    // The colour arrives as the inline custom property the plugin writes (never an inline background), which the base rules read.
    const coloured = mk("cci-md-highlight cci-md-colored", "--cci-mark-bg:rgba(255, 85, 130, 0.65);");
    const link = mk("cci-md-link-hl", "--cci-mark-bg:rgba(255, 85, 130, 0.65);");
    const chars = getComputedStyle(stack.querySelector(".cci-stack-chars") as HTMLElement);
    const row = getComputedStyle(stack.querySelector(".cci-stack-cell > *:not(.cci-stack-chars)") ?? stack);
    out[eink ? "on" : "off"] = {
      plain: plain.backgroundColor, plainText: plain.color,
      coloured: coloured.backgroundColor, colouredText: coloured.color,
      link: link.backgroundColor,
      band: getComputedStyle(stack).backgroundImage,
      chars: chars.color, otherRow: row.color,
    };
    view.destroy();
  }
  return out;
}

/** A highlighted word next to a normal one, in HSK colours, plain and heading: the highlight must show
 *  no level number (the plugin drops the colour class on it), its neighbour must, and the grey band
 *  must reach heading-sized words and survive the edit-mode caret guard. */
function highlightNeighbours() {
  const out: Record<string, any> = {};
  for (const [name, cfg, editable] of [
    ["plain", { mode: "two-line", branch: "perchar", len: 2, font: 22, spacing: 1, annot: 100 }, false],
    ["heading", { mode: "two-line", branch: "perchar", len: 2, font: 22, spacing: 1, annot: 100, heading: 1 }, false],
    ["edit", { mode: "two-line", branch: "perchar", len: 2, font: 22, spacing: 1, annot: 100 }, true],
  ] as const) {
    const { view, root } = mount({ ...cfg, adjacent: 2 } as Cfg, editable);
    root.setAttribute("data-eink", "");
    const stacks = [...view.contentDOM.querySelectorAll(".cci-stack")] as HTMLElement[];
    const hl = stacks[0];
    hl.classList.remove(...[...hl.classList].filter((c) => c.startsWith("cci-color-")));
    hl.classList.add("cci-stack-hl");
    hl.style.setProperty("--cci-hl", "rgba(255, 85, 130, 0.65)");
    const lastChars = (s: HTMLElement) => [...s.querySelectorAll(".cci-stack-cells > .cci-stack-cell:last-child .cci-stack-chars")].pop() as HTMLElement;
    out[name] = {
      band: getComputedStyle(hl).backgroundImage,
      hlNumber: getComputedStyle(lastChars(hl), "::after").content,
      neighbourNumber: getComputedStyle(lastChars(stacks[1]), "::after").content,
    };
    view.destroy();
  }
  return out;
}

/** The tint of a plain word and of an annotated word on the SAME line must end on the same line: both are
 *  styled by `.cci-word.cci-color-X` (background + 1px border), but a plain word is an inline box (its
 *  background is the font's content area, ascent + descent) and an annotated word is an inline-block whose
 *  last row is `line-height: 1`. The two bottoms differ by (ascent + descent - 1)/2 em, which depends on the
 *  font. Reports mark.bottom - stack.bottom for every font installed here, body text and headings 1-4, and
 *  the line height, with the plain-word box either as shipped or forced back to inline (`inline=1`) so the
 *  caller can require that changing the box type moves nothing else. */
function bottoms() {
  const ff = Q.get("ff") ?? "sans-serif";
  if (!fontInstalled(ff)) return { installed: false, rows: [] };
  const forceInline = Q.get("inline") === "1";
  const rows: any[] = [];
  const WORDS = ["一个", "勇敢", "的", "故事", "朋友", "学习"];
  for (const level of [0, 1, 2, 3, 4]) for (const font of [16, 22, 40]) for (const spacing of [0.15, 1.0]) for (const mode of ["none", "two-line", "three-line"] as const) for (const status of ["known", "partial", "unknown", "new"]) {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;padding:8px;background:#fff;color:#000";
    const root = document.createElement("div");
    root.className = "cci-view";
    root.setAttribute("data-display", mode);
    root.style.cssText = `width:1100px;--cci-reader-font:${font}px;--cci-line-spacing:${spacing};--cci-annotation-scale:1;`;
    if (forceInline) { const st = document.createElement("style"); st.textContent = ".cci-view .cci-word:not(.cci-stack){display:inline !important;line-height:inherit !important}"; root.appendChild(st); }
    const host = document.createElement("div");
    host.className = "cci-editor";
    root.appendChild(host);
    document.body.appendChild(root);
    const prefix = level ? "#".repeat(level) + " " : "";
    let doc = prefix;
    const b = new RangeSetBuilder<Decoration>();
    const settings: any = { ...DEFAULT_SETTINGS, line2Content: "pinyin", line3Content: "english", pinyinStyle: "marks", stripGlossParentheticals: false };
    WORDS.forEach((w, i) => {
      const start = doc.length;
      doc += w;
      const tok: any = { start, end: start + w.length, surface: w, isWord: true, confidence: 1, candidates: [], selected: { simplified: w, pinyin: Array.from(w).map((_, k) => SYL[(i * 3 + k) % SYL.length]).join(" "), definitions: ["gloss"] } };
      const plain = mode === "none" || i % 2 === 0;
      if (plain) b.add(start, start + w.length, Decoration.mark({ class: wordMarkClass({ colorKey: status, headingLevel: level }), attributes: { "data-cci-surface": w } }));
      else {
        const rec: any = { status: "unknown", axes: { chars: false, pinyin: false, meaning: false }, surfaces: [w] };
        b.add(start, start + w.length, Decoration.replace({ widget: new RubyWidget(w, tok, rec, mode, settings, level, status as any, undefined), inclusive: false }));
      }
    });
    const deco = b.finish();
    const view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions: [markdown(), syntaxHighlighting(cciMarkdownHighlight), EditorView.lineWrapping, EditorView.editable.of(false), EditorView.decorations.of(deco), EditorView.atomicRanges.of(() => deco)] }) });
    view.scrollDOM.style.fontFamily = ff === "sans-serif" ? ff : `"${ff}", sans-serif`;
    settle(view);
    const line = view.contentDOM.querySelector(".cm-line") as HTMLElement;
    const words = [...view.contentDOM.querySelectorAll(".cci-word")] as HTMLElement[];
    const plainEl = words.filter((w) => !w.classList.contains("cci-stack"));
    const stackEl = words.filter((w) => w.classList.contains("cci-stack"));
    rows.push({
      key: `${ff} h${level} ${font}px x${spacing} ${mode} ${status}`, level, font, mode, status,
      lineH: line.getBoundingClientRect().height,
      // a tap lands on the word: the plugin finds it with `target.closest(".cci-word")`
      hit: plainEl.every((w) => { const r = w.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t?.closest(".cci-word") === w; }),
      plain: plainEl.map((w) => { const r = w.getBoundingClientRect(); return { left: r.left, width: r.width, bottom: r.bottom }; }),
      stacks: stackEl.map((w) => { const r = w.getBoundingClientRect(); return { left: r.left, width: r.width, bottom: r.bottom }; }),
    });
    view.destroy();
  }
  return { installed: true, rows };
}

/** Plain word marks inside a heading, in the real editor with the real markdown parser and the real
 *  heading HighlightStyle. The tint is the mark's own inline box, so a mark smaller than the text inside it
 *  paints only part of the word (the beta.8 bug: green at body-text height under a 1.7x heading). Reports,
 *  for every mark, its font-size against the size of the text it holds, and the line height against the
 *  same heading with no marks at all. */
function headings() {
  const WORDS = ["一个", "勇敢", "的", "故事"];
  const out: any[] = [];
  for (const eink of [false, true]) for (const level of [1, 2, 3, 4, 5, 6]) for (const font of [14, 22, 40]) for (const spacing of [0.15, 1.0]) for (const mode of ["none", "two-line", "three-line"]) {
    const build = (marked: boolean) => {
      document.body.innerHTML = "";
      const root = document.createElement("div");
      root.className = "cci-view";
      root.setAttribute("data-display", mode);
      if (eink) root.setAttribute("data-eink", "");
      root.style.cssText = `width:900px;--cci-reader-font:${font}px;--cci-line-spacing:${spacing};--cci-annotation-scale:1;`;
      const host = document.createElement("div");
      host.className = "cci-editor";
      root.appendChild(host);
      document.body.appendChild(root);
      const doc = `${"#".repeat(level)} ${WORDS.join("")}`;
      const b = new RangeSetBuilder<Decoration>();
      if (marked) {
        let at = level + 1;
        for (const w of WORDS) {
          b.add(at, at + w.length, Decoration.mark({ class: "cci-word cci-color-known" + (level <= 4 ? ` cci-word-h${level}` : ""), attributes: { "data-cci-surface": w } }));
          at += w.length;
        }
      }
      const deco = b.finish();
      const view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions: [markdown(), syntaxHighlighting(cciMarkdownHighlight), EditorView.lineWrapping, EditorView.editable.of(false), EditorView.decorations.of(deco)] }) });
      settle(view);
      return view;
    };
    const bare = build(false);
    const bareH = (bare.contentDOM.querySelector(".cm-line") as HTMLElement).getBoundingClientRect().height;
    bare.destroy();
    const view = build(true);
    const lineH = (view.contentDOM.querySelector(".cm-line") as HTMLElement).getBoundingClientRect().height;
    const marks = [...view.contentDOM.querySelectorAll(".cci-word")] as HTMLElement[];
    const rows = marks.map((m) => {
      // the element that directly holds the text: it carries the size the glyphs are drawn at
      const holder = (m.firstElementChild && m.firstElementChild.textContent === m.textContent ? m.firstElementChild : m) as HTMLElement;
      const glyphPx = px(getComputedStyle(holder).fontSize);
      const markPx = px(getComputedStyle(m).fontSize);
      const walker = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
      const t = walker.nextNode() as Text;
      const glyphParentPx = px(getComputedStyle(t.parentElement!).fontSize);
      return { markPx, glyphPx: Math.max(glyphPx, glyphParentPx), inside: holder !== m, h: m.getBoundingClientRect().height };
    });
    out.push({ key: `${eink ? "eink" : "off"} h${level} ${font}px x${spacing} ${mode}`, level, font, bareH, lineH, rows });
    view.destroy();
  }
  return out;
}

/** Colour of each annotation row under every combination of E-ink, custom text colours (root custom
 *  properties, as the plugin writes them) and theme. */
function rowColours() {
  const out: Record<string, any> = {};
  for (const eink of [true, false]) for (const custom of [true, false]) for (const dark of [true, false]) {
    const { view, root } = mount({ mode: "three-line", branch: "perchar", len: 2, font: 22, spacing: 1, annot: 100 });
    if (eink) root.setAttribute("data-eink", "");
    if (custom) root.style.cssText += ";--cci-text-chars:rgb(1, 2, 3);--cci-text-pinyin:rgb(10, 20, 30);--cci-text-gloss:rgb(40, 50, 60)";
    document.body.classList.toggle("theme-dark", dark);
    document.body.style.setProperty("--text-normal", "rgb(238, 238, 238)");
    const stack = view.contentDOM.querySelector(".cci-stack") as HTMLElement;
    const mnemonic = document.createElement("div");
    mnemonic.className = "cci-stack-gloss cci-stack-mnemonic";
    stack.prepend(mnemonic);
    const c = (sel: string | HTMLElement) => getComputedStyle(typeof sel === "string" ? stack.querySelector(sel)! : sel).color;
    out[`${eink ? "eink" : "off"}|${custom ? "custom" : "theme"}|${dark ? "dark" : "light"}`] = {
      pinyin: c(".cci-stack-pinyin"), gloss: c(".cci-stack-gloss:not(.cci-stack-mnemonic)"), mnemonic: c(mnemonic), chars: c(".cci-stack-chars"),
    };
    view.destroy();
  }
  document.body.classList.remove("theme-dark");
  return out;
}

const task = Q.get("task") ?? "matrix";
const t0 = performance.now();
let result: any;
if (task === "matrix") {
  for (const cfg of configs(Q.get("display") ?? "none")) runConfig(cfg);
  result = { task, ms: Math.round(performance.now() - t0), stat, fails };
} else if (task === "extras") {
  result = { task, edit: editModeGuard(), split: splitWords() };
} else if (task === "overflow") {
  result = { task, over: overflow() };
} else if (task === "geom") {
  result = { task, ...geom() };
} else if (task === "bottoms") {
  result = { task, ...bottoms() };
} else if (task === "headings") {
  result = { task, hd: headings() };
} else if (task === "hlneighbours") {
  result = { task, hn: highlightNeighbours() };
} else if (task === "rows") {
  result = { task, rows: rowColours() };
} else if (task === "highlight") {
  result = { task, hl: highlights() };
} else if (task === "rects") {
  result = { task, rects: rects() };
}
document.documentElement.setAttribute("data-result", JSON.stringify(result));
