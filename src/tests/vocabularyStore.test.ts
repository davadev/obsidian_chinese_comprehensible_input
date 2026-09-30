import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";
import { makeKey } from "../dictionary/normalizeChinese";

function makeDictionary() {
  const entries: Record<string, any[]> = {
    学习: [{ simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["study"], hsk: { source: "2.0", levels: ["2"] } }],
    學習: [{ simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["study"], hsk: { source: "2.0", levels: ["2"] } }],
    苹果: [{ simplified: "苹果", traditional: "蘋果", pinyin: "píng guǒ", definitions: ["apple"], hsk: { source: "2.0", levels: ["1"] } }],
  };
  return {
    lookup: (surface: string) => entries[surface] ?? [],
  } as any;
}

function makePlugin() {
  const mirrorFiles = new Map<string, string>();
  const dataBlob: any = {};
  const adapter = {
    exists: vi.fn(async (path: string) => path === "Chinese Learning" || mirrorFiles.has(path)),
    mkdir: vi.fn(async () => {}),
    read: vi.fn(async (path: string) => mirrorFiles.get(path) ?? ""),
    write: vi.fn(async (path: string, content: string) => {
      mirrorFiles.set(path, content);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      mirrorFiles.set(to, mirrorFiles.get(from) ?? "");
      mirrorFiles.delete(from);
    }),
    remove: vi.fn(async (path: string) => {
      mirrorFiles.delete(path);
    }),
    stat: vi.fn(async (_path: string) => ({ mtime: Date.now() })),
    list: vi.fn(async () => ({ files: Array.from(mirrorFiles.keys()) })),
  };
  const plugin = {
    app: { vault: { adapter } },
    loadData: vi.fn(async () => dataBlob),
    saveData: vi.fn(async (blob: any) => {
      Object.keys(dataBlob).forEach((k) => delete dataBlob[k]);
      Object.assign(dataBlob, blob);
    }),
  } as any;
  return { plugin, adapter, dataBlob, mirrorFiles };
}

