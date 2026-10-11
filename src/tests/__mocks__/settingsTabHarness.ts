import { vi } from "vitest";
import { Setting } from "obsidian";
import { CciSettingsTab } from "../../settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../../settings/defaults";

/**
 * The settings tab on a plain-object plugin, for tests that run under happy-dom. `walk` visits every definition the tab
 * returns (groups, pages and items, at any depth), which is how the tests reach the per-item callbacks (`visible`,
 * `disabled`, `action`, `render`) without a real Obsidian settings page.
 */

export interface Def {
  type?: string;
  name?: string;
  heading?: string;
  desc?: unknown;
  searchable?: boolean;
  visible?: boolean | (() => boolean);
  disabled?: boolean | (() => boolean);
  action?: (el: HTMLElement, index: number) => unknown;
  render?: (setting: Setting) => void;
  items?: Def[];
  control?: { type: string; key: string; options?: Record<string, string>; min?: number; max?: number; step?: number; disabled?: boolean | (() => boolean); placeholder?: string };
}

export function makeSettingsTab(over: { settings?: (s: any) => void; plugin?: Record<string, unknown> } = {}) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  over.settings?.(settings);
  const storage = new Map<string, string>();
  const files = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p)),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, t: string) => void files.set(p, t)),
    mkdir: vi.fn(async () => {}),
    remove: vi.fn(async (p: string) => void files.delete(p)),
  };
  const plugin: any = {
    settings,
    app: {
      name: "app",
      vault: { configDir: ".obsidian", adapter },
      loadLocalStorage: vi.fn((k: string) => storage.get(k) ?? null),
      saveLocalStorage: vi.fn((k: string, v: string | null) => void (v === null ? storage.delete(k) : storage.set(k, v))),
      setting: undefined,
    },
    saveSettings: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    refreshChineseViewAppearance: vi.fn(),
    forceRetokenizeViews: vi.fn(),
    refreshSyncMirror: vi.fn(async () => {}),
    startSyncMirrorPoller: vi.fn(),
    offerReindexAfterScriptChange: vi.fn(),
    openStatsView: vi.fn(async () => {}),
    backupNow: vi.fn(async () => {}),
    register: vi.fn(),
    settingsMirror: { bootstrap: vi.fn(async () => {}), forcePushNow: vi.fn(async () => {}), forcePullNow: vi.fn(async () => true) },
    vocab: {
      clearSurfaceCache: vi.fn(),
      resetAll: vi.fn(async () => {}),
      reloadMirror: vi.fn(async () => {}),
      importJson: vi.fn(async () => ({ added: 1, updated: 2 })),
      exportJson: vi.fn(async () => "{json}"),
      exportCsv: vi.fn(async () => "csv"),
    },
    tokenizer: { invalidate: vi.fn() },
    dictionary: { reload: vi.fn(async () => {}) },
    dictDownloader: { getStatus: vi.fn(() => ({ phase: "idle" })), run: vi.fn(async () => {}), onStatus: vi.fn(() => () => {}) },
    backups: {
      list: vi.fn(async () => []),
      pendingRestore: vi.fn(async () => null),
      stageRestore: vi.fn(async () => ({ ok: true, message: "queued" })),
      cancelRestore: vi.fn(async () => {}),
      deleteBackup: vi.fn(async () => ({ ok: true, message: "Backup deleted." })),
    },
    ai: { testConnection: vi.fn(async () => true) },
    ...over.plugin,
  };
  const tab = new CciSettingsTab(plugin.app, plugin) as any;
  return { tab: tab as CciSettingsTab & Record<string, any>, plugin, storage, files, adapter };
}

export function walk(items: Def[], visit: (d: Def, path: string[]) => void, path: string[] = []): void {
  for (const d of items) {
    visit(d, path);
    if (d.items) walk(d.items, visit, [...path, d.heading ?? d.name ?? ""]);
  }
}

export function all(tab: { getSettingDefinitions(): unknown[] }): Def[] {
  const out: Def[] = [];
  walk(tab.getSettingDefinitions() as Def[], (d) => out.push(d));
  return out;
}

export const byName = (tab: { getSettingDefinitions(): unknown[] }, name: string): Def => {
  const hit = all(tab).find((d) => d.name === name);
  if (!hit) throw new Error(`no setting named "${name}"`);
  return hit;
};

/** Render a definition's custom block into a real element, as Obsidian would. */
export function renderDef(d: Def): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const setting = new Setting(host);
  d.render!(setting);
  return setting.settingEl;
}

export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
