#!/usr/bin/env node
/**
 * Regenerate resources/screenshots/desktop-display-menu-annotated.png from
 * scripts/display-menu-harness.html. See that file's comment for the rationale.
 *
 * Needs a headless Chromium. Uses $CHROME_HEADLESS_SHELL if set, otherwise the
 * newest chrome-headless-shell in Playwright's browser cache. No new npm
 * dependency: this is a build-time tool, not something the plugin ships.
 *
 * Usage:  node scripts/render-display-menu.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "resources/screenshots/desktop-display-menu-annotated.png");
const HARNESS = join(ROOT, "scripts/display-menu-harness.html");

function findChrome() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache)
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const arch of ["mac-arm64", "mac-x64", "linux"]) {
      const p = join(cache, d, `chrome-headless-shell-${arch}`, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error(
    "No headless Chromium found. Set CHROME_HEADLESS_SHELL to one, or install\n" +
      "Playwright's browsers (npx playwright install chromium)."
  );
  process.exit(1);
}

const WIDTH = 394;
const base = ["--headless", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", "--virtual-time-budget=3000"];

// Pass 1: render tall and ask the page how tall it actually is, so the capture
// is sized to the content. Avoids both a trailing band of background and the
// risk of clipping if rows are added to the menu later.
const dom = execFileSync(chrome,
  [...base, `--window-size=${WIDTH},2000`, "--dump-dom", `file://${HARNESS}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const m = /data-content-height="(\d+)"/.exec(dom);
if (!m) {
  console.error("harness did not publish data-content-height — did its script fail?");
  process.exit(1);
}
const height = Number(m[1]);

// Pass 2: capture at exactly that height.
execFileSync(chrome,
  [...base, `--window-size=${WIDTH},${height}`, `--screenshot=${OUT}`, `file://${HARNESS}`],
  { stdio: ["ignore", "ignore", "inherit"] });

console.log(`wrote ${OUT} — ${WIDTH}x${height} CSS px at 2x (${statSync(OUT).size} bytes)`);
console.log(
  "Check the callout legends in README.md and docs/display-modes.md still\n" +
    "match the groups before committing."
);
