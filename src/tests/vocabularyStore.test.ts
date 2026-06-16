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
});
