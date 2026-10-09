#!/usr/bin/env node
/**
 * Layout regression check for E-ink mode (#112): `npm run check:layout`.
 *
 * E-ink mode is CSS that interacts with five other things a reader can resize
 * (reader font, line spacing, annotation size, display mode, and the level-number
 * size). The repo has no DOM harness (#119), so CI can pin the CSS by text
 * (src/tests/einkCss.test.ts) but cannot see layout. This does: it mounts real
 * CodeMirror editors using the real RubyWidget and the real styles.css in headless
 * Chromium and measures, over every combination of those controls at their
 * extremes and defaults, that E-ink mode:
 *
 *   - never changes the line height, for either the number (out of flow in both kinds
 *     of word) or the underline (a text-decoration; a thicker border used to grow the line)
 *   - leaves the annotation rows exactly as they were        (the 0.7.7 sizing feature)
 *   - draws the SAME underline under plain and annotated words (a border put them at
 *     different heights, by an amount that depends on the font)
 *   - shows exactly one number per word, in BOTH widget layouts, and never splits a
 *     numbered word across two lines, so the number cannot be separated from it
 *   - draws the number's bottom edge level with the underline's bottom edge, and keeps
 *     it there as the size slider moves (measured from a screenshot: a decoration has
 *     no DOM rect), in every CJK font installed on the machine
 *   - leaves a gutter at least as wide as the number, and never lets the number
 *     approach the size of the character
 *   - keeps every click on the word it was aimed at
 *   - generates nothing while the view is editable
 *   - is completely inert when off (the block is cut out of the stylesheet and the
 *     layout compared)
 *   - still reproduces the snippet that was confirmed working on a real e-ink device
 *
 * It runs on every PR in ci.yml (the `layout` job): the GitHub runner has Google Chrome,
 * and a check nobody is forced to run is a check that gets skipped (the beta.4 -> beta.5
 * iPhone regression shipped exactly that way). It must NOT be part of check-release or
 * release.yml, which have to stay offline and deterministic.
 *
 * Needs a Chromium: $CHROME_HEADLESS_SHELL (any Chrome/Chromium binary), else the newest
 * chrome-headless-shell in Playwright's cache, else google-chrome / chromium on PATH.
 * With none it prints a notice and exits 0 on a developer machine so it can never wedge
 * one that lacks a browser, but FAILS when $CI is set: a green check that measured nothing
 * is worse than a red one. No new dependency: esbuild is already here.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleHarness, THEME } from "./eink-layout/bundle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function findChrome() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  // Playwright's cache: macOS keeps it under Library/Caches, Linux under ~/.cache.
  for (const cache of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")]) {
    if (!existsSync(cache)) continue;
    const dirs = readdirSync(cache)
      .filter((d) => d.startsWith("chromium_headless_shell-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs)
      for (const arch of ["mac-arm64", "mac-x64", "linux", "linux64"]) {
        const p = join(cache, d, `chrome-headless-shell-${arch}`, "chrome-headless-shell");
        if (existsSync(p)) return p;
      }
  }
  // A system browser (the GitHub runner ships Google Chrome).
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  const msg =
    "check:layout found no headless Chromium.\n" +
    "Set CHROME_HEADLESS_SHELL, install Google Chrome / Chromium, or run `npx playwright install chromium`.";
  if (process.env.CI) {
    console.error(`${msg}\nFAILING because CI is set: a skipped layout check would look like a passing one.`);
    process.exit(1);
  }
  console.log(`${msg}\nSkipped (not CI).`);
  process.exit(0);
}

// ---- read the limits from the files that own them, so this cannot drift from the shipped values ----
const einkSrc = read("src/view/einkMode.ts");
const num = (name) => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(einkSrc);
  if (!m) throw new Error(`could not read ${name} from src/view/einkMode.ts`);
  return Number(m[1]);
};
const MIN = num("EINK_NUMBER_SCALE_MIN"), MAX = num("EINK_NUMBER_SCALE_MAX"), STEP = num("EINK_NUMBER_SCALE_STEP");
const scales = [];
for (let s = MIN; s <= MAX; s += STEP) scales.push(s);

const css = read("styles.css");
const BEGIN = css.indexOf("/* eink:begin");
const END = css.indexOf("/* eink:end */");
if (BEGIN < 0 || END < BEGIN) throw new Error("styles.css has no /* eink:begin … /* eink:end */ block");
const floorMatch = /var\(--cci-eink-floor,\s*(\d+)px\)/.exec(css.slice(BEGIN, END));
if (!floorMatch) throw new Error("could not read the floor from the e-ink block");
const FLOOR = Number(floorMatch[1]);
const cssWithoutBlock = css.slice(0, BEGIN) + css.slice(END + "/* eink:end */".length);

