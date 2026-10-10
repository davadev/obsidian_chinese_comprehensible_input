import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";
import { colorOf } from "../vocabulary/axes";
import { makeKey } from "../dictionary/normalizeChinese";

/**
 * Reported on real devices (0.8.0-beta.4): a word marked known on the phone, with the full CC-CEDICT dictionary, stayed
 * "new" on a Mac that only had the small seed dictionary, even after Force re-sync on both. The same word was held under
 * two keys, `差不多|chà bu duō` (phone) and the bare `差不多` (Mac, no dictionary entry), the merge works key by key, and the
 * Mac's lookup resolved to the bare, never-classified one. These tests run two real stores over one shared vault.
 */

const MIRROR = "Chinese Learning/vocabulary.json";
const ENTRY = { simplified: "差不多", traditional: "差不多", pinyin: "chà bu duō", definitions: ["almost"] };
const PINYIN_KEY = makeKey("差不多", "chà bu duō");
const BARE_KEY = "差不多";

function vault() {
  const files = new Map<string, string>();
  let version = 0;
  const bump = (p: string) => void (p === MIRROR && version++);
  const adapter: any = {
    exists: async (p: string) => files.has(p) || p === "Chinese Learning",
    mkdir: async () => {},
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, c: string) => (files.set(p, c), bump(p)),
    rename: async (a: string, b: string) => (files.set(b, files.get(a) ?? ""), files.delete(a), bump(b)),
    remove: async (p: string) => void files.delete(p),
    list: async () => ({ files: [...files.keys()] }),
    stat: async (p: string) => ({ mtime: p === MIRROR ? version : 0, size: (files.get(p) ?? "").length }),
  };
  return { files, adapter };
}

function device(adapter: unknown, entries: unknown[]) {
  const blob: Record<string, unknown> = {};
  const plugin: any = { app: { vault: { adapter } }, loadData: async () => blob, saveData: async (b: object) => void Object.assign(blob, b) };
  const settings = { ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: MIRROR } };
  const dict = { lookup: (s: string) => (s === "差不多" ? entries : []) } as any;
  return new VocabularyStore(plugin, dict, () => settings);
}

const stateOf = (s: VocabularyStore) => {
  const r = s.bySurface("差不多");
  return r ? { key: r.key, status: r.status, colour: colorOf(r) } : null;
};
const keysOf = (s: VocabularyStore) => Object.keys(s.toBlob().words).sort();

