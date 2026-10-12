import type { AiSettings } from "../settings/types";

/**
 * Is an AI provider actually usable? AI switched on, and for OpenAI a key saved on this device, or for Ollama a server
 * address. It does not test the connection; it only tells a user who has set nothing up to do so before they press an
 * AI action, instead of failing with an HTTP error.
 */
export function aiConfigured(ai: AiSettings, apiKeyFor: (provider: "openai") => string): boolean {
  if (!ai.enabled) return false;
  if (ai.provider === "openai") return apiKeyFor("openai").trim().length > 0;
  return ai.ollama.baseUrl.trim().length > 0;
}
