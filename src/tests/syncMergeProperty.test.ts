import { describe, it, expect } from "vitest";
import { mergeForSync, resolveStatus } from "../vocabulary/syncMerge";
import { KnownAxes, WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { statusFromAxes } from "../vocabulary/axes";
import { DEFAULT_STATUS_PRIORITY } from "../settings/defaults";

/**
 * #135: mergeForSync(a, b) must equal mergeForSync(b, a) byte for byte, because each device calls it with its own
 * record as `a`. Shapes are drawn from small pools on purpose, so equal timestamps, equal-but-reordered values and
 * one-sided fields (the cases that used to depend on argument order) come up constantly rather than never.
 * A seeded generator, not a dependency: a failure prints its seed and reproduces.
 */

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const maybe = <T,>(r: () => number, make: () => T, p = 0.6): T | undefined => (r() < p ? make() : undefined);
const shuffle = <T,>(r: () => number, xs: T[]): T[] => {
  const o = xs.slice();
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
};

// Two spellings of the same instant are included: they compare unequal as strings, which is what the store does.
const TIMES = [
  "2026-06-10T00:00:00.000Z",
  "2026-06-10T00:00:00Z",
  "2026-06-11T00:00:00.000Z",
  "2026-06-12T00:00:00.000Z",
];
const DAYS = ["2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"];
const SURFACES = ["你好", "妳好", "你們", "好"];
const AXES: KnownAxes[] = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ chars: !!(n & 1), pinyin: !!(n & 2), meaning: !!(n & 4) }));

function genRecord(r: () => number): WordRecord {
  const axes = pick(r, AXES);
  const status: WordStatus = pick(r, ["new", "ignored", statusFromAxes(axes)] as WordStatus[]);
  const daily: Record<string, number> = {};
  for (const d of shuffle(r, DAYS).slice(0, Math.floor(r() * 4))) daily[d] = 1 + Math.floor(r() * 3);
  const notesSeen = maybe(r, () => {
    const o: Record<string, number> = {};
    for (const n of shuffle(r, ["a.md", "b.md", "c.md"]).slice(0, 1 + Math.floor(r() * 3))) o[n] = 1 + Math.floor(r() * 3);
    return o;
  });
  const rec: WordRecord = {
    key: "k",
    surfaces: shuffle(r, SURFACES).slice(0, 1 + Math.floor(r() * 3)),
    simplified: pick(r, ["你好", "您好", "", undefined]),
    traditional: pick(r, ["你好", "妳好", undefined]),
    pinyin: pick(r, ["nǐ hǎo", "ni3 hao3", "", undefined]),
    definitions: pick(r, [["hello"], ["hi", "hello"], ["hello", "hi"], [], undefined]),
    hsk: pick(r, [{ source: "x", levels: ["1"] }, { source: "x", levels: ["2"] }, undefined]),
    status,
    axes: maybe(r, () => axes, 0.8),
    firstSeenAt: maybe(r, () => pick(r, TIMES)),
    backfilledAt: maybe(r, () => pick(r, TIMES), 0.3),
    lastSeenAt: maybe(r, () => pick(r, TIMES)),
    knownAt: maybe(r, () => pick(r, TIMES), 0.4),
    classifiedAt: maybe(r, () => pick(r, TIMES), 0.4),
    seenCount: Object.values(daily).reduce((s, n) => s + n, 0),
    recentSeenAt: shuffle(r, TIMES).slice(0, Math.floor(r() * 4)).sort(),
    dailySeenCounts: daily,
    notesSeenCounts: notesSeen,
    mnemonic: maybe(r, () => ({ text: pick(r, ["m1", "m2"]), updatedAt: pick(r, [...TIMES, undefined]) }), 0.4),
    srs: maybe(r, () => ({ dueAt: pick(r, TIMES), intervalDays: pick(r, [1, 3]), lastReviewedAt: pick(r, [...TIMES, undefined]) }), 0.4),
    notes: pick(r, ["n1", "n2", "", undefined]),
    updatedAt: pick(r, TIMES),
  };
  if (status === "ignored") rec.ignoredReason = pick(r, ["dup", "name", "", undefined]);
  return rec;
}

