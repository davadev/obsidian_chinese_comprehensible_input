import { normalizePath } from "obsidian";
import type CciPlugin from "../main";
import { CciSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";
import { applyCustomColors } from "../ui/colorTheme";
import { filterSettingsForSharing } from "./SettingsIO";
import { deepEqual, flatten, unflatten } from "./settingsMerge";
import {
  SettingsConflict,
  SettingsConflictModal,
} from "../ui/SettingsConflictModal";

interface SettingsMirrorEnvelope {
  schemaVersion: 1;
  updatedAt: string;
  settings: Partial<CciSettings>;
}

const WRITE_DEBOUNCE_MS = 1_500;

async function hashString(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Settings-side companion of VocabularyStore's mirror. Opt-in via
 * settings.sync.settingsMirrorEnabled. Sensitive + device-local fields
 * are filtered out (see SettingsIO.filterSettingsForSharing).
 *
 * Conflict resolution rules:
 *  - If this device hasn't user-touched its settings → take remote
 *    entirely (fresh installs pull, never push defaults).
 *  - Per-key on absorb: if local value matches the install default →
 *    take remote; if remote matches default → take local. Defaults
 *    always yield to a non-default value.
 *  - True conflicts (both touched, both non-default, different) →
 *    open SettingsConflictModal so the user picks per key.
 *  - Modal is suppressed if already open; subsequent absorbs queue
 *    behind it.
 */
export class SettingsMirror {
  private writeTimer: number | null = null;
  private lastWrittenHash: string | null = null;
  private appliedUpdatedAt = "";
  private conflictModalOpen = false;

  constructor(private plugin: CciPlugin) {}

  path(): string | null {
    const s = this.plugin.settings.sync;
    if (!s?.settingsMirrorEnabled) return null;
    return s.settingsMirrorPath || null;
  }

  async bootstrap(): Promise<void> {
    const path = this.path();
    if (!path) return;
    const adapter = this.plugin.app.vault.adapter;
    try {
      const norm = normalizePath(path);
      if (!(await adapter.exists(norm))) return;
      const content = await adapter.read(norm);
      await this.applyEnvelope(content);
    } catch (e) {
      console.error("CCI settings mirror: bootstrap failed", e);
    }
  }

  scheduleWrite(): void {
    if (!this.path()) return;
    if (this.writeTimer != null) window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      this.write().catch((e) => console.error("CCI settings mirror: write failed", e));
    }, WRITE_DEBOUNCE_MS);
  }

  async flushNow(): Promise<void> {
    if (this.writeTimer != null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.write();
  }

  /** Explicit user-initiated push that bypasses the touched gate. Used
   *  by the "Push settings to mirror now" button to unstick users whose
   *  device made changes pre-0.1.95 (touched flag didn't exist yet, so
   *  the file was never written). */
  async forcePushNow(): Promise<void> {
    if (this.writeTimer != null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.write({ force: true });
  }

  async absorbExternalChange(): Promise<boolean> {
    const path = this.path();
    if (!path) return false;
    if (this.conflictModalOpen) return false;
    const adapter = this.plugin.app.vault.adapter;
    try {
      const norm = normalizePath(path);
      if (!(await adapter.exists(norm))) return false;
      const content = await adapter.read(norm);
      const hash = await hashString(content);
      if (hash === this.lastWrittenHash) return false;
      return await this.applyEnvelope(content);
    } catch (e) {
      console.error("CCI settings mirror: absorb failed", e);
      return false;
    }
  }

  private async applyEnvelope(content: string): Promise<boolean> {
    let parsed: SettingsMirrorEnvelope;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.warn("CCI settings mirror: invalid JSON", e);
      return false;
    }
    if (!parsed || typeof parsed !== "object" || !parsed.settings) return false;
    const remoteUpdatedAt = parsed.updatedAt ?? "";
    if (remoteUpdatedAt && remoteUpdatedAt <= this.appliedUpdatedAt) {
      return false;
    }
    const safeRemote = filterSettingsForSharing(parsed.settings as CciSettings);
    const userTouched = await this.plugin.hasUserTouchedSettings();
    if (!userTouched) {
      // Fresh device: pull remote in its entirety. No risk of clobbering
      // anything the user has personally set on this device.
      await this.applyMerge(safeRemote, content, remoteUpdatedAt);
      return true;
    }
    // Both sides have user-touched state. Per-key conflict resolution.
    const filteredLocal = filterSettingsForSharing(this.plugin.settings);
    const defaultFiltered = filterSettingsForSharing(DEFAULT_SETTINGS);
    const localFlat = flatten(filteredLocal);
    const remoteFlat = flatten(safeRemote);
    const defaultFlat = flatten(defaultFiltered);
    const autoPatch: Record<string, unknown> = {};
    const conflicts: SettingsConflict[] = [];
    const remoteKeys = new Set([...Object.keys(localFlat), ...Object.keys(remoteFlat)]);
    for (const k of remoteKeys) {
      const lv = localFlat[k];
      const rv = remoteFlat[k];
      if (deepEqual(lv, rv)) continue;
      const dv = defaultFlat[k];
      if (rv === undefined) continue;
      if (lv === undefined || deepEqual(lv, dv)) {
        autoPatch[k] = rv; // local missing or matches default → take remote
        continue;
      }
      if (deepEqual(rv, dv)) {
        // remote matches default; keep local
        continue;
      }
      conflicts.push({ keyPath: k, local: lv, remote: rv });
    }
    if (conflicts.length === 0) {
      const patch = unflatten(autoPatch);
      await this.applyMerge(patch, content, remoteUpdatedAt);
      return true;
    }
    // True conflicts — surface the modal.
    return await new Promise<boolean>((resolve) => {
      this.conflictModalOpen = true;
      new SettingsConflictModal(this.plugin.app, conflicts, async (choices) => {
        this.conflictModalOpen = false;
        const patch: Record<string, unknown> = { ...autoPatch };
        for (const c of conflicts) {
          if (choices.get(c.keyPath) === "remote") patch[c.keyPath] = c.remote;
        }
        await this.applyMerge(unflatten(patch), content, remoteUpdatedAt);
        resolve(true);
      }).open();
    });
  }

  private async applyMerge(
    patch: Record<string, unknown> | Partial<CciSettings>,
    rawContent: string,
    remoteUpdatedAt: string
  ): Promise<void> {
    const next = JSON.parse(JSON.stringify(this.plugin.settings)) as JsonRecord;
    deepMerge(next, patch as JsonRecord);
    this.plugin.settings = { ...DEFAULT_SETTINGS, ...(next as Partial<CciSettings>) };
    applyCustomColors(this.plugin.settings);
    this.appliedUpdatedAt = remoteUpdatedAt;
    this.lastWrittenHash = await hashString(rawContent);
    await this.plugin.saveSettingsSilently();
    this.plugin.refreshChineseViews();
    this.plugin.refreshStatsViews();
    // Re-render the open settings tab if it's ours, so absorbed values are
    // visible immediately rather than after a manual reopen.
    try {
      const setting = this.plugin.app.setting;
      const active = setting?.activeTab;
      if (active && active.constructor?.name === "CciSettingsTab" && typeof active.display === "function") {
        active.display();
      }
    } catch (e) {
      console.warn("CCI: settings-tab re-render failed", e);
    }
  }

  private async write(opts: { force?: boolean } = {}): Promise<void> {
    const path = this.path();
    if (!path) return;
    // Fresh-install guard: don't push defaults to the mirror file before
    // the user has touched any setting on this device. Bypassed by an
    // explicit user-initiated forcePushNow().
    if (!opts.force && !(await this.plugin.hasUserTouchedSettings())) return;
    const adapter = this.plugin.app.vault.adapter;
    const norm = normalizePath(path);
    await ensureFolder(this.plugin, norm);
    const envelope: SettingsMirrorEnvelope = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      settings: filterSettingsForSharing(this.plugin.settings),
    };
    const content = JSON.stringify(envelope, null, 2);
    this.appliedUpdatedAt = envelope.updatedAt;
    const tmp = `${norm}.tmp`;
    try {
      try {
        await adapter.write(tmp, content);
        if (await adapter.exists(norm)) await adapter.remove(norm);
        await adapter.rename(tmp, norm);
      } catch {
        try {
          if (await adapter.exists(tmp)) await adapter.remove(tmp);
        } catch {
          /* ignore */
        }
        await adapter.write(norm, content);
      }
      this.lastWrittenHash = await hashString(content);
    } catch (e) {
      console.error("CCI settings mirror: write failed", e);
    }
  }
}

type JsonRecord = Record<string, unknown>;

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

async function ensureFolder(plugin: CciPlugin, filePath: string): Promise<void> {
  const slash = filePath.lastIndexOf("/");
  if (slash <= 0) return;
  const folder = filePath.slice(0, slash);
  if (await plugin.app.vault.adapter.exists(folder)) return;
  await plugin.app.vault.adapter.mkdir(folder);
}
