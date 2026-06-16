#!/usr/bin/env node
// Pre-release checks for an Obsidian plugin. Runs locally (developer
// runs `npm run check-release` before tagging) and in CI (drop-in,
// auto-picks tag from GITHUB_REF_NAME / GITHUB_REF). Exit code 0 on
// pass, 1 on any FAIL. WARN does not affect exit code.
//
// Invocation:
//   node scripts/check-release.mjs
//   node scripts/check-release.mjs --tag 0.2.4
//   node scripts/check-release.mjs --with-build   # also runs npm build + test
//   node scripts/check-release.mjs --tag $GITHUB_REF_NAME --with-build
//
// No external deps — pure Node ESM. Node ≥ 18.

import { readFile, stat, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- CLI ----------
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}
const hasFlag = (f) => argv.includes(f);
const tagFromCli = argValue("--tag");
const tagFromEnv =
  process.env.GITHUB_REF_NAME ||
  (process.env.GITHUB_REF && process.env.GITHUB_REF.startsWith("refs/tags/")
    ? process.env.GITHUB_REF.slice("refs/tags/".length)
    : null);
const rawTag = tagFromCli || tagFromEnv;
const tag = rawTag ? rawTag.replace(/^v/, "") : null;
const runBuildAndTest = hasFlag("--with-build");

// ---------- Reporting ----------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  gray: (s) => (useColor ? `\x1b[90m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};
const results = { pass: 0, fail: 0, warn: 0, skip: 0 };
function pass(name, detail = "") {
  results.pass++;
  console.log(`${c.green("✓")} ${name}${detail ? `: ${c.gray(detail)}` : ""}`);
}
function fail(name, detail = "") {
  results.fail++;
  console.log(`${c.red("✗")} ${name}${detail ? `: ${detail}` : ""}`);
}
function warn(name, detail = "") {
  results.warn++;
  console.log(`${c.yellow("!")} ${name}${detail ? `: ${detail}` : ""}`);
}
function skip(name, detail = "") {
  results.skip++;
  console.log(`${c.gray("·")} ${name}${detail ? ` (${detail})` : ""}`);
}

// ---------- Helpers ----------
async function fileSize(p) {
  try {
    const s = await stat(join(ROOT, p));
    return s.isFile() ? s.size : -1;
  } catch {
    return -1;
  }
}

