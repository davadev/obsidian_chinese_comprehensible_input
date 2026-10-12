import { describe, expect, it } from "vitest";
import {
  assembleLine,
  NAME_EMOJI,
  emojiOnly,
  expectedGroups,
  isHanChar,
  pictureBudget,
  repairStoryPinyin,
  toneMark,
  toneOfSyllable,
  validateParts,
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
    expect(pictureBudget(s)).toBe(37);
  });

  it("treats erhua with its own syllable as two characters", () => {
    expect(wordShape("玩儿", "wán r").syllables).toEqual(["wán", "r"]);
  });

  it("does not guess when the pinyin does not split one-to-one", () => {
    const s = wordShape("玩儿", "wánr");
    expect(s.syllables).toBeNull();
    expect(expectedGroups(s)).toBe(1);
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

  it("gives a single character one group and the rest of the budget", () => {
    const s = wordShape("想", "xiǎng");
    expect(expectedGroups(s)).toBe(1);
    expect(pictureBudget(s)).toBe(39);
  });
});

describe("emojiOnly", () => {
  it("keeps emoji, keycaps, flags, arrows and joined sequences, and drops everything else", () => {
    expect(emojiOnly(" 🌳目 ab ¹ ")).toBe("🌳");
    expect(emojiOnly("1️⃣🌳 ⁰")).toBe("1️⃣🌳");
    expect(emojiOnly("↗️🚶‍➡️")).toBe("↗️🚶‍➡️");
    expect(emojiOnly("👩‍👧 👍🏽 🇨🇳 ✅ 〰️ ➡️")).toBe("👩‍👧👍🏽🇨🇳✅〰️➡️");
    expect(emojiOnly("🏴󠁧󠁢󠁥󠁮󠁧󠁿")).toBe("🏴󠁧󠁢󠁥󠁮󠁧󠁿");
  });

  it("drops words, digits, punctuation and Chinese characters", () => {
    expect(emojiOnly("done")).toBe("");
    expect(emojiOnly("🏁 done!")).toBe("🏁");
    expect(emojiOnly("3 + 2 = 🤔，。")).toBe("🤔");
  });
});

describe("assembleLine", () => {
  it("puts each tone right after its character's group for a multi-character word", () => {
    const shape = wordShape("图书馆", "tú shū guǎn");
    expect(assembleLine({ characters: ["🗺️", "📖", "🏛️"] }, shape)).toBe("🗺️²📖¹🏛️³");
  });

  it("copes with too few groups by leaving the tone in place", () => {
    const shape = wordShape("图书馆", "tú shū guǎn");
    expect(assembleLine({ characters: ["🗺️"] }, shape)).toBe("🗺️²¹³");
  });

  it("writes the picture of a single character's meaning, then its tone", () => {
    expect(assembleLine({ characters: ["🤔💭"] }, wordShape("想", "xiǎng"))).toBe("🤔💭³");
  });

  it("appends every tone after one group when the pinyin did not split, and tolerates no groups", () => {
    expect(assembleLine({ characters: ["🎮"] }, wordShape("玩儿", "wánr"))).toBe("🎮²");
    expect(assembleLine({ characters: [] }, wordShape("玩儿", "wánr"))).toBe("²");
  });

  it("writes a name as the badge followed by every tone, whatever else the model sent", () => {
    expect(NAME_EMOJI).toBe("📛");
    expect(assembleLine({ isName: true, characters: ["🐴"] }, wordShape("马克", "mǎ kè"))).toBe("📛³⁴");
    expect(assembleLine({ isName: true, characters: [] }, wordShape("马", "mǎ"))).toBe("📛³");
    expect(assembleLine({ isName: true, characters: [] }, wordShape("马", undefined))).toBe("📛");
  });

  it("keeps words out of the line", () => {
    expect(assembleLine({ characters: ["🏁 done"] }, wordShape("了", "le"))).toBe("🏁⁰");
    expect(assembleLine({ characters: ["✅ x"] }, wordShape("了", "le"))).toBe("✅⁰");
  });

  it("never exceeds the line limit", () => {
    const line = assembleLine({ characters: ["😀".repeat(60)] }, wordShape("想", "xiǎng"));
    expect(graphemeLength(line)).toBe(MNEMONIC_LINE_MAX_GRAPHEMES);
  });
});

describe("validateParts", () => {
  const multi = wordShape("图书馆", "tú shū guǎn");
  const single = wordShape("想", "xiǎng");

  it("accepts a good answer", () => {
    expect(validateParts({ characters: ["🗺️", "📖", "🏛️"] }, multi)).toEqual([]);
    expect(validateParts({ characters: ["🤔💭"] }, single)).toEqual([]);
    expect(validateParts({ characters: ["1️⃣🌳"] }, single)).toEqual([]);
  });

  it("reports the wrong number of groups", () => {
    expect(validateParts({ characters: ["🗺️"] }, multi)).toEqual([
      '"characters" must hold exactly 3 picture group(s), one per character; you sent 1.',
    ]);
  });

  it("reports empty groups and anything that is not emoji", () => {
    const other =
      "contains something other than emoji (no Chinese characters, words, letters, digits or punctuation; the app adds the tone numbers).";
    expect(validateParts({ characters: ["  ", "📖书", "🏛️a"] }, multi)).toEqual([
      "Picture group 1 is empty.",
      `Picture group 2 ${other}`,
      `Picture group 3 ${other}`,
    ]);
    expect(validateParts({ characters: ["🗺️", "📖", "🏛️ library"] }, multi)).toHaveLength(1);
    expect(validateParts({ characters: ["done"] }, single)).toHaveLength(1);
  });

  it("flags a line that would be over the limit", () => {
    expect(validateParts({ characters: ["😀".repeat(40)] }, single)).toEqual([
      "The finished line is over the 40-character limit; use fewer emoji.",
    ]);
  });

  it("asks for nothing more when the word is a name", () => {
    expect(validateParts({ isName: true, characters: [] }, multi)).toEqual([]);
    expect(validateParts({ isName: true, characters: ["x"] }, single)).toEqual([]);
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
