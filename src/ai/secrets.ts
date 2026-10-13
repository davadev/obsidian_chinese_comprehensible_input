import type { App } from "obsidian";
import type { AiProviderKind, AiSettings } from "../settings/types";

/**
 * API keys live in Obsidian's secret storage (`app.secretStorage`, since 1.11.4), the officially documented place
 * for them. The settings hold only the *name* of the secret (`ai.keySecrets`), so a key never ends up in:
 *   - data.json mirrored across devices via Obsidian Sync / iCloud,
 *   - the settings-mirror file at `Chinese Learning/cci-settings.json`,
 *   - the user-triggered export at `Chinese Learning/cci-settings-export.json`.
 *
 * Releases up to 0.9.1 kept the key in per-vault localStorage instead. That copy is read as a fallback and is moved
 * into the secret storage on load, but it is not deleted: an older version, reinstalled through BRAT, still finds it.
 */

const LEGACY_PREFIX = "cci-ai-apikey-";

const DEFAULT_SECRET_ID: Record<AiProviderKind, string> = {
  openai: "cci-openai-api-key",
  ollama: "cci-ollama-api-key",
};

const PROVIDERS: AiProviderKind[] = ["openai", "ollama"];

type KeyNames = Pick<AiSettings, "keySecrets">;

function legacyKey(app: App, provider: AiProviderKind): string {
  const v: unknown = app.loadLocalStorage(LEGACY_PREFIX + provider);
  return typeof v === "string" ? v : "";
}

/** The provider's API key: the named secret, else the pre-0.9.2 localStorage copy, else "". */
export function loadApiKey(app: App, ai: KeyNames, provider: AiProviderKind): string {
  const name = ai.keySecrets[provider];
  const secret = name ? app.secretStorage.getSecret(name) : null;
  return secret ? secret : legacyKey(app, provider);
}

/** Forget the old localStorage copy; used when the learner clears the key, so the fallback cannot bring it back. */
export function clearLegacyKey(app: App, provider: AiProviderKind): void {
  app.saveLocalStorage(LEGACY_PREFIX + provider, null);
}

/**
 * Put `key` in the secret storage under an id that is free (an existing secret with another value is never
 * overwritten) and remember its name in the settings.
 */
function adoptKey(app: App, ai: KeyNames, provider: AiProviderKind, key: string): void {
  const taken = new Set(app.secretStorage.listSecrets());
  const base = DEFAULT_SECRET_ID[provider];
  let id = base;
  for (let n = 2; taken.has(id) && app.secretStorage.getSecret(id) !== key; n++) id = `${base}-${n}`;
  app.secretStorage.setSecret(id, key);
  ai.keySecrets[provider] = id;
}

/**
 * Move keys that only exist in the old localStorage (or were rescued from an old settings shape) into the secret
 * storage. Returns whether the settings changed and need saving. Providers that already name a secret are left alone.
 */
export function migrateLegacyKeys(
  app: App,
  ai: KeyNames,
  rescued: Partial<Record<AiProviderKind, string>> = {}
): boolean {
  let changed = false;
  for (const provider of PROVIDERS) {
    if (ai.keySecrets[provider]) continue;
    const key = rescued[provider] || legacyKey(app, provider);
    if (!key) continue;
    adoptKey(app, ai, provider, key);
    changed = true;
  }
  return changed;
}
