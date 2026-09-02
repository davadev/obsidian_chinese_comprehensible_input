import { describe, it, expect } from "vitest";
import { VocabularyStore } from "../vocabulary/VocabularyStore";
import { DictionaryService } from "../dictionary/DictionaryService";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { makeKey } from "../dictionary/normalizeChinese";
import { DATA_SCHEMA_VERSION } from "../constants";

/**
 * Upgrade path from 0.5.1. The pinyin repair changes how a numbered pinyin
 * string hashes, so records written by the old build must re-key and merge
 * rather than fork into duplicates.
 */
function makeStore() {
  const dict = new DictionaryService({
    vault: { adapter: { exists: async () => false, read: async () => "[]" } },
  } as never);
  const saved: unknown[] = [];
  const plugin = {
    app: {},
    saveData: async (b: unknown) => { saved.push(b); },
    loadData: async () => ({}),
    updateDataBlob: async (fn: (b: Record<string, unknown>) => void) => { fn({}); },
    register: () => undefined,
  };
  const store = new VocabularyStore(plugin as never, dict, () => DEFAULT_SETTINGS);
  return { store, dict };
}

describe("0.5.1 -> 0.6.0 vocabulary upgrade", () => {
  it("re-keys a record whose stored pinyin was numbered", async () => {
    // 女 shipped as the literal "nü3" before the fix, so the old build keyed
    // it 女|nü53.
    const { store } = makeStore();
    await store.load({
      vocab: {
        schemaVersion: DATA_SCHEMA_VERSION,
        words: {
          "女|nü53": {
            key: "女|nü53", surfaces: ["女"], simplified: "女", pinyin: "nü3",
            status: "known", seenCount: 7, recentSeenAt: [], dailySeenCounts: {},
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    });
    expect(store.get(makeKey("女", "nü3"))).toBeDefined();
    expect(store.get("女|nü53")).toBeUndefined();
  });

  it("merges an old-key and new-key record for the same word instead of duplicating", async () => {
    const { store } = makeStore();
    await store.load({
      vocab: {
        schemaVersion: DATA_SCHEMA_VERSION,
        words: {
          "女|nü53": {
            key: "女|nü53", surfaces: ["女"], simplified: "女", pinyin: "nü3",
            status: "known", seenCount: 7, recentSeenAt: [], dailySeenCounts: {},
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          "女|nü3": {
            key: "女|nü3", surfaces: ["女"], simplified: "女", pinyin: "nǚ",
            status: "unknown", seenCount: 3, recentSeenAt: [], dailySeenCounts: {},
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        },
      },
    });
    expect(store.size()).toBe(1);
    const rec = store.get("女|nü3");
    // Strongest status wins and exposure counts are summed.
    expect(rec?.status).toBe("known");
    expect(rec?.seenCount).toBe(10);
  });

  it("preserves an untouched record exactly", async () => {
    const { store } = makeStore();
    await store.load({
      vocab: {
        schemaVersion: DATA_SCHEMA_VERSION,
        words: {
          "学习|xue2 xi2": {
            key: "学习|xue2 xi2", surfaces: ["学习", "學習"], simplified: "学习",
            traditional: "學習", pinyin: "xué xí", status: "known", seenCount: 4,
            recentSeenAt: [], dailySeenCounts: {}, updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    });
    const rec = store.get("学习|xue2 xi2");
    expect(rec?.status).toBe("known");
    expect(rec?.seenCount).toBe(4);
  });

  it("keeps a traditional surface resolving to the same record", async () => {
    const { store } = makeStore();
    await store.load({
      vocab: {
        schemaVersion: DATA_SCHEMA_VERSION,
        words: {
          "学习|xue2 xi2": {
            key: "学习|xue2 xi2", surfaces: ["学习", "學習"], simplified: "学习",
            traditional: "學習", pinyin: "xué xí", status: "known", seenCount: 4,
            recentSeenAt: [], dailySeenCounts: {}, updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    });
    expect(store.bySurface("學習")?.key).toBe("学习|xue2 xi2");
    expect(store.bySurface("学习")?.key).toBe("学习|xue2 xi2");
  });
});