// ---- bundle the browser half from the REAL source (shared with check-webkit-layout.mjs) ----
const bundleText = await bundleHarness(ROOT);

const tmp = mkdtempSync(join(tmpdir(), "cci-eink-"));
writeFileSync(join(tmp, "bundle.js"), bundleText);
// Test-only: lets the harness measure the underline alone, to separate what the NUMBER does from
// what the thicker underline does.
const NO_NUM = ".cci-view.no-num .cci-word::after,.cci-view.no-num .cci-stack-chars::after{content:none!important}";
const page = (name, styles, body = '<script src="bundle.js"></script>') =>
  writeFileSync(join(tmp, name), `<!doctype html><meta charset="utf-8"><style>${THEME}${styles}${NO_NUM}</style><body>${body}</body>`);
page("full.html", css);
page("base.html", cssWithoutBlock);

// ---- acceptance: the scoped snippet from docs/e-ink.md, confirmed working on a Bigme HiBreak Pro ----
const snippet = /```css\n([\s\S]*?)```/.exec(read("docs/e-ink.md"))?.[1];
if (!snippet) throw new Error("could not find the snippet in docs/e-ink.md");
const statuses = ["known", "partial", "unknown", "new"];
const accBody = (attr) =>
  `<div class="cci-view" data-display="none" ${attr} style="--cci-reader-font:22px;--cci-line-spacing:1"><div class="cci-editor"><div class="cm-content">` +
  statuses.map((k) => `<span class="cci-word cci-color-${k}" id="${k}">词</span> `).join("") +
  // The snippet draws its underline as a border; E-ink mode draws it as a text-decoration. Both are read
  // into the same {width, style, colour} so what they LOOK like can be compared.
  `</div></div></div><script>const o={};for(const k of ${JSON.stringify(statuses)}){const c=getComputedStyle(document.getElementById(k));const dec=c.textDecorationLine.includes("underline");const bord=c.borderBottomStyle!=="none"&&c.borderBottomWidth!=="0px"&&c.borderBottomColor!=="rgba(0, 0, 0, 0)";o[k]=dec?{w:c.textDecorationThickness,s:c.textDecorationStyle,c:c.textDecorationColor}:bord?{w:c.borderBottomWidth,s:c.borderBottomStyle,c:c.borderBottomColor}:{w:"0px",s:"none",c:"rgba(0, 0, 0, 0)"}}document.documentElement.setAttribute("data-result",JSON.stringify(o));</script>`;
page("acc_snippet.html", css.slice(0, BEGIN) + snippet, accBody(""));
page("acc_ours.html", css, accBody("data-eink"));

// Underline red, digit blue: the two can then be told apart in a screenshot.
page("align.html", css + ".cci-view[data-eink] .cci-word:not(.cci-stack),.cci-view[data-eink] .cci-stack .cci-stack-chars{text-decoration-color:#f00!important}.cci-view[data-eink] .cci-word::after,.cci-view[data-eink] .cci-stack-chars::after{color:#00f!important}");

/** Minimal PNG reader (8-bit, RGB or RGBA, non-interlaced): enough for a headless screenshot, no dependency. */
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0 || (ct !== 2 && ct !== 6)) throw new Error("unsupported PNG"); }
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

