import { describe, expect, it } from "vitest";
import {
  BackupEntry,
  applyRetention,
  backupFileName,
  backupId,
  compactTimestamp,
  compareVersions,
  decideStartup,
  formatBytes,
  isStableVersion,
  parseVersion,
  selectRestoreCandidate,
  shouldSkipSnapshot,
} from "../data/backupPolicy";

/**
 * #149: the rules behind automatic backups and the offer to go back after a downgrade. Pure, so every branch is a
 * table. The two properties that matter most are pinned twice (as examples and as a seeded random walk): a string sort
 * of versions gets betas wrong, and ten betas in a day must never push out the backup that leads back to the stable.
 */

describe("parseVersion", () => {
  it("reads stable versions, prereleases and build metadata", () => {
    expect(parseVersion("0.8.0")).toEqual({ major: 0, minor: 8, patch: 0, pre: [] });
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(parseVersion("0.8.0-beta.10")).toEqual({ major: 0, minor: 8, patch: 0, pre: ["beta", 10] });
    expect(parseVersion("1.0.0-rc.1+build.5")).toEqual({ major: 1, minor: 0, patch: 0, pre: ["rc", 1] });
  });

  it("returns null for anything that is not a version", () => {
    for (const bad of ["", "unknown", "1.2", "x.y.z", "1.2.3.4", undefined, null]) expect(parseVersion(bad as string)).toBeNull();
  });

  it("isStableVersion is false for prereleases and for garbage", () => {
    expect(isStableVersion("0.7.9")).toBe(true);
    expect(isStableVersion("0.8.0-beta.1")).toBe(false);
    expect(isStableVersion("unknown")).toBe(false);
  });
});

describe("compareVersions", () => {
  // Ascending order; every pair must compare accordingly in both directions.
  const ASCENDING = [
    "0.7.8",
    "0.7.9-beta.1",
    "0.7.9-beta.2",
    "0.7.9-beta.9",
    "0.7.9-beta.10", // 10 > 9: a string sort puts it before beta.2
    "0.7.9-rc.1",
    "0.7.9",
    "0.8.0-alpha",
    "0.8.0-alpha.1",
    "0.8.0-beta",
    "0.8.0-beta.1",
    "0.8.0",
    "0.10.0", // 10 > 9 in the minor position too
    "1.0.0",
  ];

  it("orders a ladder of versions, every pair in both directions", () => {
    for (let i = 0; i < ASCENDING.length; i++) {
      for (let j = 0; j < ASCENDING.length; j++) {
        const want = i === j ? 0 : i < j ? -1 : 1;
        expect(compareVersions(ASCENDING[i], ASCENDING[j]), `${ASCENDING[i]} vs ${ASCENDING[j]}`).toBe(want);
      }
    }
  });

  it("a stable release outranks its own prereleases", () => {
    expect(compareVersions("0.8.0", "0.8.0-beta.99")).toBe(1);
    expect(compareVersions("0.8.0-beta.2", "0.8.0")).toBe(-1);
  });

  it("numeric identifiers rank below alphanumeric ones; a longer prerelease outranks its prefix", () => {
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  });

  it("build metadata does not affect precedence", () => {
    expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
  });

  it("unparseable orders below every real version, and two unparseable are equal", () => {
    expect(compareVersions("unknown", "0.0.1")).toBe(-1);
    expect(compareVersions("0.0.1", "unknown")).toBe(1);
    expect(compareVersions("unknown", "garbage")).toBe(0);
    expect(compareVersions(undefined, "0.0.1")).toBe(-1);
  });
});

describe("decideStartup", () => {
  it.each([
    [undefined, "0.8.0", "first-run"],
    ["", "0.8.0", "first-run"],
    ["0.8.0", "0.8.0", "same"],
    ["0.8.0-beta.1", "0.8.0-beta.2", "upgrade"],
    ["0.8.0-beta.9", "0.8.0-beta.10", "upgrade"],
    ["0.8.0-beta.3", "0.8.0", "upgrade"],
    ["0.8.0", "0.8.0-beta.3", "downgrade"],
    ["0.8.0-beta.10", "0.8.0-beta.9", "downgrade"],
    ["0.8.0", "0.7.9", "downgrade"],
    ["0.7.9", "0.8.0-beta.1", "upgrade"],
  ])("last %s, running %s -> %s", (lastRun, running, want) => {
    expect(decideStartup({ lastRun, running })).toBe(want);
  });

  it("falls back to 'upgrade' (which backs up) when versions cannot be compared", () => {
    expect(decideStartup({ lastRun: "dev-build", running: "0.8.0" })).toBe("upgrade");
    expect(decideStartup({ lastRun: "dev-build", running: "dev-build" })).toBe("same");
  });
});

