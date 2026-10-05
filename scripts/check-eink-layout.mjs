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
 *   - never changes the line height, for either the number (the reason the plain-word
 *     number is `vertical-align: middle` and the stacked one out of flow) or the
 *     underline (a text-decoration; a thicker border used to grow the line)
 *   - leaves the annotation rows exactly as they were        (the 0.7.7 sizing feature)
 *   - draws the SAME underline under plain and annotated words (a border put them at
 *     different heights, by an amount that depends on the font)
 *   - shows exactly one number per word, in BOTH widget layouts, even when a word
 *     wraps across two lines, and never lets the number drop to the next line alone
 *   - leaves a gutter at least as wide as the number, and never lets the number
 *     approach the size of the character
 *   - keeps every click on the word it was aimed at
 *   - generates nothing while the view is editable
 *   - is completely inert when off (the block is cut out of the stylesheet and the
 *     layout compared)
 *   - still reproduces the snippet that was confirmed working on a real e-ink device
 *
 * Run it before any release that touches styles.css or RubyWidget
 * (docs/release-process.md). It is not in CI: the runner has no browser, and adding
 * one is a larger change than this feature.
 *
 * Needs a headless Chromium: $CHROME_HEADLESS_SHELL, else the newest
 * chrome-headless-shell in Playwright's cache. With none it prints a notice and exits
 * 0, so it can never wedge a machine that lacks one. No new dependency: esbuild is
 * already here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function findChrome() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache)
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs)
    for (const arch of ["mac-arm64", "mac-x64", "linux"]) {
      const p = join(cache, d, `chrome-headless-shell-${arch}`, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.log(
    "check:layout skipped — no headless Chromium found.\n" +
      "Set CHROME_HEADLESS_SHELL, or install Playwright's browsers (npx playwright install chromium)."
  );
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

// ---- bundle the browser half from the REAL source ----
const exportRubyWidget = {
  name: "export-ruby-widget",
  setup(b) {
    // RubyWidget is private to chineseDecorations.ts. Expose it for this bundle only, in memory,
    // so the widget under test is the real one and src/ stays untouched.
    b.onLoad({ filter: /chineseDecorations\.ts$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      if (!/^class RubyWidget extends/m.test(src)) throw new Error("RubyWidget declaration moved — update scripts/check-eink-layout.mjs");
      return { contents: src.replace(/^class RubyWidget extends/m, "export class RubyWidget extends"), loader: "ts", resolveDir: dirname(args.path) };
    });
  },
};
const bundle = await build({
  entryPoints: [join(ROOT, "scripts/eink-layout/entry.ts")],
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "warning",
  alias: { obsidian: join(ROOT, "src/tests/__mocks__/obsidian.ts") },
  plugins: [exportRubyWidget],
});

const tmp = mkdtempSync(join(tmpdir(), "cci-eink-"));
writeFileSync(join(tmp, "bundle.js"), bundle.outputFiles[0].text);
const THEME =
  ":root{--background-primary:#fff;--background-primary-alt:#f5f5f5;--background-modifier-border:#e0e0e0;--text-normal:#222;--text-muted:#7a7a7a;--text-faint:#a0a0a0;--interactive-accent:#7f6df2;font-family:-apple-system,sans-serif}html,body{margin:0;background:#fff}";
// Test-only: lets the harness measure the underline alone, to separate what the NUMBER does from
// what the thicker underline does.
const NO_NUM = ".cci-view.no-num .cci-word::after,.cci-view.no-num .cci-stack-cell::after{content:none!important}";
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

const failures = [];
const note = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(label);
};

console.log(`E-ink layout check — number size ${MIN}–${MAX}% (step ${STEP}), floor ${FLOOR}px`);
console.log(`(${chrome.split("/").slice(-2, -1)[0]})\n`);

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
note(extras.split.widths > 0 && extras.split.wrong === 0, "a word split across two lines keeps exactly one number", `${extras.split.widths} splitting widths, ${extras.split.wrong} wrong`);
note(extras.split.detached === 0, "the number never drops to the next line without its word", `${extras.split.detached} of ${extras.split.widths} splitting widths`);

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