// ---- run ----
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
function run(pageName, query = "") {
  const out = execFileSync(
    chrome,
    ["--headless", "--disable-gpu", "--window-size=3300,1200", "--virtual-time-budget=900000", "--dump-dom", `file://${join(tmp, pageName)}${query ? "?" + query : ""}`],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "ignore"] }
  );
  const m = /data-result="([^"]*)"/.exec(out);
  if (!m) throw new Error(`${pageName}?${query} produced no result — the harness failed to run`);
  return JSON.parse(unescape(m[1]));
}

// Every font the pixel and tint checks try; those not installed on the machine are skipped.
const FONTS = ["sans-serif", "Hiragino Sans GB", "Heiti SC", "Heiti TC", "STSong", "Songti SC", "Songti TC", "Arial Unicode MS", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei"];
const failures = [];
const note = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(label);
};

console.log(`E-ink layout check — number size ${MIN}–${MAX}% (step ${STEP}), floor ${FLOOR}px`);
console.log(`(${chrome})\n`);

let cells = 0;
for (const mode of ["none", "two-line", "three-line"]) {
  const r = run("full.html", `task=matrix&display=${mode}&floor=${FLOOR}&scales=${scales.join(",")}`);
  cells += r.stat.cells;
  const names = Object.keys(r.fails);
  note(names.length === 0, `${mode}: ${r.stat.cells} combinations`,
    names.length ? names.map((k) => `${k} ×${r.fails[k].n} e.g. ${r.fails[k].ex[0]}`).join("; ")
      : `line height effect: number ${r.stat.maxNumberLineDelta.toFixed(2)}px, underline ${r.stat.maxUnderlineLineDelta.toFixed(2)}px; worst number/character ${r.stat.maxRatio.toFixed(2)}`);
}

const extras = run("full.html", "task=extras&floor=" + FLOOR);
note(extras.edit.editable === "none" && extras.edit.readonly.startsWith('"'), "edit mode generates no number", `editable=${extras.edit.editable} readonly=${extras.edit.readonly}`);
note(extras.split.wrapped > 0 && extras.split.wrong === 0, "every numbered word carries exactly one number, wrapped or not", `${extras.split.wrapped} wrapping widths, ${extras.split.wrong} wrong`);
note(extras.split.split === 0, "a numbered word is never split across two lines", `${extras.split.split} of ${extras.split.wrapped} wrapping widths`);

// ---- highlighting: one grey in E-ink mode, the original colours with it off ----
const GREY = "rgb(196, 196, 196)";
const hl = run("full.html", "task=highlight&floor=" + FLOOR).hl;
note(hl.on.plain === GREY && hl.on.coloured === GREY && hl.on.link === GREY && hl.on.band.includes(GREY),
  "E-ink: plain, coloured and link highlights and the annotated-word band are all the one grey", JSON.stringify(hl.on));
note(hl.on.plainText === "rgb(0, 0, 0)" && hl.on.colouredText === "rgb(0, 0, 0)" && hl.on.chars === "rgb(0, 0, 0)",
  "E-ink: highlighted text is black", `${hl.on.plainText} ${hl.on.colouredText} ${hl.on.chars}`);
note(hl.on.otherRow === "rgb(0, 0, 0)" && hl.off.otherRow !== hl.on.otherRow, "E-ink: pinyin / gloss rows of a highlighted word are black like the others (and only the highlight band is grey)", `${hl.on.otherRow} vs ${hl.off.otherRow}`);
note(hl.off.plain !== GREY && hl.off.coloured.includes("255, 85, 130") && hl.off.link.includes("255, 85, 130") && hl.off.band.includes("255, 85, 130"),
  "E-ink off: highlight colours are untouched", JSON.stringify(hl.off));

