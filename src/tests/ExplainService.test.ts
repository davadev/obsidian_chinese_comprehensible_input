import { describe, expect, it, vi } from "vitest";
import type { AiProviderService } from "../ai/AiProviderService";
import { EXPLAIN_SCHEMA } from "../ai/explain";
import { ExplainService, __testing, contextFor } from "../ai/ExplainService";
import { EXPLAIN_SYSTEM_PROMPT, buildExplainRepairPrompt, buildExplainUserPrompt } from "../ai/prompts";
import { FULL, clone } from "./explainFixture";

/** The Explain service (#186): one request, a check against what the plugin knows, one repair, never a lost answer. */

const INPUT = {
  surface: "方便",
  pinyin: "fāng biàn",
  traditional: "方便",
  hskLevels: ["3"],
  entries: [{ pinyin: "fāng biàn", definitions: ["convenient"] }],
  chars: [
    { char: "方", pinyin: "fāng", gloss: "square" },
    { char: "便", pinyin: "biàn", gloss: "convenient" },
  ],
  sentence: "住在这里很方便。",
  script: "simplified" as const,
};

function serviceWith(replies: Array<string | Error>) {
  const chatJson = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) chatJson.mockRejectedValueOnce(r);
    else chatJson.mockResolvedValueOnce(r);
  }
  return { chatJson, service: new ExplainService({ chatJson } as unknown as AiProviderService) };
}
const good = () => JSON.stringify(FULL);
const BAD_ISSUE = '"examples" needs 4 to 10 sentences; you sent 0.';
const bad = () => {
  const r = clone(FULL);
  r.examples = [];
  return JSON.stringify(r);
};

describe("ExplainService.generate", () => {
  it("sends the fixed system prompt, the facts and the schema, and returns a valid answer untouched", async () => {
    const { chatJson, service } = serviceWith([good()]);
    const out = await service.generate(INPUT);
    expect(out).toEqual({ result: FULL, issues: [] });
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledWith(EXPLAIN_SYSTEM_PROMPT, buildExplainUserPrompt(INPUT), "Explain", EXPLAIN_SCHEMA);
  });

  it("asks once more with the specific defects and keeps the corrected answer", async () => {
    const { chatJson, service } = serviceWith([bad(), good()]);
    const out = await service.generate(INPUT);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(chatJson.mock.calls[1][1]).toBe(
      `${buildExplainUserPrompt(INPUT)}\n\n${buildExplainRepairPrompt([BAD_ISSUE])}`
    );
    expect(out.result.examples).toHaveLength(4);
    expect(out.issues).toEqual([]);
  });

  it("keeps the first answer and reports what is wrong when the repair is worse, fails, or is unreadable", async () => {
    const worse = clone(FULL);
    worse.examples = [];
    worse.similar = [{ word: "", pinyin: "", difference: "" }];
    for (const second of [JSON.stringify(worse), new Error("rate limited"), "not json"]) {
      const { service } = serviceWith([bad(), second]);
      const out = await service.generate(INPUT);
      expect(out.result.examples).toEqual([]);
      expect(out.issues).toHaveLength(1);
    }
  });

  it("propagates a first answer that cannot be read as an error the dialog can show", async () => {
    await expect(serviceWith(["sorry"]).service.generate(INPUT)).rejects.toThrow(/did not return/);
    await expect(serviceWith(['{"summary": "x}']).service.generate(INPUT)).rejects.toThrow(/Could not parse AI JSON/);
  });
});

describe("contextFor", () => {
  it("accepts the shown and the traditional form, and counts the Han characters", () => {
    expect(contextFor(INPUT)).toEqual({ forms: ["方便"], charCount: 2 });
    expect(contextFor({ ...INPUT, surface: "学习", traditional: "學習" })).toEqual({ forms: ["学习", "學習"], charCount: 2 });
    expect(contextFor({ ...INPUT, surface: "A股", traditional: undefined })).toEqual({ forms: ["A股"], charCount: 1 });
  });
});

describe("parse", () => {
  it("salvages JSON wrapped in prose and code fences", () => {
    const raw = `Here:\n\`\`\`json\n${good()}\n\`\`\`\nDone.`;
    expect(__testing.parse(raw).meaning).toBe(FULL.meaning);
  });
});
