import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MNEMONIC_USER_TEMPLATE,
  LEGACY_MNEMONIC_USER_TEMPLATE,
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  EXPLAIN_SYSTEM_PROMPT,
  buildExplainRepairPrompt,
  buildExplainUserPrompt,
  buildMnemonicFactsBlock,
  buildMnemonicRepairPrompt,
  buildMnemonicUserPrompt,
} from "../ai/prompts";
import { wordShape } from "../ai/mnemonicFacts";
import type { AiProviderService } from "../ai/AiProviderService";
import { MnemonicService, __testing } from "../ai/MnemonicService";
import {
  MNEMONIC_LINE_MAX_GRAPHEMES,
  clampGraphemes,
  graphemeLength,
  isOverMnemonicLine,
} from "../vocabulary/mnemonicText";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";

const { parseMnemonicAnswer } = __testing;

describe("buildMnemonicUserPrompt", () => {
  const full = {
    surface: "学习",
    pinyin: "xué xí",
    traditional: "學習",
    definitions: ["to study", "to learn"],
    sentence: "我每天学习中文。",
    hskLevels: ["1"],
    existing: "old hook",
    existingStory: "old story",
  };

  it("substitutes every supported placeholder", () => {
    const tpl =
      "{word}|{pinyin}|{traditional}|{definitions}|{sentence}|{hsk}|{existing}|{existingStory}";
    expect(buildMnemonicUserPrompt(tpl, full)).toBe(
      "学习|xué xí|學習|to study; to learn|我每天学习中文。|1|old hook|old story"
    );
  });

  it("falls back to readable placeholders when fields are missing", () => {
    const tpl = "{pinyin}|{definitions}|{sentence}|{hsk}|{existing}|{existingStory}";
    expect(buildMnemonicUserPrompt(tpl, { surface: "囧" })).toBe(
      "(unknown)|(none)|(none)|(not in HSK lists)|(none yet)|(none yet)"
    );
  });

  it("reports traditional as (same) when it matches the surface", () => {
    expect(
      buildMnemonicUserPrompt("{traditional}", { surface: "学", traditional: "学" })
    ).toBe("(same)");
  });

  it("uses the built-in template when the user's template is blank", () => {
    const out = buildMnemonicUserPrompt("   \n ", full);
    expect(out).toBe(buildMnemonicUserPrompt(DEFAULT_MNEMONIC_USER_TEMPLATE, full));
    expect(out).toContain("学习");
    expect(out).not.toContain("{word}");
  });

  it("leaves unknown placeholders verbatim", () => {
    expect(buildMnemonicUserPrompt("{word} {foo}", full)).toBe("学习 {foo}");
  });

  it("ships a default template exercising the documented placeholders", () => {
    for (const key of [
      "word",
      "pinyin",
      "traditional",
      "definitions",
      "sentence",
      "hsk",
      "existing",
      "existingStory",
    ]) {
      expect(DEFAULT_MNEMONIC_USER_TEMPLATE).toContain(`{${key}}`);
    }
    expect(DEFAULT_SETTINGS.ai.mnemonicPrompt).toBe(DEFAULT_MNEMONIC_USER_TEMPLATE);
  });
});

describe("MNEMONIC_SYSTEM_PROMPT", () => {
  it("asks for picture groups, a story, and JSON only", () => {
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/picture group/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/story/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/no markdown code fences/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toContain('{"isName":boolean,"characters":[string],"story":string}');
  });

  it("leaves the tones to the app and forbids Chinese characters and digits in the groups", () => {
    // Tones are a pure function of the pinyin; the app attaches them, so the model must not write them.
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/never write tones/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/no Chinese characters, no English words, no letters, no digits/);
  });

  it("pictures the meaning of each character, single ones included, and says what to use for an abstract sense", () => {
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/a picture of what that character MEANS in this word/);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/For a single character, picture its meaning; do not draw its strokes or parts/);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/symbol emoji, for example ✅ completed/);
    expect(MNEMONIC_SYSTEM_PROMPT).not.toMatch(/"meaning"/);
  });

  it("tells the model to flag a name and leave the picture to the app", () => {
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/"isName" — true only when, in the sentence/);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/the app writes a name badge itself/);
  });

  it("asks for the word's own pinyin in the story and none for anything else", () => {
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/tone-marked pinyin in parentheses right after each of the word's own characters/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/Do not give pinyin for anything else/);
  });
});