// ---- a plain word's tint and an annotated word's tint end on the same line, in every font ----
{
  const TOL = 0.5;
  let fontsDone = 0, missed = 0, firstMiss = "", bad = 0, worst = 0, first = "", worstFont = "", moved = 0, firstMoved = "";
  for (const ff of FONTS) {
    const q = (inline) => `task=bottoms&floor=${FLOOR}&ff=${encodeURIComponent(ff)}${inline ? "&inline=1" : ""}`;
    const cur = run("full.html", q(false));
    if (!cur.installed) continue;
    fontsDone++;
    const was = run("full.html", q(true));
    cur.rows.forEach((r, i) => {
      if (!r.hit) { missed++; firstMiss = firstMiss || r.key; }
      if (r.stacks.length && r.plain.length) {
        const d = Math.abs(r.plain[0].bottom - r.stacks[0].bottom);
        if (d > worst) { worst = d; worstFont = r.key; }
        if (d > TOL) { bad++; if (!first) first = `${r.key}: plain ends ${(r.plain[0].bottom - r.stacks[0].bottom).toFixed(2)}px from annotated`; }
      }
      // changing the plain word's box type must not move anything else
      const w = was.rows[i];
      const same = Math.abs(r.lineH - w.lineH) < 0.01 && r.plain.every((p, k) => Math.abs(p.left - w.plain[k].left) < 0.01 && Math.abs(p.width - w.plain[k].width) < 0.01)
        && r.stacks.every((p, k) => Math.abs(p.left - w.stacks[k].left) < 0.01 && Math.abs(p.width - w.stacks[k].width) < 0.01);
      if (!same) { moved++; if (!firstMoved) firstMoved = `${r.key}: line ${r.lineH} vs ${w.lineH}`; }
    });
  }
  note(fontsDone > 0 && bad === 0, `plain and annotated tints end on the same line (within ${TOL}px): ${fontsDone} fonts`, bad ? `${bad} lines off, worst ${worst.toFixed(2)}px (${worstFont}), e.g. ${first}` : `worst ${worst.toFixed(2)}px`);
  note(missed === 0, "a tap in the middle of a plain word lands on that word", missed ? `${missed} lines, e.g. ${firstMiss}` : "");
  note(moved === 0, "the plain word's box type moves nothing: line height and every word's left/width identical to inline", moved ? `${moved} lines changed, e.g. ${firstMoved}` : "");
}

// ---- plain word marks inside Markdown headings: the tint must cover the whole enlarged word ----
{
  const hd = run("full.html", "task=headings&floor=" + FLOOR).hd;
  let small = 0, total = 0, lineMoved = 0, first = "", firstLine = "", inside = 0;
  for (const c of hd) {
    for (const r of c.rows) {
      total++;
      if (r.markPx + 0.01 < r.glyphPx) { small++; if (!first) first = `${c.key}: mark ${r.markPx}px holds ${r.glyphPx}px text`; }
      if (r.inside) inside++;
    }
    if (Math.abs(c.lineH - c.bareH) > 0.01) { lineMoved++; if (!firstLine) firstLine = `${c.key}: line ${c.lineH} vs ${c.bareH} without marks`; }
  }
  note(small === 0, `heading word marks are as big as the text inside them: ${total} marks in ${hd.length} headings`, small ? `${small} too small, e.g. ${first}` : `${inside} hold a nested heading span`);
  note(lineMoved === 0, "marking words in a heading does not change the line height", lineMoved ? `${lineMoved} headings, e.g. ${firstLine}` : "");
}

// ---- a highlighted word beside numbered ones; headings; edit mode ----
const hn = run("full.html", "task=hlneighbours&floor=" + FLOOR).hn;
for (const name of ["plain", "heading", "edit"]) {
  note(hn[name].band.includes(GREY), `E-ink highlight band is the grey: ${name}`, hn[name].band);
}
note(hn.plain.hlNumber === "none" || hn.plain.hlNumber === "normal" || hn.plain.hlNumber === '""',
  "E-ink HSK: a highlighted word carries no level number", hn.plain.hlNumber);
note(/^"[1-7]"$/.test(hn.plain.neighbourNumber), "E-ink HSK: its un-highlighted neighbour still does", hn.plain.neighbourNumber);
note(!/^"[1-7]"$/.test(hn.edit.neighbourNumber), "E-ink edit mode: still no generated number beside a highlight", hn.edit.neighbourNumber);

