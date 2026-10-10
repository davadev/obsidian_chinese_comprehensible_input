import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VocabularyStore } from "../vocabulary/VocabularyStore";

/**
 * The mirror carries what is worth moving between devices and nothing else (see mirrorSlim.ts), and a path that is not a
 * usable .json path is never written to. Two real stores over one shared vault.
 */

const MIRROR = "Chinese Learning/vocabulary.json";

function vault() {
  const files = new Map<string, string>();
  let version = 0;
  const adapter: any = {
    exists: async (p: string) => files.has(p) || p === "Chinese Learning",
    mkdir: async () => {},
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, c: string) => (files.set(p, c), void (p === MIRROR && version++)),
    rename: async (a: string, b: string) => (files.set(b, files.get(a) ?? ""), files.delete(a), void (b === MIRROR && version++)),
    remove: async (p: string) => void files.delete(p),
    list: async () => ({ files: [...files.keys()] }),
    stat: async (p: string) => ({ type: "file", mtime: p === MIRROR ? version : 0, size: (files.get(p) ?? "").length }),
  };
  return { files, adapter };
}

function device(adapter: unknown, mirrorPath = MIRROR) {
  const plugin: any = { app: { vault: { adapter } }, loadData: async () => ({}), saveData: async () => {} };
  const settings = { ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath } };
  return new VocabularyStore(plugin, { lookup: () => [] } as any, () => settings);
}

beforeEach(() => {
  (globalThis as any).window = globalThis;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  Notice.instances.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("what the mirror file holds", () => {
  it("has the classified words, without per-note counters, with few timestamps, and without untouched 'new' words", async () => {
    const v = vault();
    const a = device(v.adapter);
    await a.load({});
    for (let i = 0; i < 20; i++) a.recordExposure("词", 50, false, `Notes/n${i}.md`);
    a.recordExposure("新词", 50, false, "Notes/n1.md"); // seen, never classified
    a.setStatus("词", "known");
    await a.flushMirrorNow();

    const file = JSON.parse(v.files.get(MIRROR)!);
    const words = Object.values(file.vocab.words) as any[];
    expect(words.map((w) => w.simplified)).toEqual(["词"]);
    expect(words[0]).not.toHaveProperty("notesSeenCounts");
    expect(words[0].recentSeenAt.length).toBeLessThanOrEqual(5);
    expect(words[0].status).toBe("known");
  });

  it("does not change this device's own data: it still has the counters and the untouched words", async () => {
    const v = vault();
    const a = device(v.adapter);
    await a.load({});
    a.recordExposure("词", 50, false, "Notes/n1.md");
    a.recordExposure("新词", 50, false, "Notes/n1.md");
    a.setStatus("词", "known");
    await a.flushMirrorNow();
    expect(Object.keys(a.toBlob().words)).toHaveLength(2);
    expect(Object.values(a.toBlob().words).find((w) => w.simplified === "词")?.notesSeenCounts).toEqual({ "Notes/n1.md": 1 });
  });
});

describe("two devices with the slim mirror", () => {
  it("a word marked known on one device is known on the other, which keeps its own exposure data", async () => {
    const v = vault();
    const phone = device(v.adapter);
    const mac = device(v.adapter);
    await phone.load({});
    await mac.load({});
    mac.recordExposure("词", 50, false, "Mac/own-note.md"); // the Mac's own reading history
    phone.recordExposure("词", 50, false, "Phone/note.md");
    phone.setStatus("词", "known");
    await phone.flushMirrorNow();

    await mac.reloadMirror();
    const r = Object.values(mac.toBlob().words).find((w) => w.simplified === "词")!;
    expect(r.status).toBe("known");
    expect(r.notesSeenCounts).toEqual({ "Mac/own-note.md": 1 }); // not erased by a mirror that carries none
  });

  it("a device that never saw the word adopts it as a thin record, and the sync then goes quiet", async () => {
    const v = vault();
    const phone = device(v.adapter);
    const mac = device(v.adapter);
    await phone.load({});
    await mac.load({});
    phone.recordExposure("词", 50, false, "Phone/note.md");
    phone.setStatus("词", "known");
    await phone.flushMirrorNow();

    await mac.reloadMirror();
    const r = Object.values(mac.toBlob().words).find((w) => w.simplified === "词")!;
    expect(r.status).toBe("known");

    // The first exchanges normalise the adopted record once (as for any one-sided record); then both sides go quiet.
    let quiet = false;
    for (let round = 0; round < 5 && !quiet; round++) {
      const m = await mac.absorbExternalMirrorChange();
      if (m) await mac.flushMirrorNow();
      const p = await phone.absorbExternalMirrorChange();
      if (p) await phone.flushMirrorNow();
      quiet = !m && !p;
    }
    expect(quiet).toBe(true);
  });
});

describe("a mirror path that is not a usable .json path", () => {
  it.each(["Chinese Learning/vocabulary.", "Chinese Learning/vocabulary.json nowledgebase", "vocabulary"])(
    "%s: nothing is written anywhere, and the person is told once",
    async (path) => {
      const v = vault();
      const store = device(v.adapter, path);
      await store.load({});
      store.setStatus("词", "known");
      await store.flushMirrorNow();
      await store.flushMirrorNow();
      expect([...v.files.keys()]).toEqual([]);
      expect(store.mirrorPath()).toBeNull();
      expect(Notice.instances).toHaveLength(1);
      expect(Notice.instances[0].message).toContain(`"${path}" cannot be used`);
    }
  );
});