describe("mnemonic facts block and repair prompt", () => {
  it("lists each character with its tone number and gloss, and the budget", () => {
    const shape = wordShape("图书馆", "tú shū guǎn");
    const block = buildMnemonicFactsBlock(shape, ["diagram", "book", ""]);
    expect(block).toContain("1. 图 tú — tone number ² — means: diagram");
    expect(block).toContain("2. 书 shū — tone number ¹ — means: book");
    expect(block).toContain("3. 馆 guǎn — tone number ³\n");
    expect(block).toContain('Budget for all groups together: 37 characters. Return exactly 3 string(s) in "characters".');
  });

  it("asks for one group for a single character and ignores glosses there", () => {
    const block = buildMnemonicFactsBlock(wordShape("想", "xiǎng"), ["think"]);
    expect(block).toContain("1. 想 xiǎng — tone number ³");
    expect(block).not.toContain("means:");
    expect(block).toContain('Return exactly 1 string(s) in "characters".');
    expect(block).not.toContain("meaning");
  });

  it("treats a word whose pinyin does not split as one group", () => {
    const block = buildMnemonicFactsBlock(wordShape("玩儿", "wán"), undefined);
    expect(block).toContain("does not split one syllable per character");
    expect(block).toContain('Return exactly 1 string(s)');
  });

  it("lists the defects in the repair prompt", () => {
    expect(buildMnemonicRepairPrompt(["a", "b"])).toBe(
      "Your last answer broke these rules:\n- a\n- b\nReply again with corrected JSON only, keeping what was already good. Where a Chinese character, an English word or a letter crept into a picture group, replace it with an emoji or leave it out."
    );
  });

  it("keeps the previous default recognisable so it can be migrated", () => {
    expect(LEGACY_MNEMONIC_USER_TEMPLATE).toContain("encode the tone of each syllable");
    expect(DEFAULT_MNEMONIC_USER_TEMPLATE).not.toContain("encode the tone");
    expect(LEGACY_MNEMONIC_USER_TEMPLATE).not.toBe(DEFAULT_MNEMONIC_USER_TEMPLATE);
  });
});

describe("mnemonic line length helpers", () => {
  it("counts a ZWJ emoji sequence as one grapheme where Intl.Segmenter exists", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    // Node 18+ ships Intl.Segmenter; guard so the suite still passes if not.
    const expected = typeof Intl.Segmenter === "function" ? 1 : 5;
    expect(graphemeLength(family)).toBe(expected);
  });

  it("returns short strings untouched", () => {
    expect(clampGraphemes("📖✏️→🧠")).toBe("📖✏️→🧠");
    expect(isOverMnemonicLine("📖✏️→🧠")).toBe(false);
  });

  it("flags prose as over the line budget", () => {
    expect(
      isOverMnemonicLine(
        "A child under a roof practises the same stroke again and again until it sticks."
      )
    ).toBe(true);
  });
});

