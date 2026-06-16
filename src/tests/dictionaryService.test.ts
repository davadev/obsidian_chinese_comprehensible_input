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
