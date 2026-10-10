import { describe, it, expect, vi } from "vitest";
import { DictionaryService } from "../dictionary/DictionaryService";
import { makeKey } from "../dictionary/normalizeChinese";

function makeService() {
  const service = new DictionaryService({
    vault: {
      adapter: {
        exists: async () => false,
        read: async () => "[]",
      },
    },
  } as any);
  return service;
}

describe("DictionaryService", () => {
  it("prefers custom words and applies overrides to native entries", async () => {
    const service = makeService();
    service.setOverlay(
      () => ({
        [makeKey("学习", "xué xí")]: {
          definitions: ["custom definition"],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      () => ({
        学习: {
          simplified: "学习",
          traditional: "學習",
          pinyin: "xué xí",
          definitions: ["user entry"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      })
    );

    await service.ensureLoaded();
    const entries = service.lookup("学习");
    expect(entries[0].definitions).toEqual(["user entry"]);
    expect(entries[1].definitions).toEqual(["custom definition"]);
  });

  it("looks up traditional forms and dedupes custom surfaces from iterator", async () => {
    const service = makeService();
    service.setOverlay(
      () => ({}),
      () => ({
        学习: {
          simplified: "学习",
          pinyin: "xué xí",
          definitions: ["user entry"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      })
    );

    await service.ensureLoaded();
    expect(service.lookup("學習")[0].simplified).toBe("学习");
    const surfaces = Array.from(service.surfaces()).filter((s) => s === "学习");
    expect(surfaces).toHaveLength(1);
  });

  it("backfills HSK data for entries that come only from the vault dictionary", async () => {
    const service = new DictionaryService({
      vault: {
        adapter: {
          exists: async (path: string) => path === ".cci-dictionary.json",
          read: async () => JSON.stringify([
            {
              simplified: "苹果",
              traditional: "蘋果",
              pinyin: "píng guǒ",
              definitions: ["apple"],
            },
          ]),
        },
      },
    } as any);

    await service.ensureLoaded();
    expect(service.lookup("苹果")[0].hsk).toEqual({ source: "2.0", levels: ["1"] });
  });
});

describe("DictionaryService.surfaces", () => {
  it("yields simplified headwords only by default", async () => {
    const service = makeService();
    await service.ensureLoaded();
    const surfaces = [...service.surfaces()];
    // 学习/學習 is in the seed dictionary.
    expect(surfaces).toContain("学习");
    expect(surfaces).not.toContain("學習");
  });

  it("adds traditional forms as a union when asked", async () => {
    const service = makeService();
    await service.ensureLoaded();
    const base = [...service.surfaces()];
    const union = [...service.surfaces({ includeTraditional: true })];
    // A union, not a swap: the simplified forms must all still be there,
    // so a vault holding both kinds of note keeps working.
    for (const s of base) expect(union).toContain(s);
    expect(union).toContain("學習");
    expect(union.length).toBeGreaterThan(base.length);
  });

  it("never yields a duplicate", async () => {
    const service = makeService();
    await service.ensureLoaded();
    const union = [...service.surfaces({ includeTraditional: true })];
    expect(new Set(union).size).toBe(union.length);
  });

  it("includes a custom word's traditional form only in the union", async () => {
    const service = makeService();
    service.setOverlay(
      () => ({}),
      () => ({
        网路: {
          simplified: "网路",
          traditional: "網路",
          pinyin: "wǎng lù",
          definitions: ["network"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      })
    );
    await service.ensureLoaded();
    expect([...service.surfaces()]).not.toContain("網路");
    expect([...service.surfaces({ includeTraditional: true })]).toContain("網路");
  });
});

describe("DictionaryService.lookup ordering", () => {
  it("returns simplified-map entries before traditional-map ones", async () => {
    // Load-bearing: VocabularyStore.ensure() keys records off lookup()[0],
    // so if [0] could move, every record for a surface that is both a
    // simplified headword and someone else's traditional form would be
    // re-keyed. Ordering must not depend on any setting.
    const service = makeService();
    await service.ensureLoaded();
    const viaSimplified = service.lookup("学习");
    expect(viaSimplified[0]?.simplified).toBe("学习");
  });

  it("still resolves a surface that only exists as a traditional form", async () => {
    const service = makeService();
    await service.ensureLoaded();
    const entries = service.lookup("學習");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].simplified).toBe("学习");
  });
});

describe("DictionaryService.distinctTraditionalForms", () => {
  it("reports 1 for an unambiguous word", async () => {
    const service = makeService();
    await service.ensureLoaded();
    expect(service.distinctTraditionalForms("学习")).toBe(1);
  });

  it("reports 0 when the word is written the same in both scripts", async () => {
    const service = makeService();
    await service.ensureLoaded();
    expect(service.distinctTraditionalForms("好")).toBe(0);
  });

  it("reports >1 when the mapping is ambiguous", async () => {
    const service = makeService();
    service.setOverlay(
      () => ({}),
      () => ({}),
    );
    await service.ensureLoaded();
    // 发 is 發 (to emit) or 髮 (hair) — the case that makes converting
    // simplified -> traditional unsafe.
    (service as unknown as { index: (e: unknown) => void }).index({
      simplified: "发", traditional: "發", pinyin: "fā", definitions: ["to emit"],
    });
    (service as unknown as { index: (e: unknown) => void }).index({
      simplified: "发", traditional: "髮", pinyin: "fà", definitions: ["hair"],
    });
    expect(service.distinctTraditionalForms("发")).toBe(2);
  });
});

describe("DictionaryService loading edges", () => {
  const svc = (adapter: Record<string, unknown>) =>
    new DictionaryService({ vault: { adapter } } as any);

  it("a missing vault dictionary leaves the built-in seed usable", async () => {
    const s = svc({ exists: async () => false, read: async () => "[]" });
    await s.ensureLoaded();
    expect(s.size()).toBeGreaterThan(0);
  });

  it("a corrupt vault dictionary is ignored, not fatal", async () => {
    const s = svc({ exists: async () => true, read: async () => "{ truncated" });
    await expect(s.ensureLoaded()).resolves.toBeUndefined();
    expect(s.size()).toBeGreaterThan(0);
  });

  it("a vault dictionary that is JSON but not a list is ignored", async () => {
    const s = svc({ exists: async () => true, read: async () => '{"a":1}' });
    const before = svc({ exists: async () => false, read: async () => "[]" });
    await before.ensureLoaded();
    await s.ensureLoaded();
    expect(s.size()).toBe(before.size());
  });

  it("skips malformed entries but keeps the good ones", async () => {
    const good = { simplified: "测试词", traditional: "測試詞", pinyin: "cè shì cí", definitions: ["test word"] };
    const s = svc({
      exists: async () => true,
      read: async () => JSON.stringify([null, 5, { simplified: 1, pinyin: "x" }, { simplified: "无拼音" }, good]),
    });
    await s.ensureLoaded();
    expect(s.lookup("测试词")).toHaveLength(1);
    expect(s.has("无拼音")).toBe(false);
  });

  it("concurrent ensureLoaded calls share one load", async () => {
    const read = vi.fn(async () => "[]");
    const s = svc({ exists: async () => true, read });
    await Promise.all([s.ensureLoaded(), s.ensureLoaded(), s.ensureLoaded()]);
    expect(read).toHaveBeenCalledTimes(1);
    await s.ensureLoaded();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reload re-reads the file, so a fresh download is picked up", async () => {
    let content = "[]";
    const s = svc({ exists: async () => true, read: async () => content });
    await s.ensureLoaded();
    expect(s.has("新下载词")).toBe(false);
    content = JSON.stringify([{ simplified: "新下载词", traditional: "新下載詞", pinyin: "xīn", definitions: ["x"] }]);
    await s.reload();
    expect(s.has("新下载词")).toBe(true);
  });

  it("isOnDisk reflects the file, and is false (not a throw) when the adapter fails", async () => {
    expect(await svc({ exists: async () => true, read: async () => "[]" }).isOnDisk()).toBe(true);
    expect(await svc({ exists: async () => false, read: async () => "[]" }).isOnDisk()).toBe(false);
    expect(await svc({ exists: async () => { throw new Error("io"); }, read: async () => "[]" }).isOnDisk()).toBe(false);
  });

  it("has() sees custom words, simplified and traditional forms; lookupRaw ignores the overlay", async () => {
    const s = svc({ exists: async () => false, read: async () => "[]" });
    s.setOverlay(() => ({}), () => ({
      自定义: { simplified: "自定义", traditional: "自定義", pinyin: "zì dìng yì", definitions: ["custom"], createdAt: "t", updatedAt: "t" },
    }));
    await s.ensureLoaded();
    expect(s.has("自定义")).toBe(true);
    expect(s.lookupRaw("自定义")).toEqual([]);
    expect(s.has("没有这个词")).toBe(false);
  });
});

describe("DictionaryService: loading and overlay gaps", () => {
  const loaded = async (entries: unknown[]) => {
    const service = new DictionaryService({
      vault: { adapter: { exists: async () => true, read: async () => JSON.stringify(entries) } },
    } as any);
    await service.ensureLoaded();
    return service;
  };

  it("repairs pinyin an older build wrote with the tone on the wrong vowel, and leaves correct pinyin alone", async () => {
    const service = await loaded([
      { simplified: "久", traditional: "久", pinyin: "jǐu", definitions: ["long time"] },
      { simplified: "好", traditional: "好", pinyin: "hǎo", definitions: ["good"] },
    ]);
    expect(service.lookup("久")[0].pinyin).toBe("jiǔ");
    expect(service.lookup("好")[0].pinyin).toBe("hǎo");
  });

  it("lifts a Taiwan reading out of the definitions, but never overwrites one the entry already has", async () => {
    const service = await loaded([
      { simplified: "垃圾", traditional: "垃圾", pinyin: "lā jī", definitions: ["garbage", "Taiwan pr. [le4 se4]"] },
      { simplified: "垃", traditional: "垃", pinyin: "lā", pinyinTaiwan: "lè", definitions: ["Taiwan pr. [le4 se4]"] },
    ]);
    expect(service.lookup("垃圾")[0].pinyinTaiwan).toBe("lè sè");
    expect(service.lookup("垃")[0].pinyinTaiwan).toBe("lè");
  });

  it("an entry whose definitions mention no Taiwan reading gets none", async () => {
    const service = await loaded([{ simplified: "水", traditional: "水", pinyin: "shuǐ", definitions: ["water"] }]);
    expect(service.lookup("水")[0].pinyinTaiwan).toBeUndefined();
  });

  it("a custom word without a traditional form uses its simplified form for it", () => {
    const service = makeService();
    service.setOverlay(
      () => ({}),
      () => ({ 咖啡馆: { simplified: "咖啡馆", pinyin: "kā fēi guǎn", definitions: ["cafe"], createdAt: "x", updatedAt: "x" } })
    );
    expect(service.lookup("咖啡馆")[0].traditional).toBe("咖啡馆");
  });

  it("an override that sets only some fields keeps the entry's own for the rest", async () => {
    const service = await loaded([{ simplified: "怪词", traditional: "怪詞", pinyin: "guài cí", definitions: ["odd word"] }]);
    service.setOverlay(
      () => ({ [makeKey("怪词", "guài cí")]: { pinyin: "guài ci", updatedAt: "x" } }),
      () => ({})
    );
    const e = service.lookup("怪词")[0];
    expect(e.pinyin).toBe("guài ci");
    expect(e.definitions).toEqual(["odd word"]);
    expect(e.traditional).toBe("怪詞");
  });
});
