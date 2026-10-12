import { describe, it, expect } from "vitest";
import {
  allowedHanzi,
  assembleLine,
  ccdFacts,
  ccdLeaves,
  charFacts,
  extractCues,
  idsLeaves,
  normSyllable,
  pairCorrect,
  parseCcd,
  parseMmah,
  parsePlecoFlat,
  plecoFacts,
  shortDef,
  singleCharFacts,
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

describe("Pleco-forum files", () => {
  it("reads the flat list with English part names", () => {
    const m = parsePlecoFlat("//Decomposition 7120\t\t\n妈\tma\t女马     woman, horse\n山\tshan\t山     mountain, \n明\tming2\t日月     sun/day, moon\n妈\tx\t女     dup\n");
    expect(m.size).toBe(3);
    expect(plecoFacts("妈", m)).toBe("妈: parts: 女 (woman) + 马 (horse)");
    expect(plecoFacts("山", m)).toBeNull();
    expect(plecoFacts("无", m)).toBeNull();
  });

  it("reads the component tree with depth and clean glosses", () => {
    const tree = "TREE想├── 心 (4)└── 相 (1)    ├── 木 (2)    └── 目 (3)COMPONENTS» 心 ① heart";
    const m = parseCcd(
      [
        "// header",
        `想\txiǎng\tMEANING① to think ${tree}`,
        "心\txīn\tMEANING① heart (radical number 61) Alternative(s): 忄 CONTAINS想",
        "相\txiāng\tMEANING① surname Xiang ② each other CONTAINS想",
        "木\tmù\tMEANING① tree CONTAINS相",
        "目\tmù\tMEANING① eye CONTAINS相",
      ].join("\n")
    );
    expect(ccdLeaves("想", m)).toEqual(["心", "相", "木", "目"]);
    expect(ccdFacts("想", m)).toBe("想: parts: 心 (heart) + 相 (each other) [= 木 (tree) + 目 (eye)]");
    expect(ccdFacts("心", m)).toBeNull();
    expect(ccdLeaves("无", m)).toEqual([]);
  });
});

describe("round 4: per-character line and single-character facts", () => {
  const M3 = parseMmah(
    [
      '{"character":"想","definition":"think; want","decomposition":"⿱相心","etymology":{"type":"pictophonetic","phonetic":"相","semantic":"心","hint":"mind"}}',
      '{"character":"相","definition":"mutual","decomposition":"？"}',
      '{"character":"心","definition":"heart","decomposition":"？"}',
      '{"character":"山","definition":"mountain","etymology":{"type":"pictographic","hint":"Three peaks"}}',
      '{"character":"田","definition":"field","etymology":{"type":"pictographic"}}',
      '{"character":"一","definition":"one","etymology":{"type":"ideographic","hint":"one stroke"},"decomposition":"一"}',
      '{"character":"无","definition":"","decomposition":"？"}',
    ].join("\n")
  );

  it("labels sound and meaning parts only when asked", () => {
    expect(singleCharFacts("想", M3, true)).toBe("想: pictophonetic; parts: 相 (mutual) [sound only] + 心 (heart) [meaning]; origin: mind");
    expect(singleCharFacts("想", M3, false)).toBe("想: pictophonetic; parts: 相 (mutual) + 心 (heart); origin: mind");
  });

  it("uses the hint for pictographs and says nothing when there is nothing to say", () => {
    expect(singleCharFacts("山", M3, true)).toBe("山: pictographic; origin: Three peaks");
    expect(singleCharFacts("田", M3, true)).toBeNull();
    expect(singleCharFacts("一", M3, true)).toBe("一: ideographic; origin: one stroke");
    expect(singleCharFacts("无", M3, true)).toBeNull();
    expect(singleCharFacts("水", M3, true)).toBeNull();
  });

  it("shortens definitions", () => {
    expect(shortDef("想", M3)).toBe("think");
    expect(shortDef("无", M3)).toBe("");
    expect(shortDef("水", M3)).toBe("");
    expect(shortDef("想", parseMmah(`{"character":"想","definition":"${"a".repeat(60)}"}`))).toHaveLength(40);
  });

  it("puts each tone cue straight after its own group and the meaning last", () => {
    expect(assembleLine(["🖼️", "📖", "🏛️"], ["tú", "shū", "guǎn"], "📚")).toBe("🖼️↗️📖➡️🏛️↘️↗️📚");
    expect(assembleLine(["🌳"], ["xiǎng", "x"], "🤔")).toBe("🌳↘️↗️〰️🤔");
  });
});
