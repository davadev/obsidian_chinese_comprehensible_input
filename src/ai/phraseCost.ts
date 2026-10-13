import { computeOpenAiCostUsd } from "./openaiProfile";

export type PhraseAction = "explain" | "proofread" | "simplify";

/** What the lightbulb tool calls each action: its menu label and the verb in the banner ("tap the last word to …"). */
export const PHRASE_ACTIONS: Record<PhraseAction, { label: string; verb: string }> = {
  explain: { label: "Explain", verb: "explain" },
  proofread: { label: "Proof read", verb: "proof read" },
  simplify: { label: "Simplify", verb: "simplify" },
};

/** The saved choice, or "explain" when the setting holds anything else (a hand-edited or newer-version value). */
export function phraseActionOf(value: unknown): PhraseAction {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PHRASE_ACTIONS, value) ? (value as PhraseAction) : "explain";
}

/**
 * A rough guess at what an action costs on OpenAI before it is started, from the length of the selection. These are not
 * measured token counts: they are sized from the prompts and the shape of the answers, rounded up, so the figure shown in
 * the confirmation errs high. The real cost is shown after the job, from the usage the API reports.
 *
 * Explain makes two calls (the quick check, then the explanation, whose word-by-word list grows with the text);
 * proof read makes one short call; simplify makes one call whose answer holds up to six rewrites of the text.
 */
export function estimatePhraseUsd(action: PhraseAction, chars: number, modelId: string): number {
  const calls =
    action === "explain"
      ? [
          { input: 350 + chars * 2, output: 80 },
          { input: 1200 + chars * 2, output: 600 + chars * 12 },
        ]
      : action === "simplify"
        ? [{ input: 500 + chars * 2, output: 250 + chars * 12 }]
        : [{ input: 450 + chars * 2, output: 120 + chars }];
  const t = calls.reduce(
    (a, c) => ({ inputTokens: a.inputTokens + c.input, cachedInputTokens: 0, outputTokens: a.outputTokens + c.output }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  );
  return computeOpenAiCostUsd(t, modelId);
}