async function readJson(p) {
  const raw = await readFile(join(ROOT, p), "utf8");
  return JSON.parse(raw);
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      await walk(full, out);
    } else if (e.isFile() && /\.(ts|tsx|js|mjs)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Read every source file under src/ once, return [{path, text}]. Skips
 *  tests so noisy debug code in fixtures doesn't pollute the hygiene
 *  checks. Cached at module-load time so each check is a pure scan. */
let _srcCache = null;
async function srcFiles() {
  if (_srcCache) return _srcCache;
  const files = await walk(join(ROOT, "src"));
  const out = [];
  for (const f of files) {
    if (f.includes(`${"src"}/tests/`) || f.includes(`${"src"}\\tests\\`)) continue;
    try {
      out.push({ path: relative(ROOT, f), text: await readFile(f, "utf8") });
    } catch {
      /* unreadable file — skip */
    }
  }
  return (_srcCache = out);
}

async function readText(p) {
  try {
    return await readFile(join(ROOT, p), "utf8");
  } catch {
    return null;
  }
}

// Allow-list of hosts considered legitimate fundingUrl targets per the
// Obsidian community-plugin guidelines (financial-support services).
const FUNDING_HOSTS = [
  "github.com", // sponsors
  "ko-fi.com",
  "buymeacoffee.com",
  "buymeacoffe.com",
  "patreon.com",
  "opencollective.com",
  "liberapay.com",
  "paypal.me",
  "paypal.com",
  "stripe.com",
];

// Node-only modules that crash on Obsidian mobile. Plugin must either
// avoid them or set isDesktopOnly:true in the manifest.
const NODE_ONLY_IMPORTS = ["fs", "node:fs", "path", "node:path", "child_process", "node:child_process", "os", "node:os", "electron"];

// ---------- Checks ----------

// === Artifact presence ===
const required = [
  { path: "manifest.json", label: "manifest.json present and non-empty" },
  { path: "main.js", label: "main.js present and non-empty" },
  { path: "versions.json", label: "versions.json present" },
  { path: "README.md", label: "README.md present" },
  { path: "LICENSE", label: "LICENSE present" },
];
for (const r of required) {
  const sz = await fileSize(r.path);
  if (sz > 0) pass(r.label, `${sz} B`);
  else if (sz === 0) fail(r.label, `${r.path} is empty`);
  else fail(r.label, `${r.path} missing`);
}

// === styles.css: required iff source actually uses cci- classes ===
const css = await fileSize("styles.css");
async function usesCssClasses() {
  const re = /\bcci-[a-z][a-z0-9-]*/;
  for (const f of await srcFiles()) {
    if (re.test(f.text)) return { used: true, where: f.path };
  }
  return { used: false, where: null };
}
const cssUsage = await usesCssClasses();
if (cssUsage.used) {
  if (css > 0) pass("styles.css present (CSS classes used in source)", `${css} B`);
  else if (css === 0) fail("styles.css present", "styles.css is empty but source declares cci- classes");
  else fail("styles.css present", `missing — source declares cci- classes (e.g. ${cssUsage.where})`);
} else if (css > 0) {
  pass("styles.css present (no cci- classes detected, but stylesheet exists)", `${css} B`);
} else {
  skip("styles.css present", "plugin appears not to use CSS");
}

// === JSON validity ===
let manifest = null;
try {
  manifest = await readJson("manifest.json");
  pass("manifest.json parses as JSON");
} catch (e) {
  fail("manifest.json parses as JSON", e.message);
}
let pkg = null;
try {
  pkg = await readJson("package.json");
  pass("package.json parses as JSON");
} catch (e) {
  fail("package.json parses as JSON", e.message);
}
let versionsBlob = null;
try {
  versionsBlob = await readJson("versions.json");
  pass("versions.json parses as JSON");
} catch (e) {
  fail("versions.json parses as JSON", e.message);
}

// === Manifest schema + completeness ===
if (manifest) {
  const reqStrings = ["id", "name", "version", "minAppVersion", "description", "author"];
  const missing = reqStrings.filter((k) => typeof manifest[k] !== "string" || manifest[k].length === 0);
  if (missing.length === 0) pass("manifest.json required string fields", reqStrings.join(", "));
  else fail("manifest.json required string fields", `missing/empty: ${missing.join(", ")}`);

  if (typeof manifest.description === "string" && manifest.description.length < 30) {
    warn("manifest.description is reasonably descriptive", `${manifest.description.length} chars — aim for ≥30`);
  } else if (typeof manifest.description === "string") {
    pass("manifest.description is reasonably descriptive", `${manifest.description.length} chars`);
  }

  if (typeof manifest.isDesktopOnly !== "boolean") {
    fail("manifest.isDesktopOnly is a boolean", `got ${typeof manifest.isDesktopOnly}`);
  } else {
    pass("manifest.isDesktopOnly is a boolean", String(manifest.isDesktopOnly));
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id || "")) {
    warn("manifest.id is kebab-case", `id="${manifest.id}" — Obsidian expects lowercase a-z, 0-9, hyphen`);
  } else {
    pass("manifest.id is kebab-case", manifest.id);
  }

  if (manifest.authorUrl != null) {
    if (typeof manifest.authorUrl === "string" && /^https?:\/\//.test(manifest.authorUrl)) {
      pass("manifest.authorUrl is an http(s) URL", manifest.authorUrl);
    } else {
      warn("manifest.authorUrl is an http(s) URL", `got "${manifest.authorUrl}"`);
    }
  } else {
    skip("manifest.authorUrl set", "optional");
  }

  // fundingUrl, when present, must point to a known financial-support
  // service per the Obsidian community-plugin guidelines.
  if (manifest.fundingUrl != null) {
    const urls =
      typeof manifest.fundingUrl === "string"
        ? [manifest.fundingUrl]
        : typeof manifest.fundingUrl === "object"
        ? Object.values(manifest.fundingUrl)
        : [];
    const bad = [];
    for (const u of urls) {
      let host = "";
      try {
        host = new URL(u).hostname.replace(/^www\./, "");
      } catch {
        bad.push(`${u} (not a URL)`);
        continue;
      }
      if (!FUNDING_HOSTS.some((h) => host === h || host.endsWith("." + h))) bad.push(`${u} (host=${host})`);
    }
    if (bad.length === 0) pass("manifest.fundingUrl points to a financial-support service", urls.join(", "));
    else fail("manifest.fundingUrl points to a financial-support service", `unrecognized: ${bad.join(", ")}`);
  } else {
    pass("manifest.fundingUrl absent (allowed)");
  }
}

