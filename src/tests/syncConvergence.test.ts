import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";

/**
 * #135 end to end: two devices, one shared mirror file, each running the real VocabularyStore. Before the merge was
 * commutative every device preferred its own value for `definitions`, `pinyin`, `notes`..., so the two stores held
 * different data forever (silently, since #129 stopped the write ping-pong). They must now settle on ONE value,
 * whichever device was first, and then stop writing.
 */

const MIRROR = "Chinese Learning/vocabulary.json";

const rec = (over: Record<string, unknown> = {}) => ({
  key: "苹果",
  surfaces: ["苹果"],
  simplified: "苹果",
  status: "known",
  seenCount: 1,
  recentSeenAt: [],
  dailySeenCounts: { "2026-01-01": 1 },
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

interface Shared {
  files: Map<string, string>;
  version: Map<string, number>;
  mirrorWrites: number;
  /** Mirror writes that have started and not finished (see makeDevice). */
  inflight: Set<Promise<unknown>>;
}

function makeDevice(shared: Shared, words: Record<string, unknown>) {
  const adapter: Record<string, any> = {
    exists: async (p: string) => shared.files.has(p) || p === "Chinese Learning",
    mkdir: async () => {},
    read: async (p: string) => shared.files.get(p) ?? "",
    write: async (p: string, c: string) => {
      shared.files.set(p, c);
      shared.version.set(p, (shared.version.get(p) ?? 0) + 1);
    },
    rename: async (a: string, b: string) => {
      shared.files.set(b, shared.files.get(a) ?? "");
      shared.files.delete(a);
      shared.version.set(b, (shared.version.get(b) ?? 0) + 1);
      if (b === MIRROR) shared.mirrorWrites++;
    },
    remove: async (p: string) => void shared.files.delete(p),
    list: async () => ({ files: [...shared.files.keys()] }),
    stat: async (p: string) => ({ mtime: shared.version.get(p) ?? 0, size: (shared.files.get(p) ?? "").length }),
  };
  const blob: Record<string, unknown> = { vocab: { schemaVersion: 1, words } };
  const plugin: any = {
    app: { vault: { adapter } },
    loadData: async () => blob,
    saveData: async (b: Record<string, unknown>) => void Object.assign(blob, b),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR },
  };
  const store = new VocabularyStore(plugin, { lookup: () => [] } as any, () => settings);
  // Track every mirror write so the test can wait for exactly the writes that were started, instead of guessing a
  // number of event-loop ticks: the write ends in a real async hash, whose duration depends on the machine.
  const real = (store as any).writeMirror.bind(store) as () => Promise<void>;
  (store as any).writeMirror = () => {
    const p = real();
    shared.inflight.add(p);
    void p.finally(() => shared.inflight.delete(p));
    return p;
  };
  return store;
}

/** Fire the debounced mirror writes and wait until every write they started has finished. */
async function letWriteLand(shared: Shared): Promise<void> {
  await vi.advanceTimersByTimeAsync(6_000);
  while (shared.inflight.size > 0) await Promise.allSettled([...shared.inflight]);
}

/** Run absorb rounds (B then A, repeated) letting debounced writes fire; return the number of mirror writes made. */
async function settle(a: VocabularyStore, b: VocabularyStore, shared: Shared, rounds = 8): Promise<number[]> {
  const perRound: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const before = shared.mirrorWrites;
    for (const dev of [b, a]) {
      await dev.absorbExternalMirrorChange();
      await letWriteLand(shared);
    }
    perRound.push(shared.mirrorWrites - before);
  }
  return perRound;
}

async function twoDevices(wordsA: Record<string, unknown>, wordsB: Record<string, unknown>) {
  const shared: Shared = { files: new Map(), version: new Map(), mirrorWrites: 0, inflight: new Set() };
  const a = makeDevice(shared, wordsA);
  const b = makeDevice(shared, wordsB);
  await a.load({ vocab: { schemaVersion: 1, words: wordsA } });
  await b.load({ vocab: { schemaVersion: 1, words: wordsB } });
  // Loading schedules debounced writes of its own (normalisation); let them land before the scenario starts, or
  // they fire mid-scenario and overwrite the file with data nobody has merged.
  await letWriteLand(shared);
  await a.flushMirrorNow(); // A is the first to put its data in the shared file
  shared.mirrorWrites = 0;
  return { a, b, shared };
}

describe("two devices that disagree on a field end up with the same value (#135)", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const DISAGREEMENTS: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["definitions, same timestamp", { definitions: ["zzz"] }, { definitions: ["aaa"] }],
    ["pinyin, same timestamp", { pinyin: "píng guǒ" }, { pinyin: "ping2 guo3" }],
    ["notes, one side later", { notes: "old", updatedAt: "2026-01-01T00:00:00.000Z" }, { notes: "new", updatedAt: "2026-02-01T00:00:00.000Z" }],
    ["surfaces in different order", { surfaces: ["苹果", "蘋果"] }, { surfaces: ["蘋果", "苹果"] }],
    ["mnemonic, no inner timestamps", { mnemonic: { text: "one" } }, { mnemonic: { text: "two" } }],
  ];

  for (const [name, ours, theirs] of DISAGREEMENTS) {
    it(`${name}: both stores converge, in either direction, then go quiet`, async () => {
      const results: string[] = [];
      for (const swap of [false, true]) {
        const [x, y] = swap ? [theirs, ours] : [ours, theirs];
        const { a, b, shared } = await twoDevices({ 苹果: rec(x) }, { 苹果: rec(y) });
        const perRound = await settle(a, b, shared);

        expect(JSON.stringify(a.get("苹果")), `${name} (swap=${swap}): devices differ`).toBe(JSON.stringify(b.get("苹果")));
        // Bounded, and then silent: the last rounds write nothing.
        expect(perRound.slice(-3), `${name} (swap=${swap}): still writing ${perRound}`).toEqual([0, 0, 0]);
        expect(perRound.reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(6);
        results.push(JSON.stringify(a.get("苹果")));
      }
      // Who started with which value does not change the outcome.
      expect(results[0]).toBe(results[1]);
    });
  }
});