// ---- annotation rows: black in E-ink (light theme), theme text on dark, untouched when off ----
const rows = run("full.html", "task=rows&floor=" + FLOOR).rows;
const BLACK = "rgb(0, 0, 0)";
const REST = ["pinyin", "gloss", "mnemonic"];
for (const custom of ["custom", "theme"]) {
  const on = rows[`eink|${custom}|light`], dk = rows[`eink|${custom}|dark`], off = rows[`off|${custom}|light`];
  note(REST.every((k) => on[k] === BLACK), `E-ink, ${custom} text colours: pinyin, translation and mnemonic rows are black`, JSON.stringify(on));
  note(REST.every((k) => dk[k] === "rgb(238, 238, 238)"), `E-ink, ${custom} text colours, dark theme: rows use the theme text colour`, JSON.stringify(dk));
  note(REST.every((k) => off[k] !== BLACK) && on.chars === off.chars && dk.chars === rows[`off|${custom}|dark`].chars,
    `E-ink off, ${custom} text colours: rows keep their own colour; the characters row never changes`, JSON.stringify(off));
}

// ---- the digit's bottom edge against the underline's bottom edge, from pixels ----
const SCALE = 4;           // device pixels per CSS pixel: 0.25px resolution
const ALIGN_TOL = 1.0;     // |digit bottom - underline bottom| in CSS px (measured worst: 0.5)
const SWING_TOL = 0.75;    // how far the digit may move across the whole size slider (measured worst: 0.5)
// A 4x screenshot taller than a few thousand device pixels comes back partly blank, so each widget kind AND reader size is
// shot on its own, at the two ends of the slider and two points between.
const ALIGN_SCALES = [...new Set([MIN, 80, 100, MAX])].filter((v) => v >= MIN && v <= MAX).sort((x, y) => x - y);
function align(ff, kind, size) {
  const q = `task=geom&floor=${FLOOR}&scales=${ALIGN_SCALES.join(",")}&kinds=${kind}&sizes=${size}&ff=${encodeURIComponent(ff)}`;
  const g = run("align.html", q);
  if (!g.installed) return null;
  const png = join(tmp, "align.png");
  execFileSync(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${SCALE}`, `--window-size=1130,${Math.ceil(g.height) + 40}`, "--virtual-time-budget=900000", `--screenshot=${png}`, `file://${join(tmp, "align.html")}?${q}`], { stdio: "ignore", timeout: 900000 });
  const im = decodePng(readFileSync(png));
  const at = (x, y) => { const i = (y * im.w + x) * im.bpp; return [im.px[i], im.px[i + 1], im.px[i + 2]]; };
  const per = new Map(); let worst = 0, unmeasured = 0;
  for (const row of g.rows) for (const w of row.words) {
    if (![2, 4, 6].includes(w.lvl)) continue;
    const ref = w.stack ? w.charsBottom : w.bottom, x1 = w.stack ? w.cellRight : w.right;
    const red = new Map(), blue = new Set();
    for (let y = Math.max(0, Math.floor((ref - (w.stack ? 14 : 34)) * SCALE)); y < Math.min(im.h, Math.ceil((ref + (w.stack ? 26 : 14)) * SCALE)); y++)
      for (let x = Math.floor(w.left * SCALE); x < Math.min(im.w, Math.ceil((x1 + w.num * 1.6 + 6) * SCALE)); x++) {
        const [r, gg, b] = at(x, y);
        if (r > 200 && gg < 90 && b < 90) red.set(y, (red.get(y) ?? 0) + 1); else if (b > 150 && r < 110 && gg < 110) blue.add(y);
      }
    const ur = [...red].filter(([, c]) => c >= (3 * SCALE) / 2).map(([y]) => y);
    if (!ur.length || !blue.size) { unmeasured++; if (process.env.DEBUG_ALIGN) console.log("   unmeasurable", ff, row.kind, row.size, row.scale, "lvl", w.lvl, "red", ur.length, "blue", blue.size, "x", w.left.toFixed(1), (x1).toFixed(1), "ref", ref.toFixed(1)); continue; }
    const err = (Math.max(...blue) + 1) / SCALE - (Math.max(...ur) + 1) / SCALE;
    worst = Math.max(worst, Math.abs(err));
    const key = `${row.kind}/${row.size}/${w.lvl}`;
    (per.get(key) ?? per.set(key, []).get(key)).push(err);
  }
  let swing = 0;
  for (const errs of per.values()) swing = Math.max(swing, Math.max(...errs) - Math.min(...errs));
  return { worst, swing, unmeasured, rows: g.rows.length };
}
let fontsChecked = 0;
for (const ff of FONTS) {
  // Very tall headless screenshots occasionally come back with unpainted (blank) bands. A band with neither underline nor digit
  // is a capture glitch, not a layout result, so a kind that has any is shot again; a real defect would repeat every time.
  const shoot = ([k, sz]) => { let r; for (let i = 0; i < 4; i++) { r = align(ff, k, sz); if (!r || r.unmeasured === 0) break; } return r; };
  const parts = ["plain", "stack", "stack3", "wordcell"].flatMap((k) => [14, 22, 40, 48].map((sz) => [k, sz])).map(shoot);
  if (parts.some((r) => !r)) continue;
  const r = { worst: Math.max(...parts.map((p) => p.worst)), swing: Math.max(...parts.map((p) => p.swing)), unmeasured: parts.reduce((n, p) => n + p.unmeasured, 0) };
  fontsChecked++;
  note(r.unmeasured === 0 && r.worst <= ALIGN_TOL && r.swing <= SWING_TOL, `digit level with the underline, steady across ${MIN}–${MAX}%: ${ff}`,
    `worst ${r.worst.toFixed(2)}px (limit ${ALIGN_TOL}), size swing ${r.swing.toFixed(2)}px (limit ${SWING_TOL})${r.unmeasured ? `, ${r.unmeasured} unmeasurable` : ""}`);
}
note(fontsChecked > 0, "at least one font could be measured", `${fontsChecked} of ${FONTS.length} fonts installed`);

// ---- text must wrap to the container: a run of ADJACENT numbered words, no filler between them ----
const ov = run("full.html", "task=overflow&floor=" + FLOOR).over;
for (const [name, r] of Object.entries(ov)) {
  note(r.over === 0 && r.multi > 0, `wraps to the screen, no sideways scroll: ${name}`,
    `${r.widths} widths, ${r.over} overflow${r.over ? ` (worst ${r.worst.toFixed(0)}px)` : ""}, wraps at ${r.multi}`);
}

const a = run("base.html", "task=rects").rects;
const b = run("full.html", "task=rects").rects;
note(JSON.stringify(a) === JSON.stringify(b), "E-ink mode is inert when off", `${a.length} configurations identical to the stylesheet with the block removed`);

// Acceptance against the confirmed snippet. color-mix() serialises as color(srgb 0..1), not rgb(0..255).
const rgb = (c) => { const n = (c.match(/-?[\d.]+/g) || []).slice(0, 3).map(Number); return c.startsWith("color(") ? n.map((v) => Math.round(v * 255)) : n.map(Math.round); };
const lum = (c) => { const [r, g, bl] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
const snip = run("acc_snippet.html"), ours = run("acc_ours.html");
for (const k of statuses) {
  const same = snip[k].w === ours[k].w && snip[k].s === ours[k].s;
  const colour = k === "known" ? Math.abs(lum(snip[k].c) - lum(ours[k].c)) <= 10 : k === "new" ? true : lum(ours[k].c) <= 0.2 * 255;
  note(same && colour, `matches the confirmed snippet: ${k}`, `${ours[k].w} ${ours[k].s}${k === "known" ? ` (luminance ${Math.round(lum(ours[k].c))} vs ${Math.round(lum(snip[k].c))})` : ""}`);
}

console.log(`\n${failures.length ? failures.length + " check(s) FAILED" : "all checks passed"} — ${cells} layout combinations.`);
process.exit(failures.length ? 1 : 0);
