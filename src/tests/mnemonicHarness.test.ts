import { describe, expect, it } from "vitest";
import {
  assembleLine,
  cleanGroup,
  expectedGroups,
  isHanChar,
  pictureBudget,
  repairStoryPinyin,
  toneMark,
  toneOfSyllable,
  validateParts,
  wantsMeaning,
  wordShape,
} from "../ai/mnemonicFacts";
import { MNEMONIC_LINE_MAX_GRAPHEMES, graphemeLength } from "../vocabulary/mnemonicText";

/**
 * The mnemonic harness (#185): what the app works out itself so the model is not asked to. Tones are a pure function of
 * the pinyin, the word's own pinyin in the story is known, and the line is assembled here, so these are the rules that
 * decide whether a generated mnemonic can be trusted.
 */

describe("tones", () => {
  it("reads the tone from marks, digits and neutral syllables", () => {
    expect(toneOfSyllable("mā")).toBe(1);
    expect(toneOfSyllable("xué")).toBe(2);
    expect(toneOfSyllable("nǚ")).toBe(3);
    expect(toneOfSyllable("lǜ")).toBe(4);
    expect(toneOfSyllable("xue2")).toBe(2);
    expect(toneOfSyllable("ma")).toBe(5);
    expect(toneOfSyllable("r")).toBe(5);
    // a token with no syllable in it (a middle dot) counts as light rather than crashing
    expect(toneOfSyllable("·")).toBe(5);
  });

  it("writes raised digits, with a zero for the neutral tone", () => {
    expect([1, 2, 3, 4, 5].map(toneMark)).toEqual(["¹", "²", "³", "⁴", "⁰"]);
    expect(toneMark(9)).toBe("");
  });
});

describe("wordShape", () => {
  it("aligns one syllable to each character", () => {
    const s = wordShape("图书馆", "tú shū guǎn");
    expect(s.chars).toEqual(["图", "书", "馆"]);
    expect(s.syllables).toEqual(["tú", "shū", "guǎn"]);
    expect(s.tones).toEqual([2, 1, 3]);
    expect(expectedGroups(s)).toBe(3);
    expect(wantsMeaning(s)).toBe(false);
    expect(pictureBudget(s)).toBe(37);
  });

  it("treats erhua with its own syllable as two characters", () => {
    expect(wordShape("玩儿", "wán r").syllables).toEqual(["wán", "r"]);
  });

  it("does not guess when the pinyin does not split one-to-one", () => {
    const s = wordShape("玩儿", "wánr");
    expect(s.syllables).toBeNull();
    expect(expectedGroups(s)).toBe(1);
    expect(wantsMeaning(s)).toBe(true);
    expect(s.tones).toEqual([2]);
  });

  it("copes with missing pinyin and with text that has no Han characters", () => {
    const none = wordShape("学", undefined);
    expect(none.syllables).toBeNull();
    expect(none.tones).toEqual([]);
    const latin = wordShape("ABC", "ei bi si");
    expect(latin.chars).toEqual([]);
    expect(latin.syllables).toBeNull();
    expect(isHanChar("学")).toBe(true);
    expect(isHanChar("a")).toBe(false);
  });

  it("asks for a meaning strip on a single character", () => {
    const s = wordShape("想", "xiǎng");
    expect(wantsMeaning(s)).toBe(true);
    expect(pictureBudget(s)).toBe(39);
  });
});

describe("cleanGroup", () => {
  it("removes Chinese characters, letters and the app's own tone digits, but keeps emoji and keycaps", () => {
    expect(cleanGroup(" 🌳目 ab ¹ ")).toBe("🌳");
    expect(cleanGroup("1️⃣🌳 ⁰")).toBe("1️⃣🌳");
    expect(cleanGroup("↗️🚶‍➡️")).toBe("↗️🚶‍➡️");
  });
});