const ser = (x: unknown): string => JSON.stringify(x);
const N = 3000;
const PRIORITIES: WordStatus[][] = [
  DEFAULT_STATUS_PRIORITY,
  [...DEFAULT_STATUS_PRIORITY].reverse(),
  ["known", "ignored"], // partial list: statuses outside it fall through to the timestamp rule
];

function forEachPair(fn: (a: WordRecord, b: WordRecord, opts: { statusPriority: WordStatus[] }, seed: number) => void) {
  for (let seed = 1; seed <= N; seed++) {
    const r = rng(seed);
    fn(genRecord(r), genRecord(r), { statusPriority: PRIORITIES[seed % PRIORITIES.length] }, seed);
  }
}

describe("mergeForSync is commutative", () => {
  it(`merge(a,b) and merge(b,a) are identical bytes for ${N} generated pairs`, () => {
    forEachPair((a, b, opts, seed) => {
      expect(ser(mergeForSync(a, b, opts)), `seed ${seed}`).toBe(ser(mergeForSync(b, a, opts)));
    });
  });

  it("resolveStatus returns the same record whichever side is local", () => {
    forEachPair((a, b, opts, seed) => {
      expect(ser(resolveStatus(a, b, opts.statusPriority)), `seed ${seed}`).toBe(ser(resolveStatus(b, a, opts.statusPriority)));
    });
  });
});

describe("mergeForSync stays idempotent", () => {
  it("merging the result with either input again changes nothing", () => {
    forEachPair((a, b, opts, seed) => {
      const m = mergeForSync(a, b, opts);
      expect(ser(mergeForSync(m, b, opts)), `seed ${seed} (again with b)`).toBe(ser(m));
      expect(ser(mergeForSync(m, a, opts)), `seed ${seed} (again with a)`).toBe(ser(m));
      expect(ser(mergeForSync(b, m, opts)), `seed ${seed} (reversed)`).toBe(ser(m));
    });
  });

  it("a merged record is a fixed point of merging with itself", () => {
    forEachPair((a, b, opts, seed) => {
      const m = mergeForSync(a, b, opts);
      expect(ser(mergeForSync(m, m, opts)), `seed ${seed}`).toBe(ser(m));
    });
  });
});

describe("mergeForSync rules that used to depend on argument order", () => {
  const base = (over: Partial<WordRecord>): WordRecord => ({
    key: "k",
    surfaces: ["你好"],
    status: "known",
    seenCount: 0,
    recentSeenAt: [],
    dailySeenCounts: {},
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...over,
  });
  const opts = { statusPriority: DEFAULT_STATUS_PRIORITY };

  it("both devices keep the definitions of the record edited later", () => {
    const older = base({ definitions: ["old"], updatedAt: "2026-06-10T00:00:00.000Z" });
    const newer = base({ definitions: ["new"], updatedAt: "2026-06-12T00:00:00.000Z" });
    expect(mergeForSync(older, newer, opts).definitions).toEqual(["new"]);
    expect(mergeForSync(newer, older, opts).definitions).toEqual(["new"]);
  });

  it("an equal timestamp is settled by the value, not by who is local", () => {
    const x = base({ pinyin: "nǐ hǎo" });
    const y = base({ pinyin: "ni3 hao3" });
    expect(mergeForSync(x, y, opts).pinyin).toBe(mergeForSync(y, x, opts).pinyin);
  });

  it("surfaces[0] — the first form ever seen — comes from the side that saw the word first", () => {
    const early = base({ surfaces: ["你好", "好"], firstSeenAt: "2026-06-09T00:00:00.000Z" });
    const late = base({ surfaces: ["妳好", "你們"], firstSeenAt: "2026-06-11T00:00:00.000Z" });
    expect(mergeForSync(early, late, opts).surfaces).toEqual(["你好", "你們", "好", "妳好"]);
    expect(mergeForSync(late, early, opts).surfaces).toEqual(["你好", "你們", "好", "妳好"]);
  });

  it("a one-sided field survives from either side", () => {
    const withNotes = base({ notes: "mine" });
    const without = base({});
    expect(mergeForSync(withNotes, without, opts).notes).toBe("mine");
    expect(mergeForSync(without, withNotes, opts).notes).toBe("mine");
  });
});