describe("MnemonicService.generate", () => {
  function serviceWith(replies: Array<string | Error>, mnemonicPrompt: string) {
    const chatJson = vi.fn();
    for (const r of replies) {
      if (r instanceof Error) chatJson.mockRejectedValueOnce(r);
      else chatJson.mockResolvedValueOnce(r);
    }
    const ai = { chatJson } as unknown as AiProviderService;
    const settings = {
      ...DEFAULT_SETTINGS,
      ai: { ...DEFAULT_SETTINGS.ai, mnemonicPrompt },
    } as CciSettings;
    return { chatJson, service: new MnemonicService(ai, () => settings) };
  }

  const single = { surface: "猫", pinyin: "māo", definitions: ["cat"] };
  const multi = { surface: "图书馆", pinyin: "tú shū guǎn", definitions: ["library"], charGlosses: ["diagram", "book", "building"] };
  const reply = (o: object) => JSON.stringify({ isName: false, ...o });

  it("sends the fixed system prompt, the user's template plus the facts, and the schema", async () => {
    const { chatJson, service } = serviceWith(
      [reply({ characters: ["🐱"], story: "You see 猫 (māo) purr." })],
      "Make a mnemonic for {word} ({pinyin})."
    );
    const out = await service.generate(single);

    expect(out).toEqual({ mnemonic: "🐱¹", story: "You see 猫 (māo) purr." });
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledWith(
      MNEMONIC_SYSTEM_PROMPT,
      `Make a mnemonic for 猫 (māo).\n\n${buildMnemonicFactsBlock(wordShape("猫", "māo"))}`,
      "Mnemonic",
      MNEMONIC_SCHEMA,
      true
    );
  });

  it("falls back to the default template when the setting was cleared", async () => {
    const { chatJson, service } = serviceWith([reply({ characters: ["🐱"], story: "" })], "");
    await service.generate(single);
    expect(chatJson.mock.calls[0][1]).toBe(
      `${buildMnemonicUserPrompt(DEFAULT_MNEMONIC_USER_TEMPLATE, single)}\n\n${buildMnemonicFactsBlock(wordShape("猫", "māo"))}`
    );
  });

  it("puts each tone number right after its own character's group, with no separate meaning strip", async () => {
    const { chatJson, service } = serviceWith(
      [reply({ characters: ["🗺️", "📖", "🏛️"], story: "A 图书馆 and 馆 (guān)." })],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate(multi);
    expect(out.mnemonic).toBe("🗺️²📖¹🏛️³");
    // the app writes the word's own pinyin itself: missing on the word, wrong on 馆
    expect(out.story).toBe("A 图书馆 (tú shū guǎn) and 馆 (guǎn).");
    expect(out.notes).toBeUndefined();
    expect(chatJson.mock.calls[0][1]).toContain("1. 图 tú — tone number ² — means: diagram");
  });

  it("asks once more when a rule is broken and uses the corrected answer", async () => {
    const { chatJson, service } = serviceWith(
      [
        reply({ characters: ["🗺️图", "📖", "🏛️"], story: "x" }),
        reply({ characters: ["🗺️", "📖", "🏛️"], story: "y" }),
      ],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate(multi);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toContain("Picture group 1 contains something other than emoji");
    expect(out).toEqual({ mnemonic: "🗺️²📖¹🏛️³", story: "y" });
  });

  it("keeps the first answer when the repair is worse, and reports what is still wrong", async () => {
    const { service } = serviceWith(
      [
        reply({ characters: ["🗺️图", "📖", "🏛️"], story: "x" }),
        reply({ characters: ["🗺️图", "📖书", "🏛️"], story: "y" }),
      ],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate(multi);
    expect(out.story).toBe("x");
    // the Chinese character never reaches the line even though the model sent it
    expect(out.mnemonic).toBe("🗺️²📖¹🏛️³");
    expect(out.notes).toEqual([expect.stringContaining("Picture group 1 contains something other than emoji")]);
  });

  it("keeps the first answer when the repair call fails or is unreadable", async () => {
    for (const second of [new Error("rate limited"), "not json at all"]) {
      const { service } = serviceWith(
        [reply({ characters: ["🗺️", "📖"], story: "x" }), second],
        DEFAULT_MNEMONIC_USER_TEMPLATE
      );
      const out = await service.generate(multi);
      expect(out.mnemonic).toBe("🗺️²📖¹³");
      expect(out.notes).toEqual([expect.stringContaining("exactly 3 picture group(s)")]);
    }
  });

  it("writes the name badge and the tones itself when the model says the word is a name", async () => {
    const { chatJson, service } = serviceWith(
      [reply({ isName: true, characters: [], story: "Here 马 (mǎ) is part of a name." })],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate({ surface: "马克", pinyin: "mǎ kè", sentence: "马克来了。" });
    expect(out).toEqual({ mnemonic: "📛³⁴", story: "Here 马 (mǎ) is part of a name." });
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("says plainly that it is a name when the model gave no sentence", async () => {
    const { service } = serviceWith([reply({ isName: true, characters: [], story: "" })], DEFAULT_MNEMONIC_USER_TEMPLATE);
    expect((await service.generate({ surface: "马克", pinyin: "mǎ kè" })).story).toBe("马克 (mǎ kè) is a name here.");
    const odd = serviceWith([reply({ isName: true, characters: [], story: "" })], DEFAULT_MNEMONIC_USER_TEMPLATE);
    expect((await odd.service.generate({ surface: "马克", pinyin: "mǎ" })).story).toBe("马克 is a name here.");
  });

  it("asks again when a group is a word, and never lets the word reach the line", async () => {
    const { chatJson, service } = serviceWith(
      [reply({ characters: ["🏁 done"], story: "x" }), reply({ characters: ["🏁 done"], story: "x" })],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate({ surface: "了", pinyin: "le" });
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toContain("Picture group 1 contains something other than emoji");
    expect(out.mnemonic).toBe("🏁⁰");
    expect(out.notes).toEqual([expect.stringContaining("something other than emoji")]);
    const fixed = serviceWith(
      [reply({ characters: ["🏁 done"], story: "x" }), reply({ characters: ["✅"], story: "x" })],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    expect((await fixed.service.generate({ surface: "了", pinyin: "le" })).mnemonic).toBe("✅⁰");
  });

  it("writes one group plus every tone for a word whose pinyin does not split", async () => {
    const { service } = serviceWith(
      [reply({ characters: ["🎮👶"], story: "x" })],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate({ surface: "玩儿", pinyin: "wánr" });
    expect(out.mnemonic).toBe("🎮👶²");
  });

  it("omits an empty story and clamps a runaway one", async () => {
    const empty = serviceWith([reply({ characters: ["🐱"], story: "   " })], DEFAULT_MNEMONIC_USER_TEMPLATE);
    expect((await empty.service.generate(single)).story).toBeUndefined();
    const long = serviceWith([reply({ characters: ["🐱"], story: "s".repeat(2500) })], DEFAULT_MNEMONIC_USER_TEMPLATE);
    expect((await long.service.generate(single)).story).toHaveLength(2000);
  });

  it("propagates a parse failure of the first answer as an Error the UI can show", async () => {
    const { service } = serviceWith(["sorry, no"], DEFAULT_MNEMONIC_USER_TEMPLATE);
    await expect(service.generate(single)).rejects.toThrow(/did not return/);
  });
});

describe("parseMnemonicAnswer", () => {
  it("parses a clean JSON object", () => {
    expect(parseMnemonicAnswer('{"isName":false,"characters":["a"],"story":"s"}')).toEqual({
      isName: false,
      characters: ["a"],
      story: "s",
    });
  });

  it("salvages JSON wrapped in prose and code fences", () => {
    const raw = 'Sure! Here you go:\n```json\n{"characters":["a"]}\n```\nHope that helps.';
    expect(parseMnemonicAnswer(raw)).toEqual({ isName: false, characters: ["a"], story: "" });
  });

  it("treats a missing or non-string story as empty, and ignores a meaning an older prompt would have sent", () => {
    expect(parseMnemonicAnswer('{"characters":[],"meaning":"x","story":null}')).toEqual({ isName: false, characters: [], story: "" });
  });

  it("reads the name flag only when it is exactly true", () => {
    expect(parseMnemonicAnswer('{"isName":true,"characters":[]}').isName).toBe(true);
    expect(parseMnemonicAnswer('{"isName":"true","characters":[]}').isName).toBe(false);
    expect(parseMnemonicAnswer('{"characters":[]}').isName).toBe(false);
  });

  it("throws when the characters list is missing or not a list of strings", () => {
    expect(() => parseMnemonicAnswer('{"story":"only a story"}')).toThrow(/"characters"/);
    expect(() => parseMnemonicAnswer('{"characters":"a"}')).toThrow(/"characters"/);
    expect(() => parseMnemonicAnswer('{"characters":["a",2]}')).toThrow(/"characters"/);
  });

  it("throws on responses with no JSON object at all", () => {
    expect(() => parseMnemonicAnswer("I cannot do that.")).toThrow(/did not return/);
  });

  it("throws a readable error on malformed JSON", () => {
    expect(() => parseMnemonicAnswer('{"characters": ["unterminated}')).toThrow(/Could not parse AI JSON/);
  });

  it("advertises a schema matching what the parser accepts", () => {
    expect(Object.keys(MNEMONIC_SCHEMA.properties)).toEqual(["isName", "characters", "story"]);
    expect(MNEMONIC_SCHEMA.additionalProperties).toBe(false);
  });

  it("keeps the schema valid under json_schema strict mode", () => {
    // strict: true (what buildResponseFormat sends) rejects an
    // additionalProperties:false object with a property missing from
    // `required` — OpenAI and the LiteLLM/vLLM proxies enforce it even
    // though Ollama does not. Every property must be required.
    expect([...MNEMONIC_SCHEMA.required].sort()).toEqual(Object.keys(MNEMONIC_SCHEMA.properties).sort());
  });
});

describe("graphemes on a runtime without Intl.Segmenter", () => {
  it("falls back to code points, and still counts them", async () => {
    vi.resetModules();
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      const fresh = await import("../vocabulary/mnemonicText");
      expect(fresh.graphemes("你好a")).toEqual(["你", "好", "a"]);
      expect(fresh.graphemeLength("你好a")).toBe(3);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe("Explain prompts", () => {
  const args = {
    surface: "方便",
    pinyin: "fāng biàn",
    traditional: "方便",
    hskLevels: ["3"],
    entries: [
      { pinyin: "fāng biàn", definitions: ["convenient", " ", "to make things easy"] },
      { pinyin: "fāng bian", definitions: [] },
    ],
    chars: [
      { char: "方", pinyin: "fāng", gloss: "square" },
      { char: "便", pinyin: "biàn", gloss: "" },
    ],
    sentence: "  住在这里很方便。 ",
    script: "traditional" as const,
  };

  it("hands the model the facts the plugin has, in a fixed order", () => {
    const out = buildExplainUserPrompt(args);
    expect(out).toContain("Word: 方便\nPinyin: fāng biàn\nTraditional: (same)\nLevel: HSK 3\n");
    expect(out).toContain("Traditional characters as used in Taiwan");
    expect(out).toContain("1. fāng biàn — convenient; to make things easy\n2. fāng bian — (no definition)");
    expect(out).toContain("1. 方 fāng — square\n2. 便 biàn\n");
    expect(out).toContain("(use it to pick the sense they need, but cover the other senses too): 住在这里很方便。");
    expect(out.endsWith("Write the note now. Reply with JSON only.")).toBe(true);
  });

  it("copes with a word that is not in the dictionary, has no sentence and no HSK level", () => {
    const out = buildExplainUserPrompt({ ...args, pinyin: "", traditional: "方便書", hskLevels: [], entries: [], sentence: undefined, script: "simplified" });
    expect(out).toContain("Pinyin: (unknown)");
    expect(out).toContain("Traditional: 方便書");
    expect(out).toContain("Level: not in the HSK lists");
    expect(out).toContain("(none: the word is not in the dictionary)");
    expect(out).not.toContain("The learner met the word");
    expect(buildExplainUserPrompt({ ...args, sentence: "   " })).not.toContain("The learner met the word");
  });

  it("lists the defects in the repair prompt", () => {
    expect(buildExplainRepairPrompt(["a", "b"])).toBe(
      "Your last answer broke these rules:\n- a\n- b\nReply again with the complete corrected JSON only, keeping what was already good and using exactly the field names and nesting from the instructions."
    );
  });

  it("asks for every section the issue promises, no invented breakdown or etymology, and JSON only", () => {
    for (const field of ["summary", "whenYouNeedIt", "senses", "grammar", "collocations", "examples", "pitfalls", "similar", "characters", "notes"]) {
      expect(EXPLAIN_SYSTEM_PROMPT).toContain(`"${field}"`);
    }
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/DIFFERENT contexts and registers/);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/Do not write the radical, how the character is built or where it comes from/);
    expect(EXPLAIN_SYSTEM_PROMPT).not.toMatch(/etymology|decomposition|confidence/i);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/Build each one only from something you have already put in this note/);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/\"similar-word\".*\"pattern\".*\"english-habit\".*\"register\"/);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/an empty list is better than a weak pitfall/);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/cover every common reading/);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/no Markdown/);
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/No markdown code fences/);
  });
});