describe("VocabularyStore", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
  });

  /**
   * The vault indexer re-walks every note whenever the script setting
   * changes. Before 0.6.0-rc.2 it called recordExposure() per occurrence, so
   * every re-index doubled seenCount, back-dated lastSeenAt for the entire
   * vault, and spiked today's dailySeenCounts — none of it undoable.
   */
  describe("recordNoteScan is idempotent", () => {
    const scan = (store: VocabularyStore, counts: [string, number][], path = "a.md") =>
      store.recordNoteScan(path, new Map(counts), 50, false);

    it("records a note's tally on the first pass", async () => {
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      expect(scan(store, [["学习", 3]])).toBe(3);
      const rec = store.bySurface("学习")!;
      expect(rec.seenCount).toBe(3);
      expect(rec.notesSeenCounts?.["a.md"]).toBe(3);
      // The invariant mergeForSync() re-derives seenCount from.
      expect(Object.values(rec.dailySeenCounts).reduce((a, b) => a + b, 0)).toBe(3);
    });

    it("writes absolutely nothing on an unchanged re-scan", async () => {
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      scan(store, [["学习", 3]]);
      const before = JSON.stringify(store.bySurface("学习"));
      expect(scan(store, [["学习", 3]])).toBe(0);
      // Byte-identical: no count, no timestamp, no updatedAt may move.
      expect(JSON.stringify(store.bySurface("学习"))).toBe(before);
    });

    it("adds only the difference when a note grows", async () => {
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      scan(store, [["学习", 3]]);
      expect(scan(store, [["学习", 5]])).toBe(2);
      const rec = store.bySurface("学习")!;
      expect(rec.seenCount).toBe(5);
      expect(Object.values(rec.dailySeenCounts).reduce((a, b) => a + b, 0)).toBe(5);
    });

    it("keeps the high-water mark when a note shrinks", async () => {
      // Unwinding would mean removing exposures from dailySeenCounts, and
      // nothing records which day they were read on.
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      scan(store, [["学习", 5]]);
      expect(scan(store, [["学习", 2]])).toBe(0);
      expect(store.bySurface("学习")!.seenCount).toBe(5);
    });

    it("marks a record the scan CREATED as baseline, not as an event", async () => {
      // A bulk index establishes an inventory of what is already in the vault.
      // Plotting those on the Progress chart claims the learner met thousands
      // of words in a day, which is what prompted this.
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      scan(store, [["学习", 2]]);
      expect(store.bySurface("学习")!.backfilledAt).toBeTruthy();
    });

    it("does not mark a record that already existed", async () => {
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      // Met while reading, not by a scan.
      store.recordExposure("学习", 50, false, "a.md");
      expect(store.bySurface("学习")!.backfilledAt).toBeUndefined();
      scan(store, [["学习", 5]]);
      expect(store.bySurface("学习")!.backfilledAt).toBeUndefined();
    });

    it("adopts pre-existing unclassified records only when asked, once", async () => {
      // The one-shot repair for records an earlier build's index created
      // before the flag existed.
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      store.recordExposure("学习", 50, false, "a.md");
      store.recordExposure("苹果", 50, false, "a.md");
      store.setStatus("苹果", "known");

      store.recordNoteScan("a.md", new Map([["学习", 9], ["苹果", 9]]), 50, false, {
        markExistingBaseline: true,
      });
      // Still "new" and never classified → inventory.
      expect(store.bySurface("学习")!.backfilledAt).toBeTruthy();
      // Classified by the user → a real part of their learning history.
      expect(store.bySurface("苹果")!.backfilledAt).toBeUndefined();
    });

    it("counts the same word separately per note", async () => {
      const { plugin } = makePlugin();
      const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
      await store.load({});
      scan(store, [["学习", 2]], "a.md");
      scan(store, [["学习", 4]], "b.md");
      const rec = store.bySurface("学习")!;
      expect(rec.seenCount).toBe(6);
      expect(rec.notesSeenCounts).toEqual({ "a.md": 2, "b.md": 4 });
    });
  });

  it("load dedupes legacy keys and backfills classification timestamps", async () => {
    const { plugin } = makePlugin();
    const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
    const canonical = makeKey("学习", "xué xí");
    await store.load({
      vocab: {
        schemaVersion: 1,
        words: {
          legacy: {
            key: "legacy",
            surfaces: ["學習"],
            simplified: "学习",
            traditional: "學習",
            pinyin: "xué xí",
            status: "known",
            seenCount: 1,
            recentSeenAt: [],
            dailySeenCounts: {},
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          [canonical]: {
            key: canonical,
            surfaces: ["学习"],
            simplified: "学习",
            traditional: "學習",
            pinyin: "xué xí",
            status: "known",
            seenCount: 2,
            recentSeenAt: [],
            dailySeenCounts: {},
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
      },
    });
    const rec = store.get(canonical)!;
    expect(store.size()).toBe(1);
    expect(rec.surfaces.sort()).toEqual(["学习", "學習"]);
    expect(rec.seenCount).toBe(3);
    expect(rec.knownAt).toBe("2026-01-01T00:00:00.000Z");
    expect(rec.classifiedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("ensure, setStatus, setAxes, exposures and note aggregation all work through canonical lookup", async () => {
    const { plugin } = makePlugin();
    const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
    await store.load({ vocab: { schemaVersion: 1, words: {} } });

    const rec = store.ensure("學習");
    expect(rec.key).toBe(makeKey("学习", "xué xí"));
    expect(store.bySurface("学习")).toBe(rec);

    store.setStatus("学习", "ignored", "name");
    expect(rec.status).toBe("ignored");
    expect(rec.ignoredReason).toBe("name");

    store.setAxes("学习", { chars: true, pinyin: true, meaning: true });
    expect(rec.status).toBe("known");
    expect(rec.knownAt).toBeTruthy();

    store.recordExposure("学习", 2, false, "note-a.md");
    store.recordExposure("学习", 2, false, "note-b.md");
    store.recordExposure("学习", 2, false, "note-a.md");
    expect(rec.seenCount).toBe(3);
    expect(rec.recentSeenAt).toHaveLength(2);
    expect(rec.notesSeenCounts).toEqual({ "note-a.md": 2, "note-b.md": 1 });
    expect(store.knownNotePaths()).toEqual(["note-a.md", "note-b.md"]);

    store.updateMnemonic("学习", { text: "mnemonic" });
    store.updateSrs("学习", { intervalDays: 3 });
    expect(rec.mnemonic?.text).toBe("mnemonic");
    expect(rec.srs?.intervalDays).toBe(3);
  });

  it("invalidates a cached miss when a later ensure creates that surface", async () => {
    const { plugin } = makePlugin();
    const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
    await store.load({ vocab: { schemaVersion: 1, words: {} } });

    expect(store.bySurface("苹果")).toBeUndefined();

    const rec = store.ensure("苹果");

    expect(store.bySurface("苹果")).toBe(rec);
  });

  it("imports data, bulk-marks new words, exports CSV, and resets", async () => {
    const { plugin } = makePlugin();
    const store = new VocabularyStore(plugin, makeDictionary(), () => DEFAULT_SETTINGS);
    await store.load({ vocab: { schemaVersion: 1, words: {} } });
    store.ensure("学习");
    const canonical = makeKey("学习", "xué xí");

    const imported = await store.importJson(JSON.stringify({
      schemaVersion: 1,
      words: {
        [canonical]: {
          key: canonical,
          surfaces: ["学习"],
          simplified: "学习",
          pinyin: "xué xí",
          status: "unknown",
          seenCount: 4,
          recentSeenAt: ["2026-01-01T00:00:00.000Z"],
          dailySeenCounts: { "2026-01-01": 4 },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        苹果: {
          key: "苹果",
          surfaces: ["苹果"],
          simplified: "苹果",
          pinyin: "píng guǒ",
          status: "new",
          seenCount: 1,
          recentSeenAt: [],
          dailySeenCounts: {},
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }));

    expect(imported).toEqual({ added: 1, updated: 1 });
    expect(store.get(canonical)?.seenCount).toBe(4);
    expect(store.markAllNewAs("known")).toBe(1);
    expect(store.get("苹果")?.status).toBe("known");

    const csv = await store.exportCsv();
    expect(csv).toContain("key,surface,pinyin,definitions,hsk,status,seenCount");
    expect(csv).toContain("学习");

    await store.resetAll();
    expect(store.size()).toBe(0);
  });

  it("merges mirror content, forwards dictionary payloads, and writes mirror files", async () => {
    const { plugin, mirrorFiles, adapter } = makePlugin();
    const settings = {
      ...DEFAULT_SETTINGS,
      sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: "Chinese Learning/vocabulary.json" },
    };
    const store = new VocabularyStore(plugin, makeDictionary(), () => settings);
    const mergeRemote = vi.fn(async () => {});
    store.setDictionaryMirrorBridge({
      getOverrides: () => ({ foo: { updatedAt: "2026-01-01T00:00:00.000Z" } as any }),
      getCustomWords: () => ({ bar: { simplified: "bar", pinyin: "bar", definitions: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } }),
      mergeRemote,
    });
    await store.load({ vocab: { schemaVersion: 1, words: {} } });

    const ok = store.mergeMirrorContent(JSON.stringify({
      schemaVersion: 2,
      vocab: {
        schemaVersion: 1,
        words: {
          苹果: {
            key: "苹果",
            surfaces: ["苹果"],
            simplified: "苹果",
            pinyin: "píng guǒ",
            status: "unknown",
            seenCount: 1,
            recentSeenAt: [],
            dailySeenCounts: {},
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      dictionaryOverrides: { a: { updatedAt: "2026-01-01T00:00:00.000Z" } },
      dictionaryCustomWords: { b: { simplified: "b", pinyin: "b", definitions: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
    }));

    expect(ok).toBe(true);
    expect(store.get("苹果")?.status).toBe("unknown");
    await Promise.resolve();
    expect(mergeRemote).toHaveBeenCalledTimes(1);

    await store.flushMirrorNow();
    const mirror = mirrorFiles.get("Chinese Learning/vocabulary.json")!;
    expect(JSON.parse(mirror).dictionaryOverrides.foo.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(adapter.write).toHaveBeenCalled();
  });

  /**
   * The vault mirror, 0.7.8. Three bugs, all in the same read path, none of
   * which had any test at all: before this block nothing in the suite called
   * `absorbExternalMirrorChange`.
   *
   *  - #122  the stat gate compared mtimes with `<=` and refreshed nothing on
   *          the skip path, so one unlucky comparison skipped a remote version
   *          for good.
   *  - A1    every absorb scheduled a mirror write back, and the whole-store
   *          merge is order-dependent and (for `definitions` and friends) not
   *          commutative — so two devices never converge on identical bytes and
   *          would have ping-ponged multi-megabyte writes once #122 was fixed.
   *  - A2    a remotely-save conflict file was deleted before the merged data
   *          had been persisted.
   */
  describe("mirror read gate", () => {
    const MIRROR = "Chinese Learning/vocabulary.json";

    const mirrorSettings = () => ({
      ...DEFAULT_SETTINGS,
      sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR },
    });

    /** One word record, in the shape the mirror file carries. */
    const rec = (key: string, over: Record<string, unknown> = {}) => ({
      key,
      surfaces: [key],
      simplified: key,
      pinyin: "x",
      status: "unknown",
      seenCount: 1,
      recentSeenAt: [],
      dailySeenCounts: { "2026-01-01": 1 },
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    });

    const envelope = (words: Record<string, unknown>, pretty = false) =>
      JSON.stringify(
        { schemaVersion: 2, vocab: { schemaVersion: 1, words } },
        null,
        pretty ? 2 : undefined
      );

    /** Store with the mirror enabled and a stat we control outright. */
    async function mirrorStore(initial?: string) {
      const { plugin, adapter, mirrorFiles } = makePlugin();
      const settings = mirrorSettings();
      const store = new VocabularyStore(plugin, makeDictionary(), () => settings);
      await store.load({ vocab: { schemaVersion: 1, words: {} } });
      if (initial !== undefined) mirrorFiles.set(MIRROR, initial);
      let stat: { mtime: number; size?: number } = { mtime: 1000, size: 10 };
      (adapter.stat as any).mockImplementation(async () => ({ ...stat }));
      const setStat = (next: Partial<typeof stat>) => {
        stat = { ...stat, ...next };
      };
      return { store, adapter, mirrorFiles, plugin, setStat };
    }

    it("merges a remote write that landed in the SAME second (#122)", async () => {
      // One-second mtime granularity is normal on the mobile adapter and on the
      // FUSE mounts this feature targets, so `st.mtime <= lastMirrorMtime` was
      // true for a genuinely newer file. The size moves even when the clock
      // does not.
      const { store, mirrorFiles, setStat } = await mirrorStore(envelope({}));
      await store.absorbExternalMirrorChange();

      mirrorFiles.set(MIRROR, envelope({ 苹果: rec("苹果") }));
      setStat({ size: 999 }); // same mtime, bigger file
      await store.absorbExternalMirrorChange();

      expect(store.get("苹果")).toBeTruthy();
    });

    it("merges a remote file stamped with an OLDER clock (#122)", async () => {
      // Device B's clock runs behind; remotely-save and Nextcloud preserve
      // mtime on download, so the incoming file looks older than our own write.
      const { store, mirrorFiles, setStat } = await mirrorStore(envelope({}));
      await store.absorbExternalMirrorChange();

      // Size deliberately left ALONE: this must discriminate on the clock
      // going backwards, not fall through on a size difference.
      mirrorFiles.set(MIRROR, envelope({ 苹果: rec("苹果") }));
      setStat({ mtime: 900 });
      await store.absorbExternalMirrorChange();

      expect(store.get("苹果")).toBeTruthy();
    });

    it("still skips the read when the file genuinely has not moved", async () => {
      // Guards the optimisation rather than the bug: the gate exists to avoid a
      // 2.9 MB read on every poll, and equality must not have thrown that away.
      const { store, adapter } = await mirrorStore(envelope({}));
      await store.absorbExternalMirrorChange();
      (adapter.read as any).mockClear();

      await store.absorbExternalMirrorChange();
      expect(adapter.read).not.toHaveBeenCalled();
    });

    it("cannot skip forever, even if stat never changes (#122)", async () => {
      // The self-heal. If stat lies — or the platform reports no size and the
      // mtime happens to collide — the gate must still let go eventually.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        const { store, mirrorFiles } = await mirrorStore(envelope({}));
        await store.absorbExternalMirrorChange();

        // New content, identical stat: nothing tells us to look.
        mirrorFiles.set(MIRROR, envelope({ 苹果: rec("苹果") }));
        await store.absorbExternalMirrorChange();
        expect(store.get("苹果")).toBeFalsy();

        // Past the self-heal window the file is read regardless.
        vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
        await store.absorbExternalMirrorChange();
        expect(store.get("苹果")).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not record a version it never read (stat is taken BEFORE the read)", async () => {
      // A write landing between the read and a post-read stat used to be
      // recorded as seen while its content was never looked at — skipped for
      // good, by the same stickiness as #122. Simulated here by moving the file
      // on during the read.
      const { store, adapter, mirrorFiles, setStat } = await mirrorStore(envelope({}));
      await store.absorbExternalMirrorChange();

      (adapter.read as any).mockImplementationOnce(async (p: string) => {
        const now = mirrorFiles.get(p) ?? "";
        // The remote write lands while we are reading the old bytes.
        mirrorFiles.set(MIRROR, envelope({ 苹果: rec("苹果") }));
        setStat({ mtime: 2000, size: 4242 });
        return now;
      });
      setStat({ mtime: 1500, size: 11 });
      await store.absorbExternalMirrorChange();

      // The next poll must go and look, rather than trusting a stat that
      // describes bytes we never saw.
      await store.absorbExternalMirrorChange();
      expect(store.get("苹果")).toBeTruthy();
    });
  });

  /**
   * A1 — absorbing must not bounce a write straight back. `flushSave()`
   * schedules a mirror write, so before this every absorb pushed; combined with
   * a merge that never reproduces the other device's byte order, that is an
   * endless write loop between two devices.
   */
  describe("mirror write-back is conditional", () => {
    const MIRROR = "Chinese Learning/vocabulary.json";

    const mirrorSettings = () => ({
      ...DEFAULT_SETTINGS,
      sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR },
    });

    const rec = (key: string, over: Record<string, unknown> = {}) => ({
      key,
      surfaces: [key],
      simplified: key,
      pinyin: "x",
      status: "unknown",
      seenCount: 1,
      recentSeenAt: [],
      dailySeenCounts: { "2026-01-01": 1 },
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    });

    const envelope = (words: Record<string, unknown>, pretty = false) =>
      JSON.stringify(
        { schemaVersion: 2, vocab: { schemaVersion: 1, words } },
        null,
        pretty ? 2 : undefined
      );

    async function setup(initial: string) {
      const { plugin, adapter, mirrorFiles } = makePlugin();
      const settings = mirrorSettings();
      const store = new VocabularyStore(plugin, makeDictionary(), () => settings);
      await store.load({ vocab: { schemaVersion: 1, words: {} } });
      mirrorFiles.set(MIRROR, initial);
      (adapter.stat as any).mockImplementation(async () => ({
        mtime: Date.now(),
        size: (mirrorFiles.get(MIRROR) ?? "").length,
      }));
      return { store, adapter, mirrorFiles };
    }

    /**
     * Write our merged state out the way the peer device would, then hand it
     * back re-serialised so the bytes (and therefore the hash) differ while the
     * data does not. `flushMirrorNow` also clears any pending debounce, so what
     * follows is deterministic.
     */
    async function peerWritesBack(
      store: VocabularyStore,
      mirrorFiles: Map<string, string>
    ): Promise<void> {
      await store.flushMirrorNow();
      const merged = mirrorFiles.get(MIRROR)!;
      mirrorFiles.set(MIRROR, JSON.stringify(JSON.parse(merged), null, 4));
    }

    it("writes back when the merge brought in something new", async () => {
      // Positive control, and it must go through the real 5 s debounce — an
      // assertion made before the timer fires passes whether or not a write was
      // ever scheduled, which is how the first draft of the negative test below
      // managed to pass against the unfixed code.
      vi.useFakeTimers();
      try {
        const { store, adapter } = await setup(envelope({ 苹果: rec("苹果") }));
        (adapter.write as any).mockClear();

        const changed = await store.absorbExternalMirrorChange();
        expect(changed).toBe(true);

        await vi.advanceTimersByTimeAsync(6_000);
        expect(adapter.write).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT write back when the merge changed nothing (A1)", async () => {
      // The loop-breaking property, stated as convergence: once both sides hold
      // the same data, receiving it again in a different byte order must be
      // silent. Before the guard this step scheduled a write every time, and
      // since `mergeStoresForSync` spreads the LOCAL words first the two
      // devices never produce identical bytes — so it never stopped.
      vi.useFakeTimers();
      try {
        const words = { 苹果: rec("苹果"), 学习: rec("学习") };
        const { store, adapter, mirrorFiles } = await setup(envelope(words));

        // Let the one-time normalisation settle (see the convergence test below).
        for (let i = 0; i < 5; i++) {
          if (!(await store.absorbExternalMirrorChange())) break;
          await peerWritesBack(store, mirrorFiles);
        }
        await peerWritesBack(store, mirrorFiles);

        (adapter.write as any).mockClear();
        const changed = await store.absorbExternalMirrorChange();
        expect(changed).toBe(false);

        // Past the mirror-write debounce: nothing may have been scheduled.
        await vi.advanceTimersByTimeAsync(6_000);
        expect(adapter.write).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("converges in a bounded number of rounds, then stays quiet (A1)", async () => {
      // Convergence takes more than one round: the first merge takes a record
      // the store has never seen VERBATIM (`mergeStoresForSync` does not call
      // `mergeForSync` for a one-sided key), so derived fields like `axes` are
      // only materialised once the record exists on both sides. That is a
      // one-time normalisation, not an oscillation — which is the whole
      // difference between "settles" and "ping-pongs forever".
      const { store, mirrorFiles } = await setup(envelope({ 苹果: rec("苹果") }));

      let rounds = 0;
      for (; rounds < 10; rounds++) {
        const changed = await store.absorbExternalMirrorChange();
        if (!changed) break;
        await peerWritesBack(store, mirrorFiles);
      }

      expect(rounds).toBeLessThanOrEqual(3);
      // And it stays quiet: another round of the peer reformatting the file
      // produces no further writes.
      await peerWritesBack(store, mirrorFiles);
      expect(await store.absorbExternalMirrorChange()).toBe(false);
    });

    it("does NOT bounce a write back over a field the two devices disagree on (A1)", async () => {
      // `mergeForSync` resolves `definitions` as `a.definitions ?? b.definitions`
      // with the LOCAL record as `a`, so each device keeps its own and the file
      // can never converge. Harmless only because neither side now writes.
      vi.useFakeTimers();
      try {
        const { store, adapter, mirrorFiles } = await setup(
          envelope({ 苹果: rec("苹果", { definitions: ["ours"] }) })
        );
        // Settle first, so what follows isolates the disagreement itself rather
        // than the one-time normalisation above.
        for (let i = 0; i < 5; i++) {
          if (!(await store.absorbExternalMirrorChange())) break;
          await peerWritesBack(store, mirrorFiles);
        }

        mirrorFiles.set(MIRROR, envelope({ 苹果: rec("苹果", { definitions: ["theirs"] }) }));
        (adapter.write as any).mockClear();
        const changed = await store.absorbExternalMirrorChange();

        expect(changed).toBe(false);
        expect(store.get("苹果")?.definitions).toEqual(["ours"]);
        await vi.advanceTimersByTimeAsync(6_000);
        expect(adapter.write).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /**
   * A2 — a remotely-save conflict file was removed as soon as its content had
   * been merged into MEMORY. The save that follows is wrapped in a catch that
   * only logs, and the load path's own comment says iOS Files-provider I/O "can
   * stall or reject" — so a failed save meant the merged vocabulary existed
   * nowhere at all. The only unrecoverable loss in this release.
   */
  describe("conflict-file sweep", () => {
    const MIRROR = "Chinese Learning/vocabulary.json";
    const CONFLICT = "Chinese Learning/vocabulary.conflict-2026-01-01.json";

    const envelope = (words: Record<string, unknown>) =>
      JSON.stringify({ schemaVersion: 2, vocab: { schemaVersion: 1, words } });

    const rec = (key: string) => ({
      key,
      surfaces: [key],
      simplified: key,
      pinyin: "x",
      status: "unknown",
      seenCount: 1,
      recentSeenAt: [],
      dailySeenCounts: { "2026-01-01": 1 },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    async function setup() {
      const { plugin, adapter, mirrorFiles } = makePlugin();
      const settings = {
        ...DEFAULT_SETTINGS,
        sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR },
      };
      const store = new VocabularyStore(plugin, makeDictionary(), () => settings);
      await store.load({ vocab: { schemaVersion: 1, words: {} } });
      mirrorFiles.set(MIRROR, envelope({}));
      mirrorFiles.set(CONFLICT, envelope({ 苹果: rec("苹果") }));
      return { store, adapter, mirrorFiles, plugin };
    }

    it("absorbs a conflict file and removes it once the data is safe", async () => {
      const { store, mirrorFiles } = await setup();
      await store.reloadMirror();
      expect(store.get("苹果")).toBeTruthy();
      expect(mirrorFiles.has(CONFLICT)).toBe(false);
    });

    it("KEEPS the conflict file when the save fails (A2)", async () => {
      const { store, adapter, plugin } = await setup();
      (plugin.saveData as any).mockRejectedValueOnce(new Error("Files provider stalled"));

      await store.reloadMirror();

      // The file is the only remaining copy, so it must survive for the next
      // sweep. Re-absorbing it later is free: mergeForSync is idempotent.
      expect(adapter.remove).not.toHaveBeenCalledWith(CONFLICT);
    });
  });
});
