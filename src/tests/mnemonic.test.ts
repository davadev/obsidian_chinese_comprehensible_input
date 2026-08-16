import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MNEMONIC_USER_TEMPLATE,
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  buildMnemonicUserPrompt,
} from "../ai/prompts";
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

const { parseMnemonicResult } = __testing;

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
  it("asks for an emoji-first line, a story, and JSON only", () => {
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/emoji/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toContain(String(MNEMONIC_LINE_MAX_GRAPHEMES));
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/story/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/tone/i);
    expect(MNEMONIC_SYSTEM_PROMPT).toMatch(/no markdown code fences/i);
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
  function serviceWith(reply: string, mnemonicPrompt: string) {
    const chatJson = vi.fn().mockResolvedValue(reply);
    const ai = { chatJson } as unknown as AiProviderService;
    const settings = {
      ...DEFAULT_SETTINGS,
      ai: { ...DEFAULT_SETTINGS.ai, mnemonicPrompt },
    } as CciSettings;
    return { chatJson, service: new MnemonicService(ai, () => settings) };
  }

  const input = { surface: "猫", pinyin: "māo", definitions: ["cat"] };

  it("sends the fixed system prompt, the user's template, and the schema", async () => {
    const { chatJson, service } = serviceWith(
      '{"mnemonic":"a flat high cat"}',
      "Make a mnemonic for {word} ({pinyin})."
    );
    const out = await service.generate(input);

    expect(out).toEqual({ mnemonic: "a flat high cat" });
    expect(chatJson).toHaveBeenCalledWith(
      MNEMONIC_SYSTEM_PROMPT,
      "Make a mnemonic for 猫 (māo).",
      "Mnemonic",
      MNEMONIC_SCHEMA
    );
  });

  it("falls back to the default template when the setting was cleared", async () => {
    const { chatJson, service } = serviceWith('{"mnemonic":"hook"}', "");
    await service.generate(input);
    expect(chatJson.mock.calls[0][1]).toBe(
      buildMnemonicUserPrompt(DEFAULT_MNEMONIC_USER_TEMPLATE, input)
    );
  });

  it("propagates a parse failure as an Error the UI can show", async () => {
    const { service } = serviceWith("sorry, no", DEFAULT_MNEMONIC_USER_TEMPLATE);
    await expect(service.generate(input)).rejects.toThrow(/did not return/);
  });
});

describe("parseMnemonicResult", () => {
  it("parses a clean JSON object", () => {
    const out = parseMnemonicResult('{"mnemonic":"hook","story":"a scene"}');
    expect(out).toEqual({ mnemonic: "hook", story: "a scene" });
  });

  it("salvages JSON wrapped in prose and code fences", () => {
    const raw = 'Sure! Here you go:\n```json\n{"mnemonic":"hook"}\n```\nHope that helps.';
    expect(parseMnemonicResult(raw)).toEqual({ mnemonic: "hook" });
  });

  it("omits an empty or absent story", () => {
    expect(parseMnemonicResult('{"mnemonic":"hook","story":"   "}')).toEqual({
      mnemonic: "hook",
    });
    expect(parseMnemonicResult('{"mnemonic":"hook"}').story).toBeUndefined();
  });

  it("clamps runaway output to the emoji-line budget", () => {
    const out = parseMnemonicResult(
      JSON.stringify({ mnemonic: "m".repeat(900), story: "s".repeat(2500) })
    );
    expect(graphemeLength(out.mnemonic)).toBe(MNEMONIC_LINE_MAX_GRAPHEMES);
    expect(out.story).toHaveLength(2000);
  });

  it("never cuts an emoji in half when clamping", () => {
    // 45 astral-plane emoji: a naive slice(0, 40) would land mid-surrogate.
    const out = parseMnemonicResult(JSON.stringify({ mnemonic: "\u{1F600}".repeat(45) }));
    expect(graphemeLength(out.mnemonic)).toBe(MNEMONIC_LINE_MAX_GRAPHEMES);
    expect(out.mnemonic).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(Array.from(out.mnemonic).every((c) => c === "\u{1F600}")).toBe(true);
  });

  it("does not leave a dangling zero-width joiner after a cut", () => {
    // Family emoji are ZWJ sequences; cutting between them must not leave
    // the joiner trailing (it renders as a stray box).
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const out = parseMnemonicResult(JSON.stringify({ mnemonic: family.repeat(50) }));
    expect(out.mnemonic.endsWith("\u200D")).toBe(false);
  });

  it("throws when the mnemonic field is missing, empty, or not a string", () => {
    expect(() => parseMnemonicResult('{"story":"only a story"}')).toThrow(/mnemonic/);
    expect(() => parseMnemonicResult('{"mnemonic":"   "}')).toThrow(/mnemonic/);
    expect(() => parseMnemonicResult('{"mnemonic":42}')).toThrow(/mnemonic/);
  });

  it("throws on responses with no JSON object at all", () => {
    expect(() => parseMnemonicResult("I cannot do that.")).toThrow(/did not return/);
  });

  it("throws a readable error on malformed JSON", () => {
    expect(() => parseMnemonicResult('{"mnemonic": "unterminated}')).toThrow(
      /Could not parse AI JSON/
    );
  });

  it("advertises a schema matching what the parser accepts", () => {
    expect(Object.keys(MNEMONIC_SCHEMA.properties)).toEqual(["mnemonic", "story"]);
    expect(MNEMONIC_SCHEMA.additionalProperties).toBe(false);
  });

  it("keeps the schema valid under json_schema strict mode", () => {
    // strict: true (what buildResponseFormat sends) rejects an
    // additionalProperties:false object with a property missing from
    // `required` — OpenAI and the LiteLLM/vLLM proxies enforce it even
    // though Ollama does not. Every property must be required.
    expect([...MNEMONIC_SCHEMA.required].sort()).toEqual(
      Object.keys(MNEMONIC_SCHEMA.properties).sort()
    );
  });

  it("still accepts a response that omits story, as lenient providers send", () => {
    expect(parseMnemonicResult('{"mnemonic":"📖✏️→🧠"}')).toEqual({ mnemonic: "📖✏️→🧠" });
  });
});
