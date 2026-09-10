#!/usr/bin/env node
/**
 * Stamp a prerelease version into the WORKING TREE ONLY.
 *
 * Why this exists
 * ---------------
 * Obsidian decides which version to advertise to Community Plugin users by
 * reading `manifest.json` on the repository's default branch, then downloading
 * the assets from the GitHub release whose tag matches that version:
 *
 *   "The manifest.json in your repo will only be used to figure out the latest
 *    version, while actual files are fetched from your GitHub releases."
 *
 * So if `main` advertises 0.7.0 while only 0.7.0-beta.1 exists, every user's
 * update check resolves to a release that does not exist. The default branch
 * manifest must therefore stay on the CURRENT STABLE version for as long as we
 * are only publishing prereleases.
 *
 * BRAT, by contrast, reads `manifest.json` from the RELEASE ASSETS and is
 * explicitly "independent of the version numbering in the repository root"
 * (BRAT-DEVELOPER-GUIDE.md). It picks the highest semver among releases and
 * prereleases. So the prerelease's *asset* manifest must carry the prerelease
 * version, even though the committed one must not.
 *
 * This script bridges those two facts: CI checks out the default branch (whose
 * manifest is the current stable version), stamps the prerelease version into
 * the working copy, and builds/publishes from that. Nothing is committed.
 *
 * Usage:
 *   node scripts/stamp-prerelease.mjs 0.7.0-beta.1
 *
 * Exits non-zero on any invalid input so the release workflow aborts before
 * anything is published.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `0.7.0-beta.1` → { full, base }. Rejects anything else. */
function parseTag(raw) {
  const tag = String(raw || "").replace(/^v/, "");
  const m = /^(\d+\.\d+\.\d+)-((?:rc|beta|alpha)\.\d+)$/.exec(tag);
  if (!m) {
    die(
      `not a prerelease tag: "${raw}"\n` +
        `  expected <major>.<minor>.<patch>-<rc|beta|alpha>.<n>, e.g. 0.7.0-beta.1`
    );
  }
  return { full: tag, base: m[1] };
}

function die(msg) {
  console.error(`stamp-prerelease: ${msg}`);
  process.exit(1);
}

async function readJson(rel) {
  try {
    return JSON.parse(await readFile(join(ROOT, rel), "utf8"));
  } catch (e) {
    die(`cannot read ${rel}: ${e.message}`);
  }
}

async function writeJson(rel, obj) {
  // Trailing newline keeps the files diff-clean if anyone ever inspects them.
  await writeFile(join(ROOT, rel), `${JSON.stringify(obj, null, "\t")}\n`, "utf8");
}

const { full, base } = parseTag(process.argv[2]);

const manifest = await readJson("manifest.json");
const pkg = await readJson("package.json");
const lock = await readJson("package-lock.json");
const versions = await readJson("versions.json");

const stable = manifest.version;

// Guard: the committed manifest must be a plain stable version. If it already
// carries a prerelease suffix, someone committed a beta to the default branch —
// exactly the state this whole mechanism exists to prevent.
if (/-/.test(stable)) {
  die(
    `manifest.json on this branch is already a prerelease ("${stable}").\n` +
      `  The default branch must advertise the current STABLE version.`
  );
}

// Guard: refuse to stamp a prerelease of a version we have already shipped.
// Going "backwards" would publish a beta that BRAT ranks below the stable
// release, so testers would silently keep the old build.
if (cmpSemver(base, stable) <= 0) {
  die(
    `refusing to stamp ${full}: its base version ${base} is not newer than the\n` +
      `  current stable ${stable}. Prereleases must target the NEXT version.`
  );
}

manifest.version = full;
pkg.version = full;
lock.version = full;
if (lock.packages && lock.packages[""]) lock.packages[""].version = full;

// `check-release` requires manifest.version to appear in versions.json. Add the
// prerelease key here so the guard runs unmodified against the stamped tree;
// this file is never committed, so the shipped versions.json stays clean.
versions[full] = manifest.minAppVersion;

await writeJson("manifest.json", manifest);
await writeJson("package.json", pkg);
await writeJson("package-lock.json", lock);
await writeJson("versions.json", versions);

console.log(
  `stamp-prerelease: working tree stamped ${stable} -> ${full}\n` +
    `  (committed default-branch manifest is untouched and still advertises ${stable})`
);

/** Numeric semver compare on `x.y.z`; returns <0, 0, >0. */
function cmpSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
