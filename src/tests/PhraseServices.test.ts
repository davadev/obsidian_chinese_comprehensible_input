import { describe, expect, it, vi } from "vitest";
import type { AiProviderService } from "../ai/AiProviderService";
import { PhraseExplainService } from "../ai/PhraseExplainService";
import { ProofreadService } from "../ai/ProofreadService";
import { PHRASE_CHECK_SCHEMA, PHRASE_SCHEMA } from "../ai/phrase";
import { PROOFREAD_SCHEMA } from "../ai/proofread";
import {
  PHRASE_CHECK_SYSTEM_PROMPT,
  systemPromptWith,
  PHRASE_SYSTEM_PROMPT,
  PROOFREAD_SYSTEM_PROMPT,
  buildExplainRepairPrompt,
  buildPhraseCheckUserPrompt,
  buildPhraseUserPrompt,
  buildProofreadUserPrompt,
} from "../ai/prompts";

/** The phrase services (#186): the quick check, the explanation, the proofreader: one repair, never a lost answer. */

const TEXT = "我打算明年去北京。";
const GOOD = {
  translation: "I plan to go to Beijing next year.",
  expresses: "A plan.",
  register: "neutral",
  structure: "S + 打算 + T + 去 + P",
  breakdown: [
    { text: "我", pinyin: "wǒ", role: "subject", meaning: "I" },
    { text: "打算", pinyin: "dǎ suàn", role: "verb of intention", meaning: "plan" },
    { text: "明年", pinyin: "míng nián", role: "time word", meaning: "next year" },
    { text: "去", pinyin: "qù", role: "verb", meaning: "go" },
    { text: "北京", pinyin: "Běi jīng", role: "place", meaning: "Beijing" },
  ],
  grammarPoints: [{ point: "打算 + V", explanation: "Intention.", example: "" }],
  typo: "",
  notes: [],
};
const BAD = { ...GOOD, breakdown: GOOD.breakdown.slice(0, 3) };

function serviceWith<T>(make: (ai: AiProviderService) => T, replies: Array<string | Error>) {
  const chatJson = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) chatJson.mockRejectedValueOnce(r);
    else chatJson.mockResolvedValueOnce(r);
  }
  return { chatJson, service: make({ chatJson } as unknown as AiProviderService) };
}

describe("PhraseExplainService.check", () => {
  it("sends the small check prompt and returns the verdict", async () => {
    const { chatJson, service } = serviceWith((ai) => new PhraseExplainService(ai), [JSON.stringify({ verdict: "typo", note: "n", original: "午", suggestion: "年" })]);
    expect(await service.check(TEXT)).toEqual({ verdict: "typo", note: "n", original: "午", suggestion: "年" });
    expect(chatJson).toHaveBeenCalledWith(PHRASE_CHECK_SYSTEM_PROMPT, buildPhraseCheckUserPrompt(TEXT), "PhraseCheck", PHRASE_CHECK_SCHEMA);
  });

  it("lets a reply that cannot be read surface as an error the dialog can show", async () => {
    await expect(serviceWith((ai) => new PhraseExplainService(ai), ["sorry"]).service.check(TEXT)).rejects.toThrow(/did not return a JSON object for the phrase check/);
  });
});

describe("PhraseExplainService.explain", () => {
  it("returns a valid explanation untouched, and passes a typo along", async () => {
    const { chatJson, service } = serviceWith((ai) => new PhraseExplainService(ai), [JSON.stringify(GOOD)]);
    const out = await service.explain(TEXT, "午 should be 年");
    expect(out.issues).toEqual([]);
    expect(out.result.translation).toBe(GOOD.translation);
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledWith(PHRASE_SYSTEM_PROMPT, buildPhraseUserPrompt({ text: TEXT, typo: "午 should be 年" }), "PhraseExplain", PHRASE_SCHEMA);
  });

  it("asks once more with the specific defect when a word was left out, and keeps the corrected answer", async () => {
    const { chatJson, service } = serviceWith((ai) => new PhraseExplainService(ai), [JSON.stringify(BAD), JSON.stringify(GOOD)]);
    const out = await service.explain(TEXT);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toContain(buildExplainRepairPrompt([expect.any(String)]).split("\n")[0]);
    expect(chatJson.mock.calls[1][1]).toContain("must cover the whole text exactly");
    expect(out.issues).toEqual([]);
    expect(out.result.breakdown).toHaveLength(5);
  });

  it("keeps the first answer and reports what is wrong when the repair is worse, fails or is unreadable", async () => {
    const worse = { ...BAD, breakdown: [], translation: "" };
    for (const second of [JSON.stringify(worse), new Error("rate limited"), "not json"]) {
      const { service } = serviceWith((ai) => new PhraseExplainService(ai), [JSON.stringify(BAD), second]);
      const out = await service.explain(TEXT);
      expect(out.result.breakdown).toHaveLength(3);
      expect(out.issues).toHaveLength(1);
    }
  });

  it("propagates a first answer that cannot be read", async () => {
    await expect(serviceWith((ai) => new PhraseExplainService(ai), ["sorry"]).service.explain(TEXT)).rejects.toThrow(/for the explanation/);
  });
});

