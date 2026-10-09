// Pure predicates behind check-release's dependency-age gates (issue #150).
// Kept free of I/O so src/tests/supplyChainChecks.test.ts can exercise them;
// check-release.mjs itself runs its checks on import and cannot be unit-tested.
//
// No external deps — pure Node ESM, regex parsing only (no YAML parser here).

/** Minimum age, in days, a dependency version must have before we adopt it. */
export const MIN_AGE_DAYS = 14;

/** The npm release that introduced `min-release-age`. 11.9.0 warns "Unknown project config", 11.10.0 accepts it. */
export const MIN_NPM_WITH_RELEASE_AGE = "11.10.0";

/** Ecosystems that must carry a cooldown in .github/dependabot.yml. */
export const REQUIRED_ECOSYSTEMS = ["npm", "github-actions"];

const stripComments = (text) =>
  text
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, ""))
    .join("\n");

/** Compare plain `X.Y.Z` versions (npm's own versions; no prerelease handling needed). */
export function compareDotted(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * `npm config get min-release-age` echoes the value even on npm versions that
 * do not implement it (npm 10 printed `7`), so the effective npm VERSION is the
 * only reliable signal that the setting is honoured.
 */
export function npmSupportsMinReleaseAge(npmVersion) {
  if (!/^\d+\.\d+\.\d+/.test(String(npmVersion ?? ""))) return false;
  return compareDotted(npmVersion, MIN_NPM_WITH_RELEASE_AGE) >= 0;
}

/**
 * Validate .npmrc text. Returns { ok, days, problem }.
 * Accepts only a plain positive integer number of days >= minDays.
 */
export function checkNpmrc(text, minDays = MIN_AGE_DAYS) {
  if (typeof text !== "string") return { ok: false, days: null, problem: ".npmrc is missing" };
  const m = stripComments(text).match(/^\s*min-release-age\s*=\s*(\S+)\s*$/m);
  if (!m) return { ok: false, days: null, problem: ".npmrc does not set min-release-age" };
  const raw = m[1].replace(/^["']|["']$/g, "");
  if (!/^\d+$/.test(raw)) return { ok: false, days: null, problem: `min-release-age is not a whole number of days: ${raw}` };
  const days = parseInt(raw, 10);
  if (days < minDays) return { ok: false, days, problem: `min-release-age is ${days} day(s), policy minimum is ${minDays}` };
  return { ok: true, days, problem: null };
}

/**
 * Validate .github/dependabot.yml text: every required ecosystem has a
 * `cooldown:` block whose `default-days` is >= minDays. Returns
 * { ok, problems[] }.
 */
export function checkDependabotCooldown(text, minDays = MIN_AGE_DAYS, ecosystems = REQUIRED_ECOSYSTEMS) {
  if (typeof text !== "string") return { ok: false, problems: [".github/dependabot.yml is missing"] };
  const body = stripComments(text);
  // Split into one chunk per `- package-ecosystem:` entry.
  const parts = body.split(/^\s*-\s*package-ecosystem:\s*/m).slice(1);
  const byEco = new Map();
  for (const p of parts) {
    const eco = (p.match(/^["']?([\w-]+)["']?/) || [])[1];
    if (eco) byEco.set(eco, p);
  }
  const problems = [];
  for (const eco of ecosystems) {
    const chunk = byEco.get(eco);
    if (chunk === undefined) {
      problems.push(`no "${eco}" ecosystem in dependabot.yml`);
      continue;
    }
    const lines = chunk.split("\n");
    const at = lines.findIndex((l) => /^\s*cooldown:\s*$/.test(l));
    if (at === -1) {
      problems.push(`"${eco}" has no cooldown block`);
      continue;
    }
    // The block is every following line indented deeper than `cooldown:`.
    const indent = lines[at].match(/^\s*/)[0].length;
    const block = [];
    for (let i = at + 1; i < lines.length; i++) {
      if (lines[i].trim() === "") continue;
      if (lines[i].match(/^\s*/)[0].length <= indent) break;
      block.push(lines[i]);
    }
    const scope = block.join("\n");
    const dd = scope.match(/^\s*default-days:\s*(\d+)\s*$/m);
    if (!dd) {
      problems.push(`"${eco}" cooldown has no default-days`);
      continue;
    }
    const days = parseInt(dd[1], 10);
    if (days < minDays) problems.push(`"${eco}" cooldown default-days is ${days}, policy minimum is ${minDays}`);
  }
  return { ok: problems.length === 0, problems };
}
