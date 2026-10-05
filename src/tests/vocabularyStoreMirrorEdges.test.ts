import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";

/**
 * Failure and edge paths of the vault mirror that the main store tests do not drive: load-time
 * merge, unreadable files, adapters without `stat` / `rename`, folder creation, the debounced
 * local save. The mirror is the only place this plugin touches storage the user's sync tool
 * also touches, so a throw here must never turn into a failed plugin load or a lost write.
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
const envelope = (words: Record<string, unknown>) =>
  JSON.stringify({ schemaVersion: 2, vocab: { schemaVersion: 1, words } });

function setup(opts: { withStat?: boolean; folderExists?: boolean; mirrorEnabled?: boolean } = {}) {
  const files = new Map<string, string>();
  const adapter: Record<string, any> = {
    exists: vi.fn(async (p: string) => files.has(p) || (opts.folderExists !== false && p === "Chinese Learning")),
    mkdir: vi.fn(async () => {}),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    rename: vi.fn(async (a: string, b: string) => {
      files.set(b, files.get(a) ?? "");
      files.delete(a);
    }),
    remove: vi.fn(async (p: string) => void files.delete(p)),
    list: vi.fn(async () => ({ files: [...files.keys()] })),
  };
  if (opts.withStat !== false) adapter.stat = vi.fn(async () => ({ mtime: 1000, size: 10 }));
  const blob: Record<string, unknown> = {};
  const plugin: any = {
    app: { vault: { adapter } },
    loadData: vi.fn(async () => blob),
    saveData: vi.fn(async (b: Record<string, unknown>) => void Object.assign(blob, b)),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: opts.mirrorEnabled !== false, mirrorPath: MIRROR },
  };
  const dict: any = { lookup: () => [] };
  const store = new VocabularyStore(plugin, dict, () => settings);
  return { store, plugin, adapter, files, blob };
}

describe("VocabularyStore mirror edges", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("load-time merge", () => {
    it("merges the mirror file into memory and persists it, via bootstrapMirrorAfterLoad", async () => {
      const { store, files, plugin } = setup();
      files.set(MIRROR, envelope({ 学习: rec("学习") }));
      await store.load({});
      await store.bootstrapMirrorAfterLoad();
      expect(store.toBlob().words["学习"]).toBeTruthy();
      expect(plugin.saveData).toHaveBeenCalled();
    });

    it("does nothing when mirroring is off", async () => {
      const { store, adapter } = setup({ mirrorEnabled: false });
      await store.load({});
      await store.bootstrapMirrorAfterLoad();
      expect(adapter.read).not.toHaveBeenCalled();
    });

    it("works on an adapter that has no stat at all", async () => {
      const { store, files } = setup({ withStat: false });
      files.set(MIRROR, envelope({ 学习: rec("学习") }));
      await store.load({});
      await store.bootstrapMirrorAfterLoad();
      expect(store.toBlob().words["学习"]).toBeTruthy();
    });

    it("logs and carries on when reading the mirror throws: plugin load must not fail", async () => {
      const { store, files, adapter } = setup();
      files.set(MIRROR, envelope({}));
      adapter.read.mockRejectedValue(new Error("iCloud stalled"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await store.load({});
      await expect(store.bootstrapMirrorAfterLoad()).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    });

    it("logs and carries on when the post-load save throws", async () => {
      const { store, files, plugin } = setup();
      files.set(MIRROR, envelope({ 学习: rec("学习") }));
      plugin.saveData.mockRejectedValue(new Error("disk full"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await store.load({});
      await expect(store.bootstrapMirrorAfterLoad()).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    });
  });

  describe("mergeMirrorContent", () => {
    it("rejects a file that is not JSON, and changes nothing", async () => {
      const { store } = setup();
      await store.load({});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(store.mergeMirrorContent("{ truncated")).toBe(false);
      expect(Object.keys(store.toBlob().words)).toHaveLength(0);
    });

    it("treats valid JSON with no words as an empty store instead of throwing", async () => {
      // Found by this test: {"schemaVersion":3} (a truncated or half-synced file that still
      // parses) reached the merge with `words` undefined and threw out of the poll and the
      // vault-modify handler.
      const { store } = setup();
      await store.load({});
      store.ensure("学习");
      for (const c of [
        '{"schemaVersion":3}',
        '{"vocab":{"schemaVersion":3}}',
        '{"vocab":{"schemaVersion":3,"words":null}}',
        '"just a string"',
        "null",
      ]) {
        expect(() => store.mergeMirrorContent(c), c).not.toThrow();
      }
      // and merging nothing never removes what we have
      expect(Object.keys(store.toBlob().words)).toHaveLength(1);
    });
  });

  describe("polling", () => {
    it("treats a missing mirror file as no change", async () => {
      const { store } = setup();
      await store.load({});
      expect(await store.absorbExternalMirrorChange()).toBe(false);
    });

    it("does nothing when mirroring is off", async () => {
      const { store, adapter } = setup({ mirrorEnabled: false });
      await store.load({});
      expect(await store.absorbExternalMirrorChange()).toBe(false);
      expect(adapter.exists).not.toHaveBeenCalled();
    });

    it("without stat, still reads, and still finds a new remote version", async () => {
      const { store, files } = setup({ withStat: false });
      await store.load({});
      files.set(MIRROR, envelope({ 学习: rec("学习") }));
      expect(await store.absorbExternalMirrorChange()).toBe(true);
      files.set(MIRROR, envelope({ 学习: rec("学习"), 苹果: rec("苹果") }));
      expect(await store.absorbExternalMirrorChange()).toBe(true);
      expect(store.toBlob().words["苹果"]).toBeTruthy();
    });

    it("a stat that throws falls through to a full read instead of failing the poll", async () => {
      const { store, files, adapter } = setup();
      await store.load({});
      files.set(MIRROR, envelope({ 学习: rec("学习") }));
      adapter.stat.mockRejectedValue(new Error("no stat"));
      expect(await store.absorbExternalMirrorChange()).toBe(true);
    });

    it("an unparseable remote file is not applied and not recorded as seen", async () => {
      const { store, files, adapter } = setup();
      await store.load({});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      files.set(MIRROR, "{ half written");
      expect(await store.absorbExternalMirrorChange()).toBe(false);
      // the sync tool finishes the write (and the file's mtime moves): it must now be picked up
      files.set(MIRROR, envelope({ 学习: rec("学习") }));
      adapter.stat.mockResolvedValue({ mtime: 2000, size: 99 });
      expect(await store.absorbExternalMirrorChange()).toBe(true);
    });
  });

  describe("writing the mirror", () => {
    it("creates the folder when it does not exist", async () => {
      const { store, adapter } = setup({ folderExists: false });
      await store.load({});
      await store.flushMirrorNow();
      expect(adapter.mkdir).toHaveBeenCalledWith("Chinese Learning");
    });

    it("falls back to a direct write when the atomic rename is unavailable, and removes the staging file", async () => {
      const { store, files, adapter } = setup();
      await store.load({});
      adapter.rename.mockRejectedValue(new Error("rename unsupported"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await store.flushMirrorNow();
      expect(files.has(MIRROR)).toBe(true);
      expect(files.has(`${MIRROR}.tmp`)).toBe(false);
    });

    it("survives a failing cleanup AND a failing direct write, logging instead of throwing", async () => {
      const { store, adapter } = setup();
      await store.load({});
      adapter.write.mockRejectedValue(new Error("read-only"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(store.flushMirrorNow()).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    });

    it("a stat that fails right after our own write is harmless", async () => {
      const { store, adapter, files } = setup();
      await store.load({});
      adapter.stat.mockRejectedValue(new Error("stat"));
      await expect(store.flushMirrorNow()).resolves.toBeUndefined();
      expect(files.has(MIRROR)).toBe(true);
    });

    it("on an adapter without stat, writing still works and the next poll sees our own write as unchanged", async () => {
      const { store } = setup({ withStat: false });
      await store.load({});
      await store.flushMirrorNow();
      expect(await store.absorbExternalMirrorChange()).toBe(false);
    });
  });

  describe("local persistence", () => {
    it("debounces saves: several changes inside the window write once", async () => {
      vi.useFakeTimers();
      const { store, plugin } = setup({ mirrorEnabled: false });
      await store.load({});
      plugin.saveData.mockClear();
      store.ensure("学习");
      store.ensure("苹果");
      store.ensure("朋友");
      expect(plugin.saveData).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect(plugin.saveData).toHaveBeenCalledTimes(1);
    });

    it("never schedules a save before load has finished", async () => {
      vi.useFakeTimers();
      const { store, plugin } = setup({ mirrorEnabled: false });
      store.ensure("学习");
      await vi.advanceTimersByTimeAsync(1000);
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("prefers the plugin's own blob updater when it has one (so settings and vocab never overwrite each other)", async () => {
      const { store, plugin } = setup({ mirrorEnabled: false });
      const blob: Record<string, unknown> = { settings: { keep: true } };
      plugin.updateDataBlob = vi.fn(async (fn: (b: Record<string, unknown>) => void) => fn(blob));
      await store.load({});
      await store.flushSave();
      expect(plugin.updateDataBlob).toHaveBeenCalled();
      expect(blob.vocab).toBeTruthy();
      expect(blob.settings).toEqual({ keep: true });
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("exports the whole store as JSON", async () => {
      const { store } = setup({ mirrorEnabled: false });
      await store.load({});
      store.ensure("学习");
      const out = JSON.parse(await store.exportJson());
      expect(Object.keys(out.words)).toHaveLength(1);
    });
  });
});
