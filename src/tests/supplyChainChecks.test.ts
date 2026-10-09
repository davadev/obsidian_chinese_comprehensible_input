import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MIN_AGE_DAYS,
  checkDependabotCooldown,
  checkNpmrc,
  compareDotted,
  npmSupportsMinReleaseAge,
} from "../../scripts/lib/supplyChainChecks.mjs";

/**
 * #150: check-release must fail when the dependency-age policy is removed. check-release.mjs runs its checks on
 * import and cannot be unit-tested, so the predicates live in scripts/lib/supplyChainChecks.mjs and are pinned here,
 * together with the files as committed.
 */

const GOOD_DEPENDABOT = `version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    cooldown:
      default-days: 14
      semver-major-days: 30
    groups:
      x:
        patterns: ["*"]
  - package-ecosystem: github-actions
    directory: "/"
    cooldown:
      default-days: 14
`;

describe("the committed policy files", () => {
  it("dependabot.yml has a cooldown for npm and github-actions", () => {
    const r = checkDependabotCooldown(readFileSync(".github/dependabot.yml", "utf8"));
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it(".npmrc sets min-release-age", () => {
    const r = checkNpmrc(readFileSync(".npmrc", "utf8"));
    expect(r.problem).toBeNull();
    expect(r.days).toBeGreaterThanOrEqual(MIN_AGE_DAYS);
  });
});

describe("checkDependabotCooldown", () => {
  it("accepts a good config", () => {
    expect(checkDependabotCooldown(GOOD_DEPENDABOT)).toEqual({ ok: true, problems: [] });
  });

  it("fails when a cooldown block is removed from either ecosystem", () => {
    const noNpm = GOOD_DEPENDABOT.replace(/ {4}cooldown:\n {6}default-days: 14\n {6}semver-major-days: 30\n/, "");
    expect(checkDependabotCooldown(noNpm).problems).toEqual(['"npm" has no cooldown block']);
    const noActions = GOOD_DEPENDABOT.replace(/ {4}cooldown:\n {6}default-days: 14\n$/, "");
    expect(checkDependabotCooldown(noActions).problems).toEqual(['"github-actions" has no cooldown block']);
  });

  it("does not credit one ecosystem's cooldown to the other", () => {
    const onlyActions = GOOD_DEPENDABOT.replace(/ {4}cooldown:\n {6}default-days: 14\n {6}semver-major-days: 30\n/, "");
    expect(checkDependabotCooldown(onlyActions).ok).toBe(false);
  });

  it("fails when default-days is missing or too small", () => {
    const noDays = GOOD_DEPENDABOT.replace(/ {6}default-days: 14\n {6}semver-major-days/, "      semver-major-days");
    expect(checkDependabotCooldown(noDays).problems).toEqual(['"npm" cooldown has no default-days']);
    const low = GOOD_DEPENDABOT.replace("default-days: 14\n      semver", "default-days: 2\n      semver");
    expect(checkDependabotCooldown(low).problems[0]).toMatch(/default-days is 2/);
  });

  it("ignores a commented-out cooldown", () => {
    const commented = GOOD_DEPENDABOT.replace("    cooldown:\n      default-days: 14\n      semver-major", "    # cooldown:\n    #   default-days: 14\n      semver-major");
    expect(checkDependabotCooldown(commented).ok).toBe(false);
  });

  it("fails on a missing file or missing ecosystem", () => {
    expect(checkDependabotCooldown(null).ok).toBe(false);
    expect(checkDependabotCooldown("version: 2\nupdates: []\n").problems).toHaveLength(2);
  });
});

describe("checkNpmrc", () => {
  it("accepts min-release-age at or above the minimum", () => {
    expect(checkNpmrc("min-release-age=14\n")).toEqual({ ok: true, days: 14, problem: null });
    expect(checkNpmrc("# note\nmin-release-age = 20\n").days).toBe(20);
  });

  it("rejects absent, commented-out, low, zero and non-numeric values", () => {
    expect(checkNpmrc(null).ok).toBe(false);
    expect(checkNpmrc("registry=https://registry.npmjs.org/\n").ok).toBe(false);
    expect(checkNpmrc("# min-release-age=14\n").ok).toBe(false);
    expect(checkNpmrc("min-release-age=3\n").ok).toBe(false);
    expect(checkNpmrc("min-release-age=0\n").ok).toBe(false);
    expect(checkNpmrc("min-release-age=soon\n").ok).toBe(false);
  });
});

describe("npmSupportsMinReleaseAge", () => {
  // Measured 2026-10-09: npm 11.9.0 prints `Unknown project config "min-release-age"`, 11.10.0 does not, and
  // npm 10.9.9 silently accepts it (and `npm config get` echoes the value), so the version is the only signal.
  it("is true from 11.10.0 on", () => {
    expect(npmSupportsMinReleaseAge("11.10.0")).toBe(true);
    expect(npmSupportsMinReleaseAge("11.19.1")).toBe(true);
    expect(npmSupportsMinReleaseAge("12.0.0")).toBe(true);
  });

  it("is false before 11.10.0 and for garbage", () => {
    expect(npmSupportsMinReleaseAge("11.9.0")).toBe(false);
    expect(npmSupportsMinReleaseAge("10.9.9")).toBe(false);
    expect(npmSupportsMinReleaseAge("")).toBe(false);
    expect(npmSupportsMinReleaseAge(undefined)).toBe(false);
  });

  it("compares numerically, not as strings", () => {
    expect(compareDotted("11.10.0", "11.9.0")).toBe(1);
    expect(compareDotted("11.9.0", "11.10.0")).toBe(-1);
    expect(compareDotted("11.10.0", "11.10.0")).toBe(0);
  });
});
