import { describe, expect, it, vi } from "vitest";
import type { AiProviderService } from "../ai/AiProviderService";
import { SimplifyService } from "../ai/SimplifyService";
import { SIMPLIFY_SCHEMA, summarise } from "../ai/simplify";
import { SIMPLIFY_SYSTEM_PROMPT, buildSimplifyUserPrompt, systemPromptWith } from "../ai/prompts";

/** The simplify service (#238): candidates checked, one repair, measured, ranked; a lost answer is never silent. */

const TEXT = "尽管天气恶劣，我们仍然坚持出发。";

/** A stand-in measurer: cost = number of characters, so shorter text is simpler. */
const measure = async (t: string) => summarise(t, Array.from(t).map((c) => ({ surface: c, level: 1, known: false })));

function serviceWith(replies: Array<string | Error>, custom?: () => { extra: string; override: string }) {
  const chatJson = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) chatJson.mockRejectedValueOnce(r);
    else chatJson.mockResolvedValueOnce(r);
  }
  const service = new SimplifyService({ chatJson } as unknown as AiProviderService, measure, () => false, custom);
  return { chatJson, service };
}
const reply = (...texts: string[]) => JSON.stringify({ candidates: texts.map((t) => ({ text: t, change: `note ${t}` })) });

describe("SimplifyService.simplify", () => {
  it("asks once, measures the original and every candidate, and returns the simplest first", async () => {
    const { chatJson, service } = serviceWith([reply("天气不好，我们走了。", "天气不好。")]);
    const out = await service.simplify(TEXT);
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledWith(SIMPLIFY_SYSTEM_PROMPT, buildSimplifyUserPrompt(TEXT), "Simplify", SIMPLIFY_SCHEMA, true);
    expect(out.issues).toEqual([]);
    expect(out.original.text).toBe(TEXT);
    expect(out.ranked.map((c) => c.text)).toEqual(["天气不好。", "天气不好，我们走了。"]);
    expect(out.best).toMatchObject({ text: "天气不好。", change: "note 天气不好。" });
  });

  it("proposes nothing when the model says the text is already simple, or only longer rewrites come back", async () => {
    const none = await serviceWith([JSON.stringify({ candidates: [] })]).service.simplify(TEXT);
    expect(none).toMatchObject({ ranked: [], best: null, issues: [] });
    const longer = await serviceWith([reply(`${TEXT}而且我们很高兴。`)]).service.simplify(TEXT);
    expect(longer.ranked).toHaveLength(1);
    expect(longer.best).toBeNull();
  });

  it("asks once more when a candidate is unusable, and keeps the better answer", async () => {
    const { chatJson, service } = serviceWith([reply(TEXT), reply("天气不好。")]);
    const out = await service.simplify(TEXT);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toContain("is the same as the original");
    expect(out.issues).toEqual([]);
    expect(out.best?.text).toBe("天气不好。");
  });

  it("keeps the first answer and reports what is wrong when the repair is worse, fails or is unreadable", async () => {
    const first = reply("天气不好。", "oops");
    const worse = reply("oops", "also bad", TEXT);
    for (const second of [worse, new Error("429"), "not json"]) {
      const out = await serviceWith([first, second]).service.simplify(TEXT);
      expect(out.issues).toHaveLength(1);
      expect(out.best?.text).toBe("天气不好。"); // the unusable "oops" is left out of the ranking
      expect(out.ranked).toHaveLength(1);
    }
  });

  it("propagates a first answer that cannot be read", async () => {
    await expect(serviceWith(["sorry"]).service.simplify(TEXT)).rejects.toThrow(/for the simplifying/);
  });

  it("sends the learner's own instructions with the built-in prompt", async () => {
    const { chatJson, service } = serviceWith([JSON.stringify({ candidates: [] })], () => ({ extra: "I am HSK 3.", override: "" }));
    await service.simplify(TEXT);
    expect(chatJson.mock.calls[0][0]).toBe(systemPromptWith(SIMPLIFY_SYSTEM_PROMPT, { extra: "I am HSK 3.", override: "" }));
  });
});
