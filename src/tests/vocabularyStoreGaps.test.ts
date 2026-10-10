import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";

/**
 * The remaining branches of VocabularyStore: inputs that persisted, synced or hand-edited data can still
 * produce (records from older versions, odd mirror paths, half-written envelopes) and the failure paths of
 * the save timers.
 */

const MIRROR = "Chinese Learning/vocabulary.json";

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
const envelope = (words: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 2, vocab: { schemaVersion: 1, words }, ...extra });

function setup(opts: { mirrorPath?: string; mirrorEnabled?: boolean; settings?: Record<string, unknown>; updateBlob?: boolean } = {}) {
  const files = new Map<string, string>();
  const adapter: Record<string, any> = {
    exists: vi.fn(async (p: string) => files.has(p) || p === "Chinese Learning"),
    mkdir: vi.fn(async () => {}),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    rename: vi.fn(async (a: string, b: string) => {
      files.set(b, files.get(a) ?? "");
      files.delete(a);
    }),
    remove: vi.fn(async (p: string) => void files.delete(p)),
    list: vi.fn(async () => ({ files: [...files.keys()] })),
    stat: vi.fn(async () => ({ mtime: 1000, size: 10 })),
  };
  const blob: Record<string, unknown> = {};
  const plugin: any = {
    app: { vault: { adapter } },
    loadData: vi.fn(async () => blob),
    saveData: vi.fn(async (b: Record<string, unknown>) => void Object.assign(blob, b)),
  };
  const settings: any = {
    ...DEFAULT_SETTINGS,
    ...opts.settings,
    sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: opts.mirrorEnabled !== false, mirrorPath: opts.mirrorPath ?? MIRROR },
  };
  const store = new VocabularyStore(plugin, { lookup: () => [] } as any, () => settings);
  return { store, plugin, adapter, files, blob, settings };
}

