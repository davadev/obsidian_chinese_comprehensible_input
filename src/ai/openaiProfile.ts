import type { AiOllamaConfig } from "../settings/types";

/**
 * Hardcoded OpenAI profile. Pinned to GPT-5.4 mini because it is the
 * cheapest model strong enough for daily story generation; users on the
 * "just works" path do not pick a model or tweak temperature.
 */

export const OPENAI_MODEL_ID = "gpt-5.4-mini";
export const OPENAI_MODEL_DISPLAY = "GPT-5.4 mini";
export const OPENAI_MODEL_DESC =
  "Our strongest mini model yet for coding, computer use, and subagents.";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** USD per 1,000,000 tokens. */
export const OPENAI_PRICE_PER_1M = {
  input: 0.75,
  cachedInput: 0.075,
  output: 4.5,
} as const;

/**
 * Build an `AiOllamaConfig`-shaped object so `AiProviderService.chatJson`
 * can reuse the existing code path. Only the API key is user-supplied; the
 * rest comes from this profile. Picked values:
 *   - endpointMode "chat" → OpenAI's /v1/chat/completions
 *   - temperature 0.2 → low randomness; story prompts already steer style
 *   - stream true + responseFormat "json_object" → matches Ollama defaults
 *     and lets the SSE-keepalive path handle slow first-byte under VPN
 */
export function buildOpenAiActiveConfig(apiKey: string): AiOllamaConfig {
  return {
    baseUrl: OPENAI_BASE_URL,
    apiKey,
    chatModel: OPENAI_MODEL_ID,
    embeddingModel: "",
    endpointMode: "chat",
    temperature: 0.2,
    maxOutputTokens: 8000,
    timeoutMs: 300000,
    maxRepairIterations: 4,
    responseFormat: "json_object",
    suppressThinking: false,
    stream: true,
  };
}

export interface AiUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Cost in USD for a token-bucket sum. Cached input is billed at 10× discount. */
export function computeOpenAiCostUsd(t: AiUsageTotals): number {
  return (
    (t.inputTokens * OPENAI_PRICE_PER_1M.input +
      t.cachedInputTokens * OPENAI_PRICE_PER_1M.cachedInput +
      t.outputTokens * OPENAI_PRICE_PER_1M.output) /
    1_000_000
  );
}
