import type { AiProviderKind, CciSettings } from "./types";

/**
 * v1 → v2 migration for the AI sub-tree.
 *
 * v1 stored a flat `ai.{baseUrl,apiKey,chatModel,...}` shape tuned for a
 * single (Ollama) provider. v2 splits that into `ai.ollama.*` (power-user
 * config) plus an `ai.provider` selector and an `ai.usageLog` for the
 * OpenAI cost panel. OpenAI's API key lives in localStorage (see
 * `src/ai/secrets.ts`), not in settings.
 *
 * Idempotent: re-running on an already-v2 blob returns it unchanged.
 * Pure: produces a fresh partial settings object the caller can spread.
 * Also returns the legacy v1 apiKey if present, so the caller can rescue
 * it into localStorage one-time without ever persisting it back to the
 * synced settings blob.
 */
export function migrateAiSettingsToV2(
  raw: Partial<CciSettings>
): { migrated: Partial<CciSettings>; rescuedOllamaApiKey: string | null } {
  const ai = (raw.ai ?? {}) as Record<string, unknown>;
  // Already v2 — the `ollama` sub-object only exists in v2 shape.
  if (ai && typeof ai.ollama === "object" && ai.ollama !== null) {
    const ollama = ai.ollama as Record<string, unknown>;
    const stored = typeof ollama.apiKey === "string" ? ollama.apiKey : "";
    // Strip any apiKey that might have been written to settings before
    // the localStorage move — return it for one-time rescue.
    if (stored) {
      const cleaned: Record<string, unknown> = { ...ai, ollama: { ...ollama, apiKey: "" } };
      return {
        migrated: { ...raw, ai: cleaned as unknown as CciSettings["ai"] },
        rescuedOllamaApiKey: stored,
      };
    }
    return { migrated: raw, rescuedOllamaApiKey: null };
  }
  const v1KnownKeys = [
    "baseUrl",
    "chatModel",
    "embeddingModel",
    "endpointMode",
    "temperature",
    "maxOutputTokens",
    "timeoutMs",
    "maxRepairIterations",
    "responseFormat",
    "suppressThinking",
    "stream",
  ];
  const ollama: Record<string, unknown> = { apiKey: "" };
  for (const k of v1KnownKeys) {
    if (k in ai) ollama[k] = ai[k];
  }
  const provider: AiProviderKind = "ollama";
  const nextAi: Record<string, unknown> = {
    enabled: ai.enabled ?? false,
    provider,
    ollama,
    usageLog: [],
    debug: ai.debug ?? false,
  };
  const rescued = typeof ai.apiKey === "string" ? ai.apiKey : "";
  return {
    migrated: { ...raw, ai: nextAi as unknown as CciSettings["ai"] },
    rescuedOllamaApiKey: rescued || null,
  };
}
