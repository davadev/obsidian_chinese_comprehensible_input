import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { radicalOf } from "../dictionary/radicals";

/**
 * The radical shown for a character is a lookup in Unicode's Unihan data, never something a model says. These are
 * characters whose radical is well known, so a wrong table, a shifted index or a bad decode would show up here.
 */
describe("radicalOf", () => {
  it.each([
    ["真", "目 (eye)"],
    ["的", "白 (white)"],
    ["好", "女 (woman)"],
    ["学", "子 (child)"],
    ["一", "一 (one)"],
    ["龠", "龠 (flute)"],
  ])("%s has the radical %s", (char, radical) => {
    expect(radicalOf(char)).toBe(radical);
  });

  it("shows a radical that is written differently beside other parts in both forms", () => {
    expect(radicalOf("河")).toBe("水 / 氵 (water)");
    expect(radicalOf("你")).toBe("人 / 亻 (person)");
    expect(radicalOf("打")).toBe("手 / 扌 (hand)");
  });

  it("shows the form learners actually meet for radicals whose Kangxi form is rare", () => {
    expect(radicalOf("花")).toBe("艹 (grass)");
    expect(radicalOf("道")).toBe("辶 (walk)");
  });

  it("gives a simplified character the simplified form of its radical, and its traditional twin the traditional one", () => {
    expect(radicalOf("讲")).toBe("讠 (speech)");
    expect(radicalOf("講")).toBe("言 (speech)");
    expect(radicalOf("钱")).toBe("钅 (gold)");
    expect(radicalOf("錢")).toBe("金 (gold)");
  });

  it("falls back to the Kangxi form when a simplified radical has no simplified glyph listed", () => {
    expect(radicalOf("鼡")).toBe("鼠 (rat)");
  });

  it("says nothing for anything that is not one character of the common block", () => {
    for (const s of ["", "a", "真的", "🙂", "𠀀", "〇"]) expect(radicalOf(s)).toBe("");
  });
});

describe("the Unihan data's licence", () => {
  it("travels with the data as a legal comment, which esbuild keeps in the shipped main.js, and is in NOTICE.md", () => {
    const generated = readFileSync("src/dictionary/radicalMap.generated.ts", "utf8");
    expect(generated.startsWith("/*! Radical data derived from the Unicode Unihan database")).toBe(true);
    expect(generated).toContain("UNICODE LICENSE V3");
    expect(generated).toContain("this copyright and permission notice appear with all copies");
    expect(readFileSync("NOTICE.md", "utf8")).toContain("UNICODE LICENSE V3");
  });
});

describe("radicalOf with a gap in the data", () => {
  afterEach(() => {
    vi.doUnmock("../dictionary/radicalMap.generated");
    vi.resetModules();
  });

  it("says nothing for a code point whose radical is not recorded", async () => {
    vi.resetModules();
    vi.doMock("../dictionary/radicalMap.generated", () => ({
      RADICAL_FIRST_CODE_POINT: 0x4e00,
      RADICAL_NUMBERS_B64: btoa(String.fromCharCode(0, 109)),
      RADICAL_SIMPLIFIED_B64: btoa(String.fromCharCode(0)),
    }));
    const { radicalOf: gappy } = await import("../dictionary/radicals");
    expect(gappy("一")).toBe("");
    expect(gappy("丁")).toBe("目 (eye)");
  });
});
