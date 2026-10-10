import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";

/**
 * How the mirror file is written. A sync tool (Remotely Save over WebDAV to Nextcloud) was seen answering
 * `405 Method Not Allowed` for the mirror file, so the write is made as gentle as it can be: identical content is not
 * rewritten, the temporary-file dance can be switched off, and a folder sitting at the path is reported instead of
 * failing silently.
 */

const MIRROR = "Chinese Learning/vocabulary.json";

function setup(opts: { inPlace?: boolean; folderAtPath?: boolean; noStat?: boolean } = {}) {
  const files = new Map<string, string>();
  const ops: string[] = [];
  const adapter: Record<string, any> = {
    exists: vi.fn(async (p: string) => files.has(p) || p === "Chinese Learning"),
    mkdir: vi.fn(async () => {}),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => (ops.push(`write ${p}`), void files.set(p, c))),
    rename: vi.fn(async (a: string, b: string) => (ops.push(`rename ${a} -> ${b}`), files.set(b, files.get(a) ?? ""), void files.delete(a))),
    remove: vi.fn(async (p: string) => (ops.push(`remove ${p}`), void files.delete(p))),
    list: vi.fn(async () => ({ files: [...files.keys()] })),
  };
  if (!opts.noStat) {
    adapter.stat = vi.fn(async (p: string) =>
      opts.folderAtPath && p === MIRROR ? { type: "folder", mtime: 1, size: 0 } : files.has(p) ? { type: "file", mtime: files.size, size: (files.get(p) ?? "").length } : null
    );
  }
  const plugin: any = {
    app: { vault: { adapter } },
    loadData: vi.fn(async () => ({})),
    saveData: vi.fn(async () => {}),
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR, mirrorWriteInPlace: !!opts.inPlace },
  };
  const store = new VocabularyStore(plugin, { lookup: () => [] } as any, () => settings);
  return { store, files, ops, adapter, settings };
}

const load = async (s: VocabularyStore) => s.load({ vocab: { schemaVersion: 1, words: {} } });

beforeEach(() => {
  (globalThis as any).window = globalThis;
  Notice.instances.length = 0;
});

describe("mirror write: the default stays atomic", () => {
  it("stages a temporary file, removes the old file, then renames", async () => {
    const { store, ops, files } = setup();
    await load(store);
    await store.flushMirrorNow();
    expect(ops).toEqual([`write ${MIRROR}.tmp`, `rename ${MIRROR}.tmp -> ${MIRROR}`]);
    expect(files.has(MIRROR)).toBe(true);
    await (store as any).ensure("苹果");
    await store.flushMirrorNow();
    expect(ops.slice(2)).toEqual([`write ${MIRROR}.tmp`, `remove ${MIRROR}`, `rename ${MIRROR}.tmp -> ${MIRROR}`]);
  });
});

describe("mirror write: in place", () => {
  it("writes the file directly, with no temporary file, no delete and no rename", async () => {
    const { store, ops, files } = setup({ inPlace: true });
    await load(store);
    await store.flushMirrorNow();
    store.ensure("苹果");
    await store.flushMirrorNow();
    expect(ops).toEqual([`write ${MIRROR}`, `write ${MIRROR}`]);
    expect([...files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
    expect(JSON.parse(files.get(MIRROR)!).vocab.words).toBeTruthy();
  });
});

describe("mirror write: identical content is not rewritten", () => {
  it.each([false, true])("with in-place writing %s: a second flush of unchanged data touches nothing", async (inPlace) => {
    const { store, ops } = setup({ inPlace });
    await load(store);
    await store.flushMirrorNow();
    const after = ops.length;
    await store.flushMirrorNow();
    await store.flushMirrorNow();
    expect(ops).toHaveLength(after);
  });

  it("changed data is written again", async () => {
    const { store, ops } = setup();
    await load(store);
    await store.flushMirrorNow();
    const after = ops.length;
    store.ensure("苹果");
    await store.flushMirrorNow();
    expect(ops.length).toBeGreaterThan(after);
  });

  it("a file that was deleted behind the plugin's back is written again even though its content is unchanged", async () => {
    const { store, files, ops } = setup();
    await load(store);
    await store.flushMirrorNow();
    files.delete(MIRROR);
    const after = ops.length;
    await store.flushMirrorNow();
    expect(ops.length).toBeGreaterThan(after);
    expect(files.has(MIRROR)).toBe(true);
  });

  it("on an adapter with no stat() it still writes (it cannot tell the file exists, so it does not skip)", async () => {
    const { store, files } = setup({ noStat: true });
    await load(store);
    await store.flushMirrorNow();
    expect(files.has(MIRROR)).toBe(true);
  });
});

describe("mirror write: a folder at the mirror path", () => {
  it("is reported once, in plain words, and nothing is attempted on it", async () => {
    const { store, ops } = setup({ folderAtPath: true });
    await load(store);
    await store.flushMirrorNow();
    await store.flushMirrorNow();
    expect(ops).toEqual([]);
    expect(Notice.instances).toHaveLength(1);
    expect(Notice.instances[0].message).toContain(`"${MIRROR}" is a folder`);
    expect(Notice.instances[0].message).toContain("Pick a file path");
  });

  it("does not log a write failure for it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = setup({ folderAtPath: true });
    await load(store);
    await store.flushMirrorNow();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
