#!/usr/bin/env node
/**
 * Text must wrap to the screen in WebKit too: `npm run check:webkit` (#119).
 *
 * The iPhone runs WebKit, and WebKit has already disagreed with Chromium once. 0.7.8-beta.4 put
 * `white-space: nowrap` on E-ink + HSK numbered words; Blink tolerated it, but WebKit then had no legal line break
 * between ADJACENT words, so a paragraph scrolled sideways (overflow at 43 of 43 widths). The desktop layout check
 * (`npm run check:layout`, Chromium) passed it, and the regression reached an iPhone.
 *
 * This runs the one measurement that catches that class of bug (`task=overflow` in the layout harness: a run of
 * adjacent numbered words must wrap at every container width, three kinds of line) in Playwright's WebKit, against:
 *
 *   1. the real styles.css       - every variant must wrap, no sideways overflow, and
 *   2. a CANARY: the beta.4 styles.css, verbatim (scripts/eink-layout/fixtures) - it MUST overflow.
 *
 * (2) is what makes (1) mean anything. A WebKit that cannot reproduce the known regression would pass (1) and prove
 * nothing, so when the canary does not overflow this FAILS rather than reporting a green check.
 *
 * Playwright's WebKit is the closest thing to iOS Safari that runs on a Linux runner (shared WebCore line breaking,
 * which is where the bug lived), but it is a different port from iOS. Checked, not assumed: see the canary.
 *
 * Needs the browser once: `npx playwright install webkit` (CI does this at job time, never in `npm ci`). Without it,
 * on a developer machine this prints how to install it and exits 0; with CI set it FAILS.
 * Not part of check-release or release.yml: those must stay offline and deterministic.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleHarness, THEME } from "./eink-layout/bundle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function unavailable(why) {
  const msg = `check:webkit cannot run: ${why}\nInstall the browser with: npx playwright install webkit`;
  if (process.env.CI) {
    console.error(`${msg}\nFAILING because CI is set: a skipped WebKit check would look like a passing one.`);
    process.exit(1);
  }
  console.log(`${msg}\nSkipped (not CI).`);
  process.exit(0);
}

let webkit;
try {
  ({ webkit } = await import("playwright"));
} catch (e) {
  unavailable(`the playwright package is not installed (${e.message.split("\n")[0]})`);
}

let browser;
try {
  browser = await webkit.launch();
} catch (e) {
  unavailable(`WebKit would not start (${e.message.split("\n")[0]})`);
}

const tmp = mkdtempSync(join(tmpdir(), "cci-webkit-"));
writeFileSync(join(tmp, "bundle.js"), await bundleHarness(ROOT));

const floorOf = (css) => {
  const a = css.indexOf("/* eink:begin"), b = css.indexOf("/* eink:end */");
  const m = a >= 0 && b > a ? /var\(--cci-eink-floor,\s*(\d+)px\)/.exec(css.slice(a, b)) : null;
  return m ? Number(m[1]) : null;
};
const realCss = read("styles.css");
const canaryCss = read("scripts/eink-layout/fixtures/styles-0.7.8-beta.4.css");
const FLOOR = floorOf(realCss) ?? floorOf(canaryCss);
if (FLOOR == null) throw new Error("could not read the E-ink floor from styles.css");

async function overflow(name, css) {
  writeFileSync(
    join(tmp, `${name}.html`),
    `<!doctype html><meta charset="utf-8"><style>${THEME}${css}</style><body><script src="bundle.js"></script></body>`
  );
  const page = await browser.newPage({ viewport: { width: 3300, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  await page.goto(`file://${join(tmp, `${name}.html`)}?task=overflow&floor=${FLOOR}`);
  try {
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-result"), null, { timeout: 180000 });
  } catch {
    throw new Error(`${name}: the harness produced no result${errors.length ? ` (page error: ${errors[0]})` : ""}`);
  }
  const out = JSON.parse(await page.evaluate(() => document.documentElement.getAttribute("data-result"))).over;
  await page.close();
  return out;
}

const failures = [];
const note = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures.push(label);
};

console.log(`WebKit layout check — ${await browser.version()} (Playwright WebKit), floor ${FLOOR}px\n`);

const real = await overflow("real", realCss);
for (const [name, r] of Object.entries(real)) {
  note(r.over === 0 && r.multi > 0, `wraps to the screen, no sideways scroll: ${name}`,
    `${r.widths} widths, ${r.over} overflow${r.over ? ` (worst ${r.worst.toFixed(0)}px)` : ""}, wraps at ${r.multi}`);
}

const canary = await overflow("canary", canaryCss);
const bad = canary["hsk plain"];
note(bad.over > 0, "canary: the beta.4 stylesheet overflows here (this WebKit can see the bug)",
  `${bad.over} of ${bad.widths} widths overflow${bad.over ? ` (worst ${bad.worst.toFixed(0)}px)` : " — the gate above proves nothing in this WebKit"}`);

await browser.close();
console.log(`\n${failures.length ? failures.length + " check(s) FAILED" : "all checks passed"}.`);
process.exit(failures.length ? 1 : 0);
