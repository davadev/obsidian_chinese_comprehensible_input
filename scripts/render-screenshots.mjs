#!/usr/bin/env node
/**
 * Regenerate the annotated screenshots of the 0.9.0 features in resources/screenshots/.
 *
 * Like render-display-menu.mjs this is a RENDER, not a capture of Obsidian: it mounts the plugin's real toolbar and dialogs
 * (bundled from src/, with fixture data and no AI call) next to the real styles.css, on Obsidian's default light theme
 * values, and draws the same numbered green callouts as scripts/annotate-screenshots.py. Obsidian's own modal chrome is
 * approximated by the small stylesheet below, so what you see inside a dialog is the plugin's, and the frame around it is not.
 *
 * Needs a headless Chromium ($CHROME_HEADLESS_SHELL, else Playwright's cache). No new dependency.
 *
 * Usage:  node scripts/render-screenshots.mjs [scene ...]     (no argument = all scenes)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "resources/screenshots");

/** scene -> [output file, viewport width in CSS px] */
const SCENES = {
  toolbar: ["desktop-toolbar-annotated.png", 560],
  lightbulb: ["desktop-lightbulb-annotated.png", 560],
  "phrase-confirm": ["explain-phrase-confirm-annotated.png", 560],
  "phrase-explain": ["explain-phrase-annotated.png", 560],
  proofread: ["explain-proofread-annotated.png", 560],
  "explain-word": ["explain-word-annotated.png", 560],
  whatsnew: ["whats-new-annotated.png", 560],
};

function findChrome() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  for (const cache of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")]) {
    if (!existsSync(cache)) continue;
    const dirs = readdirSync(cache)
      .filter((d) => d.startsWith("chromium_headless_shell-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs)
      for (const arch of ["mac-arm64", "mac-x64", "linux"]) {
        const p = join(cache, d, `chrome-headless-shell-${arch}`, "chrome-headless-shell");
        if (existsSync(p)) return p;
      }
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error("No headless Chromium found. Set CHROME_HEADLESS_SHELL to a binary.");
  process.exit(1);
}

const bundle = await build({
  entryPoints: [join(ROOT, "scripts/screenshots/entry.ts")],
  bundle: true,
  format: "iife",
  write: false,
  logLevel: "warning",
  alias: { obsidian: join(ROOT, "scripts/screenshots/obsidianShim.ts") },
});

const THEME = `
:root{--background-primary:#fff;--background-primary-alt:#f5f5f5;--background-secondary:#f5f5f5;--background-modifier-border:#dcdcdc;--background-modifier-hover:#efefef;
--background-modifier-box-shadow:rgba(0,0,0,.15);--text-normal:#222;--text-muted:#707070;--text-faint:#a0a0a0;--text-accent:#7f6df2;--text-on-accent:#fff;
--interactive-normal:#f0f0f0;--interactive-hover:#e6e6e6;--interactive-accent:#7f6df2;--interactive-accent-hover:#6f5ce6;--color-accent:#7f6df2;
--font-ui-small:13px;--font-ui-medium:15px;
font-family:-apple-system,"Segoe UI",Roboto,"PingFang SC","Noto Sans CJK SC",sans-serif;font-size:15px;color:#222}
html,body{margin:0;background:#fff}
body{position:relative;padding:14px 50px 14px 50px}
body.scene-toolbar{padding:50px 44px 14px 14px}
body.scene-lightbulb{padding:50px 14px 50px 14px}
/* Obsidian's own button, icon-button and modal chrome (app.css), approximated */
button{font:inherit;font-size:13px;background:var(--interactive-normal);border:0;border-radius:6px;padding:6px 12px;color:var(--text-normal);cursor:pointer;box-shadow:0 1px 1px rgba(0,0,0,.08)}
button.mod-cta{background:var(--interactive-accent);color:var(--text-on-accent)}
button.mod-warning{background:#e0443e;color:#fff}
.clickable-icon{display:inline-flex;align-items:center;justify-content:center;background:transparent;box-shadow:none;color:var(--text-muted);padding:4px 7px;border-radius:5px}
.clickable-icon:hover{background:var(--background-modifier-hover)}
.modal-container{position:static}
.modal{background:#fff;border:1px solid var(--background-modifier-border);border-radius:12px;padding:22px 24px;box-shadow:0 8px 28px var(--background-modifier-box-shadow);margin:6px 0}
.modal h2{margin:0 0 .5em;font-size:1.35em}
.modal h3{margin:1em 0 .3em;font-size:1.1em}
.modal blockquote{margin:.6em 0;padding:.3em 0 .3em 1em;border-left:3px solid var(--interactive-accent);color:var(--text-normal);font-size:1.15em}
.modal table{border-collapse:collapse}.modal td,.modal th{border:1px solid var(--background-modifier-border);padding:4px 8px}
.modal ul{padding-left:1.4em}
input[type=checkbox],input[type=radio]{accent-color:#7f6df2}
.stage{border-bottom:1px solid var(--background-modifier-border);padding:4px 0 6px}
/* the dialog's scroll area is sized in vh, and the capture window is only as tall as the page: show the whole note */
.cci-explain-modal .cci-explain-body{max-height:none!important;overflow:visible!important}
/* callouts: same palette as scripts/annotate-screenshots.py */
.co-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:99999}
.co-box{position:absolute;border:2px dashed #0d6a00;z-index:99999;border-radius:3px;box-sizing:border-box}
.co-circle{position:absolute;width:26px;height:26px;border-radius:50%;background:#349e00;border:2px solid #307000;color:#fff;font:700 15px/22px Arial,sans-serif;text-align:center;box-sizing:border-box}
`;

const dir = mkdtempSync(join(tmpdir(), "cci-shots-"));
const css = readFileSync(join(ROOT, "styles.css"), "utf8");
const page = `<!doctype html><meta charset="utf-8"><style>${THEME}</style><style>${css}</style><body><script>${bundle.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script></body>`;
const file = join(dir, "page.html");
writeFileSync(file, page);

const base = ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", "--virtual-time-budget=4000", "--allow-file-access-from-files"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
for (const scene of wanted) {
  const spec = SCENES[scene];
  if (!spec) throw new Error(`unknown scene ${scene}; known: ${Object.keys(SCENES).join(", ")}`);
  const [name, width] = spec;
  const url = `file://${file}?scene=${scene}`;
  const dom = execFileSync(chrome, [...base, `--window-size=${width},2400`, "--dump-dom", url], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const err = /data-error="([^"]*)"/.exec(dom);
  if (err) throw new Error(`scene ${scene} failed: ${err[1].replace(/&#10;|&#xA;/g, "\n")}`);
  const m = /data-content-height="(\d+)"/.exec(dom);
  if (!m) throw new Error(`scene ${scene}: the page did not publish its height (script failed?)`);
  const height = Number(m[1]);
  execFileSync(chrome, [...base, `--window-size=${width},${height}`, `--screenshot=${join(OUT, name)}`, url], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`wrote ${name} — ${width}x${height} CSS px at 2x (${statSync(join(OUT, name)).size} bytes)`);
}