let seq = 0;
function entry(fromVersion: string, createdAt: string, over: Partial<BackupEntry> = {}): BackupEntry {
  seq++;
  return {
    id: `id${seq}`,
    createdAt,
    fromVersion,
    kind: "version-change",
    file: `f${seq}.json.gz`,
    encoding: "gzip",
    rawBytes: 100,
    storedBytes: 10,
    sha256: `hash${seq}`,
    includes: ["data"],
    ...over,
  };
}
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();

describe("selectRestoreCandidate", () => {
  // Stable S, then betas b1, b2, b3. Each version change snapshots the data as the PREVIOUS version left it, so the
  // backups are labelled S (taken when b1 first ran), b1 (when b2 ran) and b2 (when b3 ran).
  const S = "0.7.9", b1 = "0.8.0-beta.1", b2 = "0.8.0-beta.2", b3 = "0.8.0-beta.3";
  const walk = [entry(S, at(1)), entry(b1, at(2)), entry(b2, at(3))];

  it("back on S: only the S backup qualifies, which is exactly the data S left", () => {
    expect(selectRestoreCandidate(walk, S)).toBe(walk[0]);
  });

  it("back on b1: S and b1 qualify and the newer, b1, wins", () => {
    expect(selectRestoreCandidate(walk, b1)).toBe(walk[1]);
  });

  it("back on b2 picks b2's data; on b3 (no downgrade, but asked anyway) picks the newest", () => {
    expect(selectRestoreCandidate(walk, b2)).toBe(walk[2]);
    expect(selectRestoreCandidate(walk, b3)).toBe(walk[2]);
  });

  it("returns null when nothing was written by this version or older", () => {
    expect(selectRestoreCandidate([entry(b2, at(1))], S)).toBeNull();
    expect(selectRestoreCandidate([], S)).toBeNull();
  });

  it("a backup of unknown origin is treated as oldest, so it is offered to any version", () => {
    const unknown = entry("unknown", at(1));
    expect(selectRestoreCandidate([unknown], S)).toBe(unknown);
    expect(selectRestoreCandidate([unknown, entry(b1, at(2))], S)).toBe(unknown);
  });

  it("is not fooled by a string sort: beta.10 is newer than beta.9", () => {
    const e9 = entry("0.8.0-beta.9", at(1));
    const e10 = entry("0.8.0-beta.10", at(2));
    expect(selectRestoreCandidate([e9, e10], "0.8.0-beta.9")).toBe(e9);
    expect(selectRestoreCandidate([e9, e10], "0.8.0-beta.10")).toBe(e10);
  });

  it("a downgrade-safety backup labelled with the NEWER version never qualifies", () => {
    const safety = entry(b3, at(9), { kind: "downgrade-safety" });
    expect(selectRestoreCandidate([walk[0], safety], S)).toBe(walk[0]);
  });
});