beforeEach(() => {
  (globalThis as any).window = globalThis;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => vi.useRealTimers());

describe("one word, two devices with different dictionaries", () => {
  const scenarios: Array<[string, unknown[], unknown[], boolean]> = [
    ["same dictionary on both", [ENTRY], [ENTRY], true],
    ["phone has the dictionary, Mac does not, Mac already read the note", [ENTRY], [], true],
    ["phone has the dictionary, Mac does not, Mac never saw the word", [ENTRY], [], false],
    ["phone has no dictionary, Mac has it, Mac already read the note", [], [ENTRY], true],
  ];

  it.each(scenarios)("%s: the word marked known on the phone is known on the Mac, in a single record", async (_n, phoneDict, macDict, macSawIt) => {
    const v = vault();
    const phone = device(v.adapter, phoneDict);
    const mac = device(v.adapter, macDict);
    await phone.load({});
    await mac.load({});
    if (macSawIt) mac.recordExposure("差不多", 50, false, "note.md");
    phone.recordExposure("差不多", 50, false, "note.md");
    phone.setStatus("差不多", "known");
    await phone.flushMirrorNow();

    await mac.reloadMirror(); // "Force re-sync"
    await mac.absorbExternalMirrorChange();

    expect(stateOf(mac)).toMatchObject({ status: "known", colour: "known" });
    expect(keysOf(mac).filter((k) => k.startsWith("差不多"))).toHaveLength(1);
  });

  it("both devices end up with the identical record, and the sync then goes quiet", async () => {
    const v = vault();
    const phone = device(v.adapter, [ENTRY]);
    const mac = device(v.adapter, []);
    await phone.load({});
    await mac.load({});
    mac.recordExposure("差不多", 50, false, "note.md");
    phone.recordExposure("差不多", 50, false, "note.md");
    phone.setStatus("差不多", "known");
    await phone.flushMirrorNow();
    await mac.reloadMirror();
    await mac.flushMirrorNow();
    await phone.reloadMirror();

    expect(keysOf(phone)).toEqual(keysOf(mac));
    expect(JSON.stringify(phone.toBlob().words[PINYIN_KEY])).toBe(JSON.stringify(mac.toBlob().words[PINYIN_KEY]));
    // Nothing left to merge: a further poll on either device changes nothing and writes nothing.
    expect(await mac.absorbExternalMirrorChange()).toBe(false);
    expect(await phone.absorbExternalMirrorChange()).toBe(false);
  });
});

describe("reconciling a bare record into its pinyin-keyed sibling", () => {
  const rec = (key: string, over: Record<string, unknown> = {}) => ({
    key,
    surfaces: ["差不多"],
    simplified: "差不多",
    ...(key.includes("|") ? { pinyin: "chà bu duō" } : {}),
    status: "new",
    seenCount: 0,
    recentSeenAt: [],
    dailySeenCounts: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });
  const loaded = async (words: Record<string, unknown>) => {
    const v = vault();
    const s = device(v.adapter, []);
    await s.load({ vocab: { schemaVersion: 3, words } });
    return s;
  };

  it("on load: a stored pair is folded into the pinyin key, with the classified status winning", async () => {
    const s = await loaded({
      [PINYIN_KEY]: rec(PINYIN_KEY, { status: "known", updatedAt: "2026-02-01T00:00:00.000Z", dailySeenCounts: { "2026-01-01": 2 } }),
      [BARE_KEY]: rec(BARE_KEY, { dailySeenCounts: { "2026-01-01": 1, "2026-01-02": 3 } }),
    });
    expect(keysOf(s)).toEqual([PINYIN_KEY]);
    const r = s.toBlob().words[PINYIN_KEY];
    expect(r.status).toBe("known");
    expect(r.key).toBe(PINYIN_KEY);
    expect(r.dailySeenCounts).toEqual({ "2026-01-01": 2, "2026-01-02": 3 }); // per-day max, not a sum
    expect(r.seenCount).toBe(5);
  });

  it("the bare record's classification survives when the pinyin record is only 'new'", async () => {
    const s = await loaded({
      [PINYIN_KEY]: rec(PINYIN_KEY),
      [BARE_KEY]: rec(BARE_KEY, { status: "known", updatedAt: "2026-02-01T00:00:00.000Z" }),
    });
    expect(keysOf(s)).toEqual([PINYIN_KEY]);
    expect(s.toBlob().words[PINYIN_KEY].status).toBe("known");
  });

  it("a polyphone with several pinyin siblings is left alone: which one the bare record belongs to is a guess", async () => {
    const a = makeKey("差", "chā"), b = makeKey("差", "chà");
    const s = await loaded({
      [a]: rec(a, { simplified: "差", surfaces: ["差"], pinyin: "chā" }),
      [b]: rec(b, { simplified: "差", surfaces: ["差"], pinyin: "chà" }),
      差: rec("差", { simplified: "差", surfaces: ["差"], status: "known" }),
    });
    expect(keysOf(s).sort()).toEqual([a, b, "差"].sort());
  });

  it("records without a sibling, and pinyin records without a bare one, are untouched", async () => {
    const other = makeKey("你好", "nǐ hǎo");
    const s = await loaded({
      [BARE_KEY]: rec(BARE_KEY, { status: "known" }),
      [other]: rec(other, { simplified: "你好", surfaces: ["你好"], pinyin: "nǐ hǎo" }),
    });
    expect(keysOf(s).sort()).toEqual([BARE_KEY, other].sort());
  });

  it("is idempotent: loading the folded result again changes nothing", async () => {
    const first = await loaded({ [PINYIN_KEY]: rec(PINYIN_KEY, { status: "known" }), [BARE_KEY]: rec(BARE_KEY) });
    const again = await loaded(JSON.parse(JSON.stringify(first.toBlob().words)));
    expect(JSON.stringify(again.toBlob().words)).toBe(JSON.stringify(first.toBlob().words));
  });
});
