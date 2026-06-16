import type { App } from "obsidian";
import type { AiProviderKind } from "../settings/types";

/**
 * API keys live in Obsidian's per-vault localStorage rather than the
 * synced settings blob, so they never end up in:
 *   - data.json mirrored across devices via Obsidian Sync / iCloud,
 *   - the settings-mirror file at `Chinese Learning/cci-settings.json`,
 *   - the user-triggered export at `Chinese Learning/cci-settings-export.json`.
 *
 * Obsidian doesn't expose a cryptographic safe-storage API, but
 * `app.loadLocalStorage` / `app.saveLocalStorage` are the documented
 * per-vault, device-local mechanism — same channel community plugins
 * like Smart Connections use for their provider keys. The value is
 * stored as plaintext in the OS-level localStorage; treat it as
 * device-bound but not at-rest encrypted.
 */

const KEY_PREFIX = "cci-ai-apikey-";

export function loadApiKey(app: App, provider: AiProviderKind): string {
  const v = app.loadLocalStorage(KEY_PREFIX + provider);
  return typeof v === "string" ? v : "";
}

export function saveApiKey(app: App, provider: AiProviderKind, key: string): void {
  app.saveLocalStorage(KEY_PREFIX + provider, key && key.length > 0 ? key : null);
}
