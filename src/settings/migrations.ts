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

/**
 * Re-key dictionary overrides after the pinyin repair shipped in 0.6.0.
 *
 * Overrides are keyed by `makeKey(simplified, pinyin)` = `简体|numbered-pinyin`.
 * Unlike WordRecords — which `VocabularyStore.dedupeOnLoad()` re-derives from
 * their own stored fields on every load — overrides are a plain map and are
 * never re-derived, so a change in how the numbered half is produced would
 * silently orphan them.
 *
 * Only one thing changed. Before the fix, `toneMarksToNumbers` emitted a
 * neutral tone 5 and *then* the stranded digit for pinyin that CC-CEDICT had
 * left numbered ("nü3" → "nü53"); it now absorbs the digit as the tone
 * ("nü3" → "nü3"). So legacy and current keys differ by exactly one thing:
 * a `5` sitting directly before the real tone digit.
 *
 * That makes this a pure string transform with no dictionary lookup — which
 * matters, because `onload()` runs `vocab.load()` long before the dictionary
 * is read (it loads lazily on first tokenize) and forcing it early would add
 * a ~17 MB read to every startup.
 *
 * Verified against all 125,052 shipped entries: 1,066 legacy keys map
 * correctly and no correct key is touched — a genuine neutral tone is always
 * followed by a space or end-of-string, never by a digit.
 *
 * Idempotent: after one pass no `5` precedes a digit, so re-running is a no-op.
 */
export function migrateOverrideKey(key: string): string {
  return key.replace(/5(?=[1-5])/g, "");
}

/**
 * Apply {@link migrateOverrideKey} across an override map. Returns the same
 * object when nothing needed moving, so the caller can skip a write.
 *
 * If both the legacy and the migrated key are present the migrated one wins:
 * it was written by a build that already had the fix, so it is the more
 * recent of the two.
 */
export function migrateOverrideKeys<T>(
  overrides: Record<string, T>
): { overrides: Record<string, T>; moved: number } {
  const out: Record<string, T> = {};
  // Canonical keys claim their slot first, so a legacy duplicate can never
  // overwrite an override written by a build that already had the fix.
  for (const [key, value] of Object.entries(overrides)) {
    if (migrateOverrideKey(key) === key) out[key] = value;
  }
  let moved = 0;
  for (const [key, value] of Object.entries(overrides)) {
    const next = migrateOverrideKey(key);
    if (next === key) continue;
    moved++;
    if (!(next in out)) out[next] = value;
  }
  return moved === 0 ? { overrides, moved: 0 } : { overrides: out, moved };
}
