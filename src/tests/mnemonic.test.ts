import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MNEMONIC_USER_TEMPLATE,
  LEGACY_MNEMONIC_USER_TEMPLATE,
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
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
    expect(MNEMONIC_SYSTEM_PROMPT).toContain('{"characters":[string],"meaning":string,"story":string}');
  });

  it("leaves the tones to the app and forbids Chinese characters and digits in the groups", () => {
    // Tones are a pure function of the pinyin; the app attaches them, so the model must not write them.
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/never write tones/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/no Chinese characters, no letters, no digits/);
  });

  it("asks for the word's own pinyin in the story and none for parts", () => {
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/tone-marked pinyin in parentheses right after each of the word's own characters/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/Do not give pinyin for parts/);
  });
});

describe("mnemonic facts block and repair prompt", () => {
  it("lists each character with its tone number and gloss, and the budget", () => {
    const shape = wordShape("图书馆", "tú shū guǎn");
    const block = buildMnemonicFactsBlock(shape, ["diagram", "book", ""]);
    expect(block).toContain("1. 图 tú — tone number ² — means: diagram");
    expect(block).toContain("2. 书 shū — tone number ¹ — means: book");
    expect(block).toContain("3. 馆 guǎn — tone number ³\n");
    expect(block).toContain("Budget for all groups + meaning together: 37 characters. Return exactly 3 string(s)");
    expect(block).toContain('Return "" for "meaning".');
  });

  it("asks for the meaning strip on a single character and ignores glosses there", () => {
    const block = buildMnemonicFactsBlock(wordShape("想", "xiǎng"), ["think"]);
    expect(block).toContain("1. 想 xiǎng — tone number ³");
    expect(block).not.toContain("means:");
    expect(block).toContain('Return exactly 1 string(s) in "characters". Also fill "meaning".');
  });

  it("treats a word whose pinyin does not split as one group", () => {
    const block = buildMnemonicFactsBlock(wordShape("玩儿", "wán"), undefined);
    expect(block).toContain("does not split one syllable per character");
    expect(block).toContain('Return exactly 1 string(s)');
  });

  it("lists the defects in the repair prompt", () => {
    expect(buildMnemonicRepairPrompt(["a", "b"])).toBe(
      "Your last answer broke these rules:\n- a\n- b\nReply again with corrected JSON only, keeping what was already good."
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
  const reply = (o: object) => JSON.stringify(o);

  it("sends the fixed system prompt, the user's template plus the facts, and the schema", async () => {
    const { chatJson, service } = serviceWith(
      [reply({ characters: ["🐱"], meaning: "🐾", story: "You see 猫 (māo) purr." })],
      "Make a mnemonic for {word} ({pinyin})."
    );
    const out = await service.generate(single);

    expect(out).toEqual({ mnemonic: "🐱¹🐾", story: "You see 猫 (māo) purr." });
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledWith(
      MNEMONIC_SYSTEM_PROMPT,
      `Make a mnemonic for 猫 (māo).\n\n${buildMnemonicFactsBlock(wordShape("猫", "māo"))}`,
      "Mnemonic",
      MNEMONIC_SCHEMA
    );
  });

  it("falls back to the default template when the setting was cleared", async () => {
    const { chatJson, service } = serviceWith([reply({ characters: ["🐱"], meaning: "🐾", story: "" })], "");
    await service.generate(single);
    expect(chatJson.mock.calls[0][1]).toBe(
      `${buildMnemonicUserPrompt(DEFAULT_MNEMONIC_USER_TEMPLATE, single)}\n\n${buildMnemonicFactsBlock(wordShape("猫", "māo"))}`
    );
  });

  it("puts each tone number right after its own character's group and drops the meaning strip", async () => {
    const { chatJson, service } = serviceWith(
      [reply({ characters: ["🗺️", "📖", "🏛️"], meaning: "📚🏛️", story: "A 图书馆 and 馆 (guān)." })],
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
        reply({ characters: ["🗺️图", "📖", "🏛️"], meaning: "", story: "x" }),
        reply({ characters: ["🗺️", "📖", "🏛️"], meaning: "", story: "y" }),
      ],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate(multi);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toContain("Picture group 1 contains Chinese characters");
    expect(out).toEqual({ mnemonic: "🗺️²📖¹🏛️³", story: "y" });
  });

  it("keeps the first answer when the repair is worse, and reports what is still wrong", async () => {
    const { service } = serviceWith(
      [
        reply({ characters: ["🗺️图", "📖", "🏛️"], meaning: "", story: "x" }),
        reply({ characters: ["🗺️图", "📖书", "🏛️"], meaning: "", story: "y" }),
      ],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate(multi);
    expect(out.story).toBe("x");
    // the Chinese character never reaches the line even though the model sent it
    expect(out.mnemonic).toBe("🗺️²📖¹🏛️³");
    expect(out.notes).toEqual(["Picture group 1 contains Chinese characters; use emoji only."]);
  });

  it("keeps the first answer when the repair call fails or is unreadable", async () => {
    for (const second of [new Error("rate limited"), "not json at all"]) {
      const { service } = serviceWith(
        [reply({ characters: ["🗺️", "📖"], meaning: "", story: "x" }), second],
        DEFAULT_MNEMONIC_USER_TEMPLATE
      );
      const out = await service.generate(multi);
      expect(out.mnemonic).toBe("🗺️²📖¹³");
      expect(out.notes).toEqual([expect.stringContaining("exactly 3 picture group(s)")]);
    }
  });

  it("writes one group plus every tone for a word whose pinyin does not split", async () => {
    const { service } = serviceWith(
      [reply({ characters: ["🎮👶"], meaning: "🎉", story: "x" })],
      DEFAULT_MNEMONIC_USER_TEMPLATE
    );
    const out = await service.generate({ surface: "玩儿", pinyin: "wánr" });
    expect(out.mnemonic).toBe("🎮👶²🎉");
  });

  it("omits an empty story and clamps a runaway one", async () => {
    const empty = serviceWith([reply({ characters: ["🐱"], meaning: "🐾", story: "   " })], DEFAULT_MNEMONIC_USER_TEMPLATE);
    expect((await empty.service.generate(single)).story).toBeUndefined();
    const long = serviceWith([reply({ characters: ["🐱"], meaning: "🐾", story: "s".repeat(2500) })], DEFAULT_MNEMONIC_USER_TEMPLATE);
    expect((await long.service.generate(single)).story).toHaveLength(2000);
  });

  it("propagates a parse failure of the first answer as an Error the UI can show", async () => {
    const { service } = serviceWith(["sorry, no"], DEFAULT_MNEMONIC_USER_TEMPLATE);
    await expect(service.generate(single)).rejects.toThrow(/did not return/);
  });
});

describe("parseMnemonicAnswer", () => {
  it("parses a clean JSON object", () => {
    expect(parseMnemonicAnswer('{"characters":["a"],"meaning":"m","story":"s"}')).toEqual({
      characters: ["a"],
      meaning: "m",
      story: "s",
    });
  });

  it("salvages JSON wrapped in prose and code fences", () => {
    const raw = 'Sure! Here you go:\n```json\n{"characters":["a"]}\n```\nHope that helps.';
    expect(parseMnemonicAnswer(raw)).toEqual({ characters: ["a"], meaning: "", story: "" });
  });

  it("treats a missing or non-string meaning and story as empty", () => {
    expect(parseMnemonicAnswer('{"characters":[],"meaning":3,"story":null}')).toEqual({ characters: [], meaning: "", story: "" });
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
    expect(Object.keys(MNEMONIC_SCHEMA.properties)).toEqual(["characters", "meaning", "story"]);
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
