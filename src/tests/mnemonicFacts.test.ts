import { describe, it, expect } from "vitest";
import {
  allowedHanzi,
  charFacts,
  extractCues,
  idsLeaves,
  normSyllable,
  pairCorrect,
  parseMmah,
  storyPairs,
  toneOf,
  toneStrip,
} from "../../scripts/lib/mnemonicFacts.mjs";

/** The mnemonic-compare experiment (#185): the parts that decide what counts as right. */

const MMAH = parseMmah(
  [
    '{"character":"河","definition":"river","pinyin":["hé"],"decomposition":"⿰氵可","etymology":{"type":"pictophonetic","phonetic":"可","semantic":"氵"},"radical":"氵"}',
    '{"character":"氵","definition":"water","pinyin":[],"decomposition":"？"}',
    '{"character":"可","definition":"can; may","pinyin":["kě"],"decomposition":"⿸丁口"}',
    "not json",
  ].join("\n")
);

describe("pinyin and tones", () => {
  it("normalises marks, digits, neutral tone and ü", () => {
    expect(normSyllable("xué")).toBe("xue2");
    expect(normSyllable("xue2")).toBe("xue2");
    expect(normSyllable("lüè")).toBe("lve4");
    expect(normSyllable("nǚ")).toBe("nv3");
    expect(normSyllable("ma")).toBe("ma5");
    expect(toneOf("shǒu")).toBe(3);
  });

  it("builds the strip and reads cues back, third tone before fourth", () => {
    expect(toneStrip(["xué", "xí", "ma"])).toBe("↗️↗️〰️");
    expect(extractCues("🌳↘️↗️➡️↘️〰️")).toEqual([3, 1, 4, 5]);
    expect(extractCues("↘↗➡↗〰")).toEqual([3, 1, 2, 5]);
  });
});

describe("reference data", () => {
  it("parses lines, skips damaged ones, drops unknown-part markers", () => {
    expect(MMAH.size).toBe(3);
    expect(idsLeaves("⿰氵可")).toEqual(["氵", "可"]);
    expect(idsLeaves("？")).toEqual([]);
    expect(idsLeaves("")).toEqual([]);
  });

  it("writes a fact line with glosses and roles, or null when there is nothing", () => {
    expect(charFacts("河", MMAH)).toBe("河: pictophonetic; parts: 氵 (water) + 可 (can); sound hint from 可; meaning hint from 氵; radical 氵 (water)");
    expect(charFacts("无", MMAH)).toBeNull();
  });

  it("lists every hanzi a story about the word may name", () => {
    expect([...allowedHanzi("河", MMAH)].sort()).toEqual(["可", "氵", "河", "丁", "口"].sort());
  });
});

describe("story pinyin", () => {
  it("separates hanzi followed by pinyin from bare runs", () => {
    expect(storyPairs("你 (nǐ) see 河 and 可（kě）, then 水.")).toEqual({
      pairs: [
        { hanzi: "你", pinyin: "nǐ" },
        { hanzi: "可", pinyin: "kě" },
      ],
      bare: ["河", "水"],
    });
  });

  it("checks the word, its characters and reference readings; null when unknowable", () => {
    expect(pairCorrect("学习", "xué xí", "学习", ["xué", "xí"], MMAH)).toBe(true);
    expect(pairCorrect("学习", "xue2 xi3", "学习", ["xué", "xí"], MMAH)).toBe(false);
    expect(pairCorrect("习", "xí", "学习", ["xué", "xí"], MMAH)).toBe(true);
    expect(pairCorrect("可", "kě", "河", ["hé"], MMAH)).toBe(true);
    expect(pairCorrect("可", "kè", "河", ["hé"], MMAH)).toBe(false);
    expect(pairCorrect("水", "shuǐ", "河", ["hé"], MMAH)).toBeNull();
    expect(pairCorrect("河可", "hé kě", "河", ["hé"], MMAH)).toBe(true);
    expect(pairCorrect("河水", "hé shuǐ", "河", ["hé"], MMAH)).toBeNull();
  });
});

describe("gloss instead of pinyin", () => {
  it("flags a gloss in the parenthesis and tolerates a neutral-tone reference", () => {
    expect(pairCorrect("氵", "water", "河", ["hé"], MMAH)).toBe("gloss");
    expect(pairCorrect("河", "river", "河", ["hé"], MMAH)).toBe("gloss");
    expect(pairCorrect("可", "kě", "河", ["hé"], MMAH)).toBe(true);
    expect(pairCorrect("水", "water", "河", ["hé"], MMAH)).toBe("gloss");
    expect(pairCorrect("子", "zǐ", "好", ["hǎo"], parseMmah('{"character":"子","pinyin":["zi"],"decomposition":"？"}'))).toBe(true);
  });
});

describe("gated reference facts", () => {
  const M2 = parseMmah(
    [
      '{"character":"山","definition":"mountain","decomposition":"⿻凵丨","etymology":{"type":"pictographic","hint":"Three mountain peaks"}}',
      '{"character":"了","definition":"finish","decomposition":"⿻乛亅"}',
      '{"character":"田","definition":"field","decomposition":"？","etymology":{"type":"pictographic"}}',
    ].join("\n")
  );

  it("replaces pictographic parts by the hint and skips characters without etymology", () => {
    expect(charFacts("山", M2, { gated: true })).toBe("山: pictographic; origin: Three mountain peaks");
    expect(charFacts("山", M2)).toContain("parts: 凵 + 丨");
    expect(charFacts("了", M2, { gated: true })).toBeNull();
    expect(charFacts("田", M2, { gated: true })).toBeNull();
  });
});