// === Version sync ===
if (manifest && pkg) {
  if (manifest.version === pkg.version) {
    pass(`manifest.version (${manifest.version}) matches package.json.version`);
  } else {
    fail("manifest.version matches package.json.version", `manifest=${manifest.version}, package=${pkg.version}`);
  }
}
if (manifest && versionsBlob) {
  if (Object.prototype.hasOwnProperty.call(versionsBlob, manifest.version)) {
    pass(`manifest.version (${manifest.version}) listed in versions.json`);
  } else {
    fail(
      "manifest.version listed in versions.json",
      `add "${manifest.version}": "${manifest.minAppVersion || "1.5.0"}" to versions.json`
    );
  }
}

// === Tag comparison ===
if (tag && manifest) {
  if (manifest.version === tag) {
    pass(`manifest.version (${manifest.version}) matches release tag ${rawTag}`);
  } else {
    fail(
      "manifest.version matches release tag",
      `manifest=${manifest.version}, tag=${tag}` + (rawTag !== tag ? ` (raw=${rawTag})` : "")
    );
  }
} else {
  skip("manifest.version matches release tag", "no --tag arg and no GITHUB_REF_NAME / GITHUB_REF in env");
}

// === README content heuristics ===
const readme = await readText("README.md");
if (readme) {
  const lower = readme.toLowerCase();
  const sections = {
    purpose: /(purpose|overview|what (is|this)|introduction)\b/.test(lower) || readme.length > 800,
    usage: /(usage|how to use|getting started|use this|using)\b/.test(lower),
    settings: /(settings|configuration|configure|options)\b/.test(lower),
    limitations: /(limitation|known issue|caveat|not supported|does not (work|support))\b/.test(lower),
  };
  const miss = Object.entries(sections)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  if (miss.length === 0) pass("README.md covers purpose, usage, settings, limitations");
  else warn("README.md covers purpose, usage, settings, limitations", `missing keywords for: ${miss.join(", ")}`);
} else {
  skip("README.md content check", "README.md unreadable");
}

// === Code hygiene: hardcoded local paths (FAIL) ===
{
  const re = /\/(?:Users|home)\/[a-zA-Z][\w.-]*|[A-Za-z]:\\Users\\[a-zA-Z]/;
  const hits = [];
  for (const f of await srcFiles()) {
    const m = f.text.match(re);
    if (m) hits.push(`${f.path}: ${m[0]}`);
  }
  if (hits.length === 0) pass("no hardcoded local paths in source");
  else fail("no hardcoded local paths in source", hits.slice(0, 3).join("; ") + (hits.length > 3 ? ` (+${hits.length - 3} more)` : ""));
}

