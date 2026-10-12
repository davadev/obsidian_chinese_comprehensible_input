import { computeOpenAiCostUsd } from "./openaiProfile";

export type PhraseAction = "explain" | "proofread";

/**
 * A rough guess at what an action costs on OpenAI before it is started, from the length of the selection. These are not
 * measured token counts: they are sized from the prompts and the shape of the answers, rounded up, so the figure shown in
 * the confirmation errs high. The real cost is shown after the job, from the usage the API reports.
 *
 * Explain makes two calls (the quick check, then the explanation, whose word-by-word list grows with the text);
 * proof read makes one short call.
 */
export function estimatePhraseUsd(action: PhraseAction, chars: number, modelId: string): number {
  const calls =
    action === "explain"
      ? [
          { input: 350 + chars * 2, output: 80 },
          { input: 1200 + chars * 2, output: 600 + chars * 12 },
        ]
      : [{ input: 450 + chars * 2, output: 120 + chars }];
  const t = calls.reduce(
    (a, c) => ({ inputTokens: a.inputTokens + c.input, cachedInputTokens: 0, outputTokens: a.outputTokens + c.output }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  );
  return computeOpenAiCostUsd(t, modelId);
}