describe("the learner's own prompt instructions", () => {
  it("reach the phrase explanation and the proof read, but not the quick check", async () => {
    const custom = () => ({ extra: "I am HSK 3.", override: "" });
    const phrase = serviceWith((ai) => new PhraseExplainService(ai, custom), [JSON.stringify({ verdict: "ok", note: "", original: "", suggestion: "" }), JSON.stringify(GOOD)]);
    await phrase.service.check(TEXT);
    await phrase.service.explain(TEXT);
    expect(phrase.chatJson.mock.calls[0][0]).toBe(PHRASE_CHECK_SYSTEM_PROMPT);
    expect(phrase.chatJson.mock.calls[1][0]).toBe(systemPromptWith(PHRASE_SYSTEM_PROMPT, { extra: "I am HSK 3.", override: "" }));
    const proof = serviceWith((ai) => new ProofreadService(ai, custom), [JSON.stringify({ corrections: [] })]);
    await proof.service.proofread(TEXT);
    expect(proof.chatJson.mock.calls[0][0]).toBe(systemPromptWith(PROOFREAD_SYSTEM_PROMPT, { extra: "I am HSK 3.", override: "" }));
  });
});

describe("ProofreadService", () => {
  const one = { corrections: [{ original: "明年去", replacement: "明年要去", why: "Needs 要." }] };

  it("returns valid corrections untouched, and an empty list for correct text", async () => {
    const { chatJson, service } = serviceWith((ai) => new ProofreadService(ai), [JSON.stringify(one)]);
    expect((await service.proofread(TEXT)).result.corrections).toHaveLength(1);
    expect(chatJson).toHaveBeenCalledWith(PROOFREAD_SYSTEM_PROMPT, buildProofreadUserPrompt(TEXT), "Proofread", PROOFREAD_SCHEMA);
    const none = serviceWith((ai) => new ProofreadService(ai), [JSON.stringify({ corrections: [] })]);
    expect(await none.service.proofread(TEXT)).toEqual({ result: { corrections: [] }, issues: [] });
  });

  it("asks once more when a span is not in the text, and keeps the corrected answer", async () => {
    const wrong = { corrections: [{ original: "后年去", replacement: "后年要去", why: "x" }] };
    const { chatJson, service } = serviceWith((ai) => new ProofreadService(ai), [JSON.stringify(wrong), JSON.stringify(one)]);
    const out = await service.proofread(TEXT);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toContain('"后年去" is not in it');
    expect(out.issues).toEqual([]);
    expect(out.result.corrections[0].original).toBe("明年去");
  });

  it("keeps the first answer and says what is wrong when the repair is worse, fails or is unreadable", async () => {
    const wrong = { corrections: [{ original: "后年去", replacement: "x", why: "y" }] };
    const worse = { corrections: [{ original: "后年去", replacement: "后年去", why: "" }, { original: "还有", replacement: "x", why: "" }] };
    for (const second of [JSON.stringify(worse), new Error("429"), "not json"]) {
      const { service } = serviceWith((ai) => new ProofreadService(ai), [JSON.stringify(wrong), second]);
      const out = await service.proofread(TEXT);
      expect(out.result.corrections[0].original).toBe("后年去");
      expect(out.issues).toHaveLength(1);
    }
  });

  it("propagates a first answer that cannot be read", async () => {
    await expect(serviceWith((ai) => new ProofreadService(ai), ["sorry"]).service.proofread(TEXT)).rejects.toThrow(/for the proofreading/);
  });
});

describe("the phrase prompts", () => {
  it("ask for the big picture, every word in order, and the grammatical role, and say not to define words one by one", () => {
    expect(PHRASE_SYSTEM_PROMPT).toMatch(/Do NOT simply define each word as a dictionary would/);
    expect(PHRASE_SYSTEM_PROMPT).toMatch(/EVERY word of the text, in order, each exactly once/);
    expect(PHRASE_SYSTEM_PROMPT).toMatch(/grammatical job in this sentence/);
    expect(PHRASE_SYSTEM_PROMPT).toMatch(/even a mistyped character/);
    expect(PHRASE_SYSTEM_PROMPT).toMatch(/do not dwell on it/);
  });

  it("make the check lenient about style and strict only about broken grammar", () => {
    expect(PHRASE_CHECK_SYSTEM_PROMPT).toMatch(/Be lenient/);
    expect(PHRASE_CHECK_SYSTEM_PROMPT).toMatch(/would teach the learner something false/);
  });

  it("make the proofreader find real mistakes only, with the smallest fix, copied exactly", () => {
    expect(PROOFREAD_SYSTEM_PROMPT).toMatch(/REAL mistakes only/);
    expect(PROOFREAD_SYSTEM_PROMPT).toMatch(/Do not restyle/);
    expect(PROOFREAD_SYSTEM_PROMPT).toMatch(/copied EXACTLY from the text/);
    expect(PROOFREAD_SYSTEM_PROMPT).toMatch(/at most 5/);
  });

  it("build the user prompts, with and without a typo", () => {
    expect(buildPhraseCheckUserPrompt("你好")).toBe("Text:\n你好\n\nCheck it. Reply with JSON only.");
    expect(buildPhraseUserPrompt({ text: "你好" })).toBe("Text to explain:\n你好\n\nWrite the explanation now. Reply with JSON only.");
    expect(buildPhraseUserPrompt({ text: "你好", typo: " 午→年 " })).toContain('The text has a typo (午→年). Explain the words as written, mention the typo in "typo"');
    expect(buildPhraseUserPrompt({ text: "你好", typo: "  " })).not.toContain("typo (");
    expect(buildProofreadUserPrompt("你好")).toBe("Text to proofread:\n你好\n\nReply with JSON only.");
  });
});
