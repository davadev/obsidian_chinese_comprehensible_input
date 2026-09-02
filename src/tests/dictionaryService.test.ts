import { describe, it, expect } from "vitest";
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