describe("VocabularyStore remaining branches", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("mirror path and load", () => {
    it("an empty mirror path means no mirror, and says nothing", () => {
      const { store } = setup({ mirrorPath: "" });
      expect(store.mirrorPath()).toBeNull();
    });

    it("load(null) starts an empty store", async () => {
      const { store } = setup();
      await store.load(null);
      expect(store.values()).toEqual([]);
    });

    it("a mirror path at the vault root has no folder to create or list", async () => {
      const { store, files, adapter } = setup({ mirrorPath: "vocabulary.json" });
      await store.load({});
      files.set("vocabulary.json", envelope({ a: rec("a") }));
      files.set("vocabulary.conflict-1.json", envelope({ b: rec("b") }));
      await store.bootstrapMirrorAfterLoad();
      expect(adapter.list).toHaveBeenCalledWith("/");
      expect(store.values().map((r) => r.key).sort()).toEqual(["a", "b"]);
      expect(files.has("vocabulary.conflict-1.json")).toBe(false);
    });

    it("a missing mirror file is simply not merged", async () => {
      const { store, adapter } = setup();
      await store.load({});
      await store.bootstrapMirrorAfterLoad();
      expect(adapter.read).not.toHaveBeenCalled();
    });

    it("reloading before load() never writes the (still empty) store over saved data", async () => {
      const { store, plugin } = setup();
      await store.reloadMirror();
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("sweeps only json conflict siblings of the mirror, not other files", async () => {
      const { store, files } = setup();
      await store.load({});
      files.set(MIRROR, envelope({ a: rec("a") }));
      files.set("Chinese Learning/other.conflict-1.json", envelope({ x: rec("x") }));
      files.set("Chinese Learning/vocabulary.notes.md", "hello");
      files.set("Chinese Learning/vocabulary.conflict-1.txt", envelope({ y: rec("y") }));
      files.set("Chinese Learning/vocabulary.conflict-2.JSON", envelope({ z: rec("z") }));
      await store.bootstrapMirrorAfterLoad();
      expect(store.values().map((r) => r.key).sort()).toEqual(["a", "z"]);
      expect(files.has("Chinese Learning/other.conflict-1.json")).toBe(true);
      expect(files.has("Chinese Learning/vocabulary.conflict-1.txt")).toBe(true);
      expect(files.has("Chinese Learning/vocabulary.conflict-2.JSON")).toBe(false);
    });
  });

  describe("when the file system misbehaves", () => {
    it("a folder that cannot be listed just means no conflict files to sweep", async () => {
      const { store, files, adapter } = setup();
      await store.load({});
      files.set(MIRROR, envelope({ a: rec("a") }));
      adapter.list.mockRejectedValueOnce(new Error("EIO"));
      await store.bootstrapMirrorAfterLoad();
      expect(store.values().map((r) => r.key)).toEqual(["a"]);
    });

    it("a mirror at the vault root is written without making a folder", async () => {
      vi.useFakeTimers();
      const { store, files, adapter } = setup({ mirrorPath: "vocabulary.json" });
      await store.load({});
      store.setStatus("猫", "known");
      await store.flushSave();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(files.has("vocabulary.json")).toBe(true));
      expect(adapter.mkdir).not.toHaveBeenCalled();
    });

    it("saving a store that was never loaded does not schedule a mirror write", async () => {
      vi.useFakeTimers();
      const { store, adapter } = setup();
      await store.flushSave();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(adapter.write).not.toHaveBeenCalled();
    });
  });

  describe("mergeMirrorContent", () => {
    it("honours the store-every-timestamp setting", async () => {
      const { store } = setup({ settings: { storeAllExactTimestamps: true } });
      await store.load({});
      const stamps = Array.from({ length: 12 }, (_, i) => `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`);
      store.mergeMirrorContent(envelope({ a: rec("a", { recentSeenAt: stamps }) }));
      expect(store.values()[0].recentSeenAt).toHaveLength(12);
    });

    it("an envelope without dictionary data does not touch the dictionary bridge", async () => {
      const { store } = setup();
      await store.load({});
      const mergeRemote = vi.fn(async () => {});
      store.setDictionaryMirrorBridge({ getOverrides: () => ({}), getCustomWords: () => ({}), mergeRemote } as any);
      store.mergeMirrorContent(envelope({ a: rec("a") }));
      expect(mergeRemote).not.toHaveBeenCalled();
    });

    it("hands dictionary data to the bridge, and a failing merge is logged, not thrown", async () => {
      const { store } = setup();
      await store.load({});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const mergeRemote = vi.fn(async () => {
        throw new Error("boom");
      });
      store.setDictionaryMirrorBridge({ getOverrides: () => ({}), getCustomWords: () => ({}), mergeRemote } as any);
      expect(store.mergeMirrorContent(envelope({}, { dictionaryCustomWords: { 猫: {} } }))).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(mergeRemote).toHaveBeenCalledWith({}, { 猫: {} });
      expect(err).toHaveBeenCalledWith("CCI sync: dictionary merge failed", expect.any(Error));
    });
  });

  describe("records from older versions (dedupe on load)", () => {
    const load = async (words: Record<string, unknown>) => {
      const s = setup();
      await s.store.load({ vocab: { schemaVersion: 3, words } });
      return s;
    };

    it("keys a record with no simplified form by its first surface, and by its own key when it has none", async () => {
      const { store } = await load({
        old1: rec("old1", { simplified: undefined, surfaces: ["猫"], pinyin: undefined }),
        old2: rec("old2", { simplified: undefined, surfaces: [], pinyin: undefined }),
      });
      expect(store.values().map((r) => r.key).sort()).toEqual(["old2", "猫"]);
    });

    it("merges duplicates, keeping the earlier first-seen/known/classified times and summing counts", async () => {
      const { store } = await load({
        "猫": rec("猫", {
          pinyin: undefined,
          status: "known",
          firstSeenAt: "2026-02-01T00:00:00.000Z",
          knownAt: "2026-02-03T00:00:00.000Z",
          classifiedAt: "2026-02-02T00:00:00.000Z",
          seenCount: 2,
          surfaces: ["猫"],
        }),
        "猫|": rec("猫|", {
          simplified: "猫",
          pinyin: undefined,
          status: "unknown",
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          knownAt: "2026-03-03T00:00:00.000Z",
          seenCount: 3,
          surfaces: ["貓"],
        }),
      });
      const r = store.values();
      expect(r).toHaveLength(1);
      expect(r[0].seenCount).toBe(5);
      expect(r[0].surfaces.sort()).toEqual(["猫", "貓"]);
      expect(r[0].firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
      expect(r[0].knownAt).toBe("2026-02-03T00:00:00.000Z");
      expect(r[0].classifiedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("backfills a missing knownAt and classifiedAt from updatedAt", async () => {
      const { store } = await load({ a: rec("a", { status: "known" }) });
      const r = store.values()[0];
      expect(r.knownAt).toBe(r.updatedAt);
      expect(r.classifiedAt).toBe(r.updatedAt);
    });
  });

  describe("status changes", () => {
    it("keeps the first knownAt/classifiedAt and an existing classification when the status changes again", async () => {
      const { store } = setup();
      await store.load({});
      const a = store.setStatus("猫", "known");
      const knownAt = a.knownAt;
      const classifiedAt = a.classifiedAt;
      store.setStatus("猫", "known");
      store.setStatus("猫", "unknown");
      expect(store.bySurface("猫")!.knownAt).toBe(knownAt);
      expect(store.bySurface("猫")!.classifiedAt).toBe(classifiedAt);
      store.setAxes("猫", { chars: true, pinyin: true, meaning: true });
      expect(store.bySurface("猫")!.knownAt).toBe(knownAt);
    });

    it("setAxes on a fresh word that stays unclassified sets neither stamp", async () => {
      const { store } = setup();
      await store.load({});
      const r = store.setAxes("猫", { chars: false, pinyin: false, meaning: false });
      expect(r.status).toBe("unknown");
      expect(r.knownAt).toBeUndefined();
      expect(r.classifiedAt).toBeDefined();
    });

    it("setStatus('new') leaves a new word unclassified", async () => {
      const { store } = setup();
      await store.load({});
      expect(store.setStatus("猫", "new").classifiedAt).toBeUndefined();
    });

    it("markAllNewAs keeps a classification the record already had, derives no axes for 'ignored', and reports zero when nothing is new", async () => {
      const { store } = setup();
      await store.load({});
      store.ensure("猫");
      store.ensure("狗").classifiedAt = "2026-01-01T00:00:00.000Z";
      expect(store.markAllNewAs("ignored")).toBe(2);
      expect(store.bySurface("狗")!.classifiedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(store.bySurface("猫")!.axes).toBeUndefined();
      expect(store.markAllNewAs("known")).toBe(0);
    });

    it("markAllNewAs('known') stamps knownAt once", async () => {
      const { store } = setup();
      await store.load({});
      store.ensure("猫");
      const r = store.ensure("狗");
      r.knownAt = "2026-01-01T00:00:00.000Z";
      store.markAllNewAs("known");
      expect(store.bySurface("狗")!.knownAt).toBe("2026-01-01T00:00:00.000Z");
      expect(store.bySurface("猫")!.knownAt).toBeDefined();
    });
  });

  describe("exposure counting", () => {
    it("recordExposure without a note path leaves the per-note counts alone; with one it counts", async () => {
      const { store } = setup();
      await store.load({});
      store.recordExposure("猫", 5, false);
      expect(store.bySurface("猫")!.notesSeenCounts).toBeUndefined();
      store.recordExposure("猫", 5, false, "a.md");
      expect(store.bySurface("猫")!.notesSeenCounts).toEqual({ "a.md": 1 });
      expect(store.knownNotePaths()).toEqual(["a.md"]);
    });

    it("keeps every timestamp when asked to, instead of trimming to the limit", async () => {
      const { store } = setup();
      await store.load({});
      for (let i = 0; i < 4; i++) store.recordExposure("猫", 2, true);
      expect(store.bySurface("猫")!.recentSeenAt).toHaveLength(4);
      for (let i = 0; i < 4; i++) store.recordExposure("狗", 2, false);
      expect(store.bySurface("狗")!.recentSeenAt).toHaveLength(2);
    });

    it("recordNoteScan keeps every timestamp when asked to, else trims", async () => {
      const { store } = setup();
      await store.load({});
      store.recordNoteScan("a.md", new Map([["猫", 4]]), 2, true);
      expect(store.bySurface("猫")!.recentSeenAt).toHaveLength(4);
      store.recordNoteScan("b.md", new Map([["狗", 4]]), 2, false);
      expect(store.bySurface("狗")!.recentSeenAt).toHaveLength(2);
    });

    it("knownNotePaths skips words that were never seen in a note", async () => {
      const { store } = setup();
      await store.load({});
      store.ensure("猫");
      expect(store.knownNotePaths()).toEqual([]);
    });
  });

  describe("CSV export", () => {
    it("quotes commas, quotes and newlines, and copes with a record that has no surfaces or pinyin", async () => {
      const { store } = setup();
      await store.load({
        vocab: {
          schemaVersion: 3,
          words: {
            a: rec("a", { surfaces: [], pinyin: undefined, definitions: ["a, b", 'say "hi"', "x\ny"], hsk: { source: "2.0", levels: ["1", "2"] } }),
            b: rec("b", { pinyin: "p", definitions: undefined }),
          },
        },
      });
      const csv = await store.exportCsv();
      expect(csv).toContain('"a, b; say ""hi""; x\ny"');
      expect(csv).toContain("1/2");
      const lines = csv.split("\n");
      expect(lines.some((l) => l.startsWith("b|p5,b,p,,"))).toBe(true);
    });
  });

  describe("saving", () => {
    it("a store that was never loaded does not schedule a save", () => {
      vi.useFakeTimers();
      const { store, plugin } = setup();
      store.ensure("猫");
      vi.advanceTimersByTime(1000);
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("saves into an empty plugin blob when loadData returns null", async () => {
      const { store, plugin } = setup();
      plugin.loadData = vi.fn(async () => null);
      await store.load({});
      await store.flushSave({ mirror: false });
      expect(plugin.saveData).toHaveBeenCalledWith(expect.objectContaining({ vocab: expect.anything() }));
    });

    it("a failing debounced save is logged, not thrown", async () => {
      vi.useFakeTimers();
      const { store, plugin } = setup();
      await store.load({});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      plugin.saveData = vi.fn(async () => {
        throw new Error("disk full");
      });
      store.ensure("猫");
      await vi.advanceTimersByTimeAsync(500);
      expect(err).toHaveBeenCalled();
    });

    it("clearSurfaceCache makes a new dictionary entry visible", async () => {
      const { store } = setup();
      await store.load({});
      expect(store.bySurface("猫")).toBeUndefined();
      store.clearSurfaceCache();
      expect(store.bySurface("猫")).toBeUndefined();
    });
  });
});