// === Code hygiene: console.log count (WARN if > threshold) ===
{
  const threshold = 30;
  let count = 0;
  for (const f of await srcFiles()) {
    const m = f.text.match(/\bconsole\.log\s*\(/g);
    if (m) count += m.length;
  }
  if (count <= threshold) pass(`console.log usage in source under ${threshold}`, `${count} occurrences`);
  else warn(`console.log usage in source under ${threshold}`, `${count} occurrences — consider gating debug output`);
}

// === External network usage documented ===
{
  let usesNetwork = false;
  for (const f of await srcFiles()) {
    if (/\b(fetch|requestUrl)\s*\(/.test(f.text)) {
      usesNetwork = true;
      break;
    }
  }
  if (!usesNetwork) {
    skip("external network usage documented", "no fetch/requestUrl in source");
  } else {
    const docs = [readme, await readText("docs/openai-setup.md")].filter((s) => typeof s === "string").join("\n").toLowerCase();
    const documented = /(api|external|network|internet|http|openai|ollama|third[- ]?party|cloud)/.test(docs);
    if (documented) pass("external network usage documented in README/docs");
    else warn("external network usage documented in README/docs", "source uses fetch/requestUrl but README/docs don't mention it");
  }
}

// === Mobile support: node-only imports vs isDesktopOnly ===
if (manifest) {
  const desktopOnly = manifest.isDesktopOnly === true;
  const violations = [];
  const importRe = /(?:from|require\s*\()\s*['"]([^'"]+)['"]/g;
  for (const f of await srcFiles()) {
    let m;
    while ((m = importRe.exec(f.text)) !== null) {
      const spec = m[1];
      if (NODE_ONLY_IMPORTS.includes(spec)) violations.push(`${f.path}: import "${spec}"`);
    }
  }
  if (violations.length === 0) {
    pass(
      "mobile-safe imports",
      desktopOnly ? "no node-only imports (isDesktopOnly=true also set)" : "no node-only imports — runs on mobile"
    );
  } else if (desktopOnly) {
    pass("mobile-safe imports", `node-only imports OK because manifest.isDesktopOnly=true (${violations.length} sites)`);
  } else {
    fail(
      "mobile-safe imports",
      `node-only imports found but isDesktopOnly is not true: ${violations.slice(0, 3).join("; ")}` +
        (violations.length > 3 ? ` (+${violations.length - 3} more)` : "")
    );
  }
}

// === Vault paths use normalizePath() ===
{
  const adapterCallRe = /\badapter\.\s*(?:read|write|exists|mkdir|list|append|remove|rename)\b/;
  const offenders = [];
  for (const f of await srcFiles()) {
    if (!adapterCallRe.test(f.text)) continue;
    if (!/\bnormalizePath\s*\(/.test(f.text)) offenders.push(f.path);
  }
  if (offenders.length === 0) {
    pass("user-defined vault paths use normalizePath()");
  } else {
    warn(
      "user-defined vault paths use normalizePath()",
      `${offenders.length} file(s) touch adapter.* without normalizePath: ${offenders.slice(0, 3).join(", ")}` +
        (offenders.length > 3 ? ` (+${offenders.length - 3} more)` : "")
    );
  }
}

// === Release assets: only expected distributable files ===
{
  const dirEntries = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
  const strays = dirEntries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => /\.(ts|tsx)$/.test(n) || n === "main.js.map" || /\.bak$/.test(n) || /^\.DS_Store$/.test(n))
    // Allowlist root-level config files — vitest/esbuild/postcss configs
    // belong at root and aren't release artifacts.
    .filter((n) => !/\.config\.(ts|tsx|js|mjs|cjs)$/.test(n));
  if (strays.length === 0) pass("no stray distributable cruft at repo root");
  else warn("no stray distributable cruft at repo root", strays.join(", "));
}

// === Build/test scripts exist + (optional) run them ===
if (pkg) {
  const scripts = pkg.scripts || {};
  const required = ["build", "test"];
  const missingScripts = required.filter((s) => typeof scripts[s] !== "string");
  if (missingScripts.length === 0) pass("package.json defines build and test scripts");
  else fail("package.json defines build and test scripts", `missing: ${missingScripts.join(", ")}`);

  if (typeof scripts.lint === "string") pass("lint script present", scripts.lint);
  else skip("lint script present", "optional");

  if (runBuildAndTest) {
    for (const script of ["build", "test"]) {
      if (typeof scripts[script] !== "string") {
        skip(`npm run ${script} passes`, "script not defined");
        continue;
      }
      console.log(c.gray(`  → running npm run ${script} (this may take a moment)…`));
      const r = spawnSync("npm", ["run", script, "--silent"], { cwd: ROOT, stdio: "pipe", encoding: "utf8" });
      if (r.status === 0) pass(`npm run ${script} passes`);
      else fail(`npm run ${script} passes`, `exit ${r.status}: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
    }
  } else {
    skip("npm run build passes", "pass --with-build to execute");
    skip("npm run test passes", "pass --with-build to execute");
  }
}

// ---------- Summary ----------
const total = results.pass + results.fail + results.warn + results.skip;
const status =
  results.fail === 0
    ? c.green("ready to release.") + (results.warn ? c.yellow(` (${results.warn} warning${results.warn === 1 ? "" : "s"} — review but non-blocking)`) : "")
    : c.red("DO NOT release.");
console.log("");
console.log(
  c.bold(
    `${total} checks · ${results.pass} passed, ${results.fail} failed, ${results.warn} warned, ${results.skip} skipped — ${status}`
  )
);
process.exit(results.fail === 0 ? 0 : 1);
