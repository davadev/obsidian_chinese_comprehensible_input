import type { AiOllamaConfig } from "../settings/types";

/**
 * Hardcoded OpenAI profiles. Users on the "just works" path do not pick a model or tweak temperature; the one choice
 * they get is between the current model and the previous one, in case the new one reads worse for them.
 *
 * Two entries only: `default` is what everyone gets, `legacy` is the previous default kept as a fallback. Each carries
 * its own price and its own request quirks, so choosing `legacy` sends exactly the request it always did.
 * `scripts/check-openai-model.mjs` reads the ids below to watch for shutdowns, so keep them as plain string literals.
 */

export type OpenAiModelChoice = "default" | "legacy";

export const OPENAI_MODEL_ID = "gpt-6-luna";
export const OPENAI_LEGACY_MODEL_ID = "gpt-5.4-mini";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface OpenAiModelProfile {
  id: string;
  display: string;
  desc: string;
  /** USD per 1,000,000 tokens. */
  price: { input: number; cachedInput: number; output: number };
  /**
   * Extra fields for the chat-completions body. GPT-6 is a reasoning family: with effort unset it rejects
   * `temperature` (HTTP 400) and reasons before answering, which is slower and several times dearer. "none" keeps
   * `temperature` legal and behaves like the non-reasoning model it replaces (verified with scripts/model-eval.mjs).
   */
  extraBody: Record<string, unknown>;
}

export const OPENAI_MODELS: Record<OpenAiModelChoice, OpenAiModelProfile> = {
  default: {
    id: OPENAI_MODEL_ID,
    display: "GPT-6 luna",
    desc: "The efficient tier of OpenAI's newest family: about 9× cheaper than the previous default. In side-by-side tests its graded stories were comparable; switch back if yours read worse.",
    price: { input: 0.1, cachedInput: 0.01, output: 0.5 },
    extraBody: { reasoning_effort: "none" },
  },
  legacy: {
    id: OPENAI_LEGACY_MODEL_ID,
    display: "GPT-5.4 mini (previous)",
    desc: "Our strongest mini model of the previous generation. Costs about 7× more; pick it if the default's text reads worse for you.",
    price: { input: 0.75, cachedInput: 0.075, output: 4.5 },
    extraBody: {},
  },
};

/** Persisted settings can hold anything; anything that is not "legacy" is the default. */
export function resolveOpenAiChoice(choice: unknown): OpenAiModelChoice {
  return choice === "legacy" ? "legacy" : "default";
}

/** Extra body fields for a model id; empty for an id we do not know (e.g. a hand-edited value). */
export function openAiExtraBody(modelId: string): Record<string, unknown> {
  for (const p of Object.values(OPENAI_MODELS)) if (p.id === modelId) return p.extraBody;
  return {};
}

/**
 * Build an `AiOllamaConfig`-shaped object so `AiProviderService.chatJson`
 * can reuse the existing code path. Only the API key is user-supplied; the
 * rest comes from this profile. Picked values:
 *   - endpointMode "chat" → OpenAI's /v1/chat/completions
 *   - temperature 0.2 → low randomness; story prompts already steer style
 *   - stream true + responseFormat "json_object" → matches Ollama defaults
 *     and lets the SSE-keepalive path handle slow first-byte under VPN
 */
export function buildOpenAiActiveConfig(apiKey: string, choice: unknown = "default"): AiOllamaConfig {
  return {
    baseUrl: OPENAI_BASE_URL,
    apiKey,
    chatModel: OPENAI_MODELS[resolveOpenAiChoice(choice)].id,
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

/**
 * Price table for a usage entry's model. Entries logged before the model was recorded were all billed at the
 * previous default's price, so an absent or unknown id falls back to `legacy`.
 */
export function priceForModel(modelId: string | undefined): OpenAiModelProfile["price"] {
  for (const p of Object.values(OPENAI_MODELS)) if (p.id === modelId) return p.price;
  return OPENAI_MODELS.legacy.price;
}

/** Cost in USD for a token-bucket sum at one model's price (no id = the previous default). Cached input is billed at 10× discount. */
export function computeOpenAiCostUsd(t: AiUsageTotals, modelId?: string): number {
  const price = priceForModel(modelId);
  return (
    (t.inputTokens * price.input + t.cachedInputTokens * price.cachedInput + t.outputTokens * price.output) / 1_000_000
  );
}