describe("applyRetention", () => {
  it("keeps the newest N, newest first", () => {
    const es = [1, 2, 3, 4, 5, 6, 7].map((n) => entry("0.8.0-beta.1", at(n)));
    const r = applyRetention(es, 3);
    expect(r.keep.map((e) => e.createdAt)).toEqual([at(7), at(6), at(5)]);
    expect(r.drop).toHaveLength(4);
  });

  it("ten betas in a day with keep 5 never evict the stable-origin backup", () => {
    const stable = entry("0.7.9", at(0));
    const betas = Array.from({ length: 10 }, (_, i) => entry(`0.8.0-beta.${i + 1}`, at(i + 1)));
    const r = applyRetention([stable, ...betas], 5);
    expect(r.keep).toContain(stable);
    expect(r.keep).toHaveLength(6); // newest 5 betas + the pinned stable one
    expect(r.keep.filter((e) => e !== stable)).toEqual([...betas].reverse().slice(0, 5));
  });

  it("pins only the NEWEST stable-origin backup, so an older stable one can age out", () => {
    const old = entry("0.7.8", at(0));
    const newer = entry("0.7.9", at(1));
    const betas = Array.from({ length: 6 }, (_, i) => entry(`0.8.0-beta.${i + 1}`, at(i + 2)));
    const r = applyRetention([old, newer, ...betas], 3);
    expect(r.keep).toContain(newer);
    expect(r.drop).toContain(old);
  });

  it("does nothing when there are fewer entries than the limit", () => {
    const es = [entry("0.7.9", at(1))];
    expect(applyRetention(es, 5)).toEqual({ keep: es, drop: [] });
  });

  it("never keeps fewer than one, whatever the setting", () => {
    const es = [entry("0.8.0-beta.1", at(1)), entry("0.8.0-beta.2", at(2))];
    for (const bad of [0, -3, NaN, 0.4]) expect(applyRetention(es, bad as number).keep).toHaveLength(1);
  });

  it("a seeded random walk of upgrades and downgrades never loses the newest stable-origin backup", () => {
    // Mulberry32: deterministic, so a failure reproduces from its seed.
    const rng = (seed: number) => () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const keep = 1 + Math.floor(r() * 6);
      let all: BackupEntry[] = [];
      let newestStable: BackupEntry | null = null;
      for (let step = 0; step < 40; step++) {
        const v = r() < 0.2 ? `0.${7 + Math.floor(r() * 3)}.${Math.floor(r() * 3)}` : `0.8.0-beta.${1 + Math.floor(r() * 12)}`;
        const e = entry(v, at(step));
        all = applyRetention([...all, e], keep).keep;
        if (isStableVersion(v)) newestStable = e;
        if (newestStable) expect(all, `seed ${seed} step ${step} keep ${keep}`).toContain(newestStable);
        expect(all.length).toBeLessThanOrEqual(keep + 1);
      }
    }
  });
});

describe("shouldSkipSnapshot", () => {
  it("skips when the newest backup already has this exact data", () => {
    const es = [entry("0.7.9", at(1), { sha256: "A" }), entry("0.8.0-beta.1", at(2), { sha256: "B" })];
    expect(shouldSkipSnapshot("B", es)).toBe(true);
  });

  it("does not skip for different data, for an empty history, or for an older match (A, B, A)", () => {
    const es = [entry("0.7.9", at(1), { sha256: "A" }), entry("0.8.0-beta.1", at(2), { sha256: "B" })];
    expect(shouldSkipSnapshot("C", es)).toBe(false);
    expect(shouldSkipSnapshot("A", es)).toBe(false);
    expect(shouldSkipSnapshot("A", [])).toBe(false);
  });
});

describe("names", () => {
  it("compactTimestamp drops separators and milliseconds", () => {
    expect(compactTimestamp("2026-10-10T10:15:00.123Z")).toBe("20261010T101500Z");
  });

  it("ids and file names are safe on every file system", () => {
    const id = backupId("2026-10-10T10:15:00.000Z", "version-change", "0.8.0-beta.3");
    expect(id).toBe("20261010T101500Z-version-change-from-0.8.0-beta.3");
    expect(backupFileName(id, "gzip")).toBe(`${id}.json.gz`);
    expect(backupFileName(id, "none")).toBe(`${id}.json`);
    expect(backupId("2026-10-10T10:15:00.000Z", "manual", "a/b:c")).toBe("20261010T101500Z-manual-from-a_b_c");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [812, "812 B"],
    [1024, "1 KB"],
    [49_152, "48 KB"],
    [1_572_864, "1.5 MB"],
    [5_000_000, "4.8 MB"],
  ])("%d -> %s", (n, want) => expect(formatBytes(n)).toBe(want));

  it("never prints NaN or a negative size", () => {
    for (const bad of [NaN, -1, Infinity]) expect(formatBytes(bad)).toBe("?");
  });
});
