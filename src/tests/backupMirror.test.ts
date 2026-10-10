import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";
import { makeKey } from "../dictionary/normalizeChinese";

/**
 * #149, the limit the restore dialog is honest about: sync can undo a restore.
 *
 * The vault mirror merge only ever takes the larger value or the union, so if the mirror file (or another device) still
 * holds what the newer version produced, the next merge adds it back to the restored data. These tests make that a tested
 * fact rather than a claim, and show what the backup does about it on THIS device: restoring the mirror file together with
 * data.json (it is part of the backup) means nothing is left here to bring the data back.
 */

const MIRROR = "Chinese Learning/vocabulary.json";

// Records carry their canonical key (what the store computes on load), or load would re-key them and double-count.
const rec = (word: string) => ({
  key: makeKey(word, "x"),
  surfaces: [word],
  simplified: word,
  pinyin: "x",
  status: "known",
  seenCount: 1,
  recentSeenAt: [],
  dailySeenCounts: { "2026-01-01": 1 },
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const envelope = (keys: string[]) =>
  JSON.stringify({ schemaVersion: 2, vocab: { schemaVersion: 1, words: Object.fromEntries(keys.map((k) => [makeKey(k, "x"), rec(k)])) } });

function deviceWith(restoredWords: string[], mirrorContent: string) {
  const files = new Map<string, string>([[MIRROR, mirrorContent]]);
  const adapter = {
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
    stat: vi.fn(async () => ({ mtime: 1, size: 1 })),
  };
  const blob: Record<string, unknown> = {
    vocab: { schemaVersion: 1, words: Object.fromEntries(restoredWords.map((k) => [makeKey(k, "x"), rec(k)])) },
  };
  const plugin: any = {
    app: { vault: { adapter } },
    loadData: vi.fn(async () => blob),
    saveData: vi.fn(async (b: Record<string, unknown>) => void Object.assign(blob, b)),
  };
  const settings = { ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR } };
  const store = new VocabularyStore(plugin, { lookup: () => [] } as any, () => settings);
  return { store, files };
}

beforeEach(() => {
  (globalThis as any).window = globalThis;
  vi.useFakeTimers();
});

describe("restore versus the vault mirror", () => {
  it("LIMIT: restoring data.json alone while the mirror still holds the newer version's words lets the next merge bring them back", async () => {
    // data.json restored to what the older version had: just 苹果. The mirror file still has 香蕉, added under the beta.
    const { store } = deviceWith(["苹果"], envelope(["苹果", "香蕉"]));
    await store.load({ vocab: { schemaVersion: 1, words: { [makeKey("苹果", "x")]: rec("苹果") } } });
    await store.bootstrapMirrorAfterLoad();
    expect(Object.values(store.toBlob().words).map((w) => w.simplified).sort()).toEqual(["苹果", "香蕉"].sort()); // resurrected
  });

  it("restoring the mirror file together with data.json (as the backup does) leaves nothing here to bring it back", async () => {
    const { store } = deviceWith(["苹果"], envelope(["苹果"])); // mirror rewritten from the backup
    await store.load({ vocab: { schemaVersion: 1, words: { [makeKey("苹果", "x")]: rec("苹果") } } });
    await store.bootstrapMirrorAfterLoad();
    expect(Object.values(store.toBlob().words).map((w) => w.simplified)).toEqual(["苹果"]);
  });

  it("LIMIT: a second device that still has the newer data can push it back, even after both files here were restored", async () => {
    const { store, files } = deviceWith(["苹果"], envelope(["苹果"]));
    await store.load({ vocab: { schemaVersion: 1, words: { [makeKey("苹果", "x")]: rec("苹果") } } });
    await store.bootstrapMirrorAfterLoad();
    // The other device syncs its newer file over the mirror.
    files.set(MIRROR, envelope(["苹果", "香蕉"]));
    (store as any).lastMirrorStat = null;
    expect(await store.absorbExternalMirrorChange()).toBe(true);
    expect(Object.values(store.toBlob().words).map((w) => w.simplified).sort()).toEqual(["苹果", "香蕉"].sort());
  });
});