describe("assembleLine", () => {
  it("puts each tone right after its character's group for a multi-character word", () => {
    const shape = wordShape("图书馆", "tú shū guǎn");
    expect(assembleLine({ characters: ["🗺️", "📖", "🏛️"], meaning: "📚" }, shape)).toBe("🗺️²📖¹🏛️³");
  });

  it("copes with too few groups by leaving the tone in place", () => {
    const shape = wordShape("图书馆", "tú shū guǎn");
    expect(assembleLine({ characters: ["🗺️"], meaning: "" }, shape)).toBe("🗺️²¹³");
  });

  it("writes parts, tone and meaning for a single character", () => {
    expect(assembleLine({ characters: ["❤️"], meaning: " 🤔 " }, wordShape("想", "xiǎng"))).toBe("❤️³🤔");
  });

  it("appends every tone after one group when the pinyin did not split, and tolerates no groups", () => {
    expect(assembleLine({ characters: ["🎮"], meaning: "🎉" }, wordShape("玩儿", "wánr"))).toBe("🎮²🎉");
    expect(assembleLine({ characters: [], meaning: "" }, wordShape("玩儿", "wánr"))).toBe("²");
  });

  it("never exceeds the line limit", () => {
    const line = assembleLine({ characters: ["😀".repeat(60)], meaning: "x" }, wordShape("想", "xiǎng"));
    expect(graphemeLength(line)).toBe(MNEMONIC_LINE_MAX_GRAPHEMES);
  });
});

describe("validateParts", () => {
  const multi = wordShape("图书馆", "tú shū guǎn");
  const single = wordShape("想", "xiǎng");

  it("accepts a good answer", () => {
    expect(validateParts({ characters: ["🗺️", "📖", "🏛️"], meaning: "" }, multi)).toEqual([]);
    expect(validateParts({ characters: ["❤️"], meaning: "🤔 think" }, single)).toEqual([]);
    expect(validateParts({ characters: ["1️⃣🌳"], meaning: "🤔" }, single)).toEqual([]);
  });

  it("reports the wrong number of groups", () => {
    expect(validateParts({ characters: ["🗺️"], meaning: "" }, multi)).toEqual([
      '"characters" must hold exactly 3 picture group(s), one per character; you sent 1.',
    ]);
  });

  it("reports empty groups, Chinese characters and stray letters or digits", () => {
    expect(validateParts({ characters: ["  ", "📖书", "🏛️a"], meaning: "" }, multi)).toEqual([
      "Picture group 1 is empty.",
      "Picture group 2 contains Chinese characters; use emoji only.",
      "Picture group 3 contains letters or digits; use emoji only (the app adds the tone numbers).",
    ]);
  });

  it("checks the meaning strip only where one is wanted", () => {
    expect(validateParts({ characters: ["🗺️", "📖", "🏛️"], meaning: "a long sentence 书" }, multi)).toEqual([]);
    expect(validateParts({ characters: ["❤️"], meaning: "" }, single)).toEqual(['"meaning" is empty.']);
    expect(validateParts({ characters: ["❤️"], meaning: "想" }, single)).toEqual(['"meaning" contains Chinese characters.']);
    expect(validateParts({ characters: ["❤️"], meaning: "a very long meaning here" }, single)).toEqual([
      '"meaning" must be one short emoji strip (at most 14 characters), not a sentence or a list.',
    ]);
    expect(validateParts({ characters: ["❤️"], meaning: "🤔/💭" }, single)).toHaveLength(1);
  });

  it("flags a line that would be over the limit", () => {
    expect(validateParts({ characters: ["😀".repeat(40)], meaning: "🤔" }, single)).toEqual([
      "The finished line is over the 40-character limit; use fewer emoji.",
    ]);
  });
});

describe("repairStoryPinyin", () => {
  const shape = wordShape("图书馆", "tú shū guǎn");

  it("adds, corrects and replaces glosses for the word's own characters and leaves the rest alone", () => {
    const story = "You see 图 (picture), 书 and 馆 (guān), the whole 图书馆 (tú shū guǎn), plus 木 (mù) and 水.";
    expect(repairStoryPinyin(story, shape)).toBe(
      "You see 图 (tú), 书 (shū) and 馆 (guǎn), the whole 图书馆 (tú shū guǎn), plus 木 (mù) and 水."
    );
  });

  it("accepts a correct reading written with a digit and handles a part of the word", () => {
    expect(repairStoryPinyin("书馆 (shu1 guan3)", shape)).toBe("书馆 (shu1 guan3)");
    expect(repairStoryPinyin("书馆 and 馆书", shape)).toBe("书馆 (shū guǎn) and 馆书");
  });

  it("accepts either reading of a repeated character", () => {
    const xie = wordShape("谢谢", "xiè xie");
    expect(repairStoryPinyin("谢 (xiè) then 谢 (xie)", xie)).toBe("谢 (xiè) then 谢 (xie)");
    expect(repairStoryPinyin("谢 (xi)", xie)).toBe("谢 (xiè)");
  });

  it("does nothing when the pinyin did not split", () => {
    expect(repairStoryPinyin("玩儿 here", wordShape("玩儿", "wánr"))).toBe("玩儿 here");
  });
});
