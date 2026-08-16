import { normalizePath } from "obsidian";
import type CciPlugin from "../main";
import { CciSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";
import { applyCustomColors } from "../ui/colorTheme";

export const SETTINGS_EXPORT_DEFAULT_PATH = "Chinese Learning/cci-settings-export.json";

/** Per-section sensitive / device-local keys we never propagate via export
 *  or settings-mirror. API keys live in Obsidian's localStorage (see
 *  `src/ai/secrets.ts`) so they never appear in settings — only the
 *  device-local usage log needs stripping here. The legacy `ollama.apiKey`
 *  field still exists in the type for runtime overlay but is always "" at
 *  rest, so we also drop it defensively in case an older blob set it. */
const FILTER_OUT = {
  ai: ["ollama.apiKey", "usageLog"] as const,
  sync: [
    "mirrorPath",
    "settingsMirrorPath",
    "mirrorEnabled",
    "settingsMirrorEnabled",
  ] as const,
  top: [
    "schemaVersion",
    "dictionarySource",
    "hskColorsDerivedFromAccent",
    "vaultIndexed",
  ] as const,
};

type JsonRecord = Record<string, unknown>;

/** Drop a dotted-path key from a nested record. No-op when any segment is
 *  absent. Mutates the input. */
function deleteDottedPath(obj: unknown, path: string): void {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cursor == null || typeof cursor !== "object") return;
    cursor = (cursor as JsonRecord)[parts[i]];
  }
  if (cursor && typeof cursor === "object") {
    delete (cursor as JsonRecord)[parts[parts.length - 1]];
  }
}

function hasDottedPath(obj: unknown, path: string): boolean {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cursor == null || typeof cursor !== "object") return false;
    cursor = (cursor as JsonRecord)[parts[i]];
  }
  return !!cursor && typeof cursor === "object" && parts[parts.length - 1] in (cursor as JsonRecord);
}

/** Strip sensitive + device-local fields. Returns a fresh object so the
 *  caller can safely JSON.stringify it. */
export function filterSettingsForSharing(s: CciSettings): Partial<CciSettings> {
  const out = JSON.parse(JSON.stringify(s)) as JsonRecord;
  for (const k of FILTER_OUT.top) delete out[k];
  if (out.ai) for (const k of FILTER_OUT.ai) deleteDottedPath(out, `ai.${k}`);
  if (out.sync) for (const k of FILTER_OUT.sync) delete (out.sync as JsonRecord)[k];
  return out;
}

async function ensureFolder(plugin: CciPlugin, filePath: string): Promise<void> {
  const slash = filePath.lastIndexOf("/");
  if (slash <= 0) return;
  const folder = filePath.slice(0, slash);
  if (await plugin.app.vault.adapter.exists(folder)) return;
  await plugin.app.vault.adapter.mkdir(folder);
}

export async function exportSettings(plugin: CciPlugin, path: string): Promise<void> {
  const norm = normalizePath(path);
  await ensureFolder(plugin, norm);
  const filtered = filterSettingsForSharing(plugin.settings);
  const content = JSON.stringify(
    {
      kind: "cci-settings-export",
      exportedAt: new Date().toISOString(),
      settings: filtered,
    },
    null,
    2
  );
  await plugin.app.vault.adapter.write(norm, content);
}

/** Deep-merge `patch` into `into` in place. Arrays are replaced, not merged. */
function deepMerge(into: JsonRecord, patch: JsonRecord): void {
  for (const k of Object.keys(patch ?? {})) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv)) {
      const existing = into[k];
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        into[k] = {};
      }
      deepMerge(into[k] as JsonRecord, pv as JsonRecord);
    } else {
      into[k] = pv;
    }
  }
}

export async function importSettings(
  plugin: CciPlugin,
  path: string
): Promise<{ applied: number; skipped: string[] }> {
  const norm = normalizePath(path);
  if (!(await plugin.app.vault.adapter.exists(norm))) {
    throw new Error(`Settings file not found: ${norm}`);
  }
  const raw = await plugin.app.vault.adapter.read(norm);
  const parsed = JSON.parse(raw) as unknown;
  // Accept either the wrapped export shape {settings: ...} or a bare partial.
  const wrapped =
    parsed && typeof parsed === "object" && "settings" in parsed && typeof (parsed as JsonRecord).settings === "object"
      ? ((parsed as JsonRecord).settings as JsonRecord)
      : (parsed as JsonRecord);
  const incoming: JsonRecord = wrapped ?? {};
  // Apply the sensitive-key filter on the incoming side too, so a hand-
  // edited import file can't slip in credentials or device paths.
  const safe = filterSettingsForSharing(incoming as unknown as CciSettings);
  const skipped: string[] = [];
  for (const k of FILTER_OUT.top) if (k in incoming) skipped.push(k);
  for (const k of FILTER_OUT.ai) if (hasDottedPath(incoming, `ai.${k}`)) skipped.push(`ai.${k}`);
  const incomingSync = incoming.sync;
  if (incomingSync && typeof incomingSync === "object") {
    for (const k of FILTER_OUT.sync) {
      if (k in (incomingSync as JsonRecord)) skipped.push(`sync.${k}`);
    }
  }

  // Start from current settings, deep-merge the safe patch on top.
  const next = JSON.parse(JSON.stringify(plugin.settings)) as JsonRecord;
  deepMerge(next, safe);
  plugin.settings = { ...DEFAULT_SETTINGS, ...(next as Partial<CciSettings>) };
  applyCustomColors(plugin.settings);
  await plugin.saveSettings();
  plugin.refreshChineseViews();
  plugin.refreshStatsViews();
  return { applied: Object.keys(safe).length, skipped };
}
