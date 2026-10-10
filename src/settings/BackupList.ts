import type { BackupEntry, BackupKind } from "../data/backupPolicy";
import { formatBytes } from "../data/backupPolicy";

/**
 * The list of backups in Settings > Backups (#149): when each was taken, which version's data it holds, how big it is,
 * and a Restore button. Plain DOM and a small host interface, so the settings tab supplies the confirmation and the
 * staging, and this file can be tested under a DOM.
 */

export interface BackupListHost {
  /** Newest first. */
  list(): Promise<BackupEntry[]>;
  /** A restore that is queued for the next start, if any. */
  pending(): Promise<BackupEntry | null>;
  /** Confirm with the user, queue the restore, and redraw. */
  onRestore(entry: BackupEntry): Promise<void>;
  /** Withdraw the queued restore and redraw. */
  onCancelPending(): Promise<void>;
}

export const KIND_LABEL: Record<BackupKind, string> = {
  "version-change": "before an update",
  manual: "backed up by hand",
  "pre-restore": "before a restore",
  "downgrade-safety": "before going back a version",
};

/** `unknown` is the label of data written before this feature existed. */
const versionText = (v: string): string => (v === "unknown" ? "an earlier version" : v);

export async function renderBackupList(parent: HTMLElement, host: BackupListHost): Promise<void> {
  parent.empty();
  const [entries, pending] = await Promise.all([host.list(), host.pending()]);

  if (pending) {
    const bar = parent.createDiv({ cls: "cci-backup-pending" });
    bar.createSpan({
      text: `A restore is queued (the backup of ${new Date(pending.createdAt).toLocaleString()}). Restart Obsidian, or turn this plugin off and on, to finish it.`,
    });
    const cancel = bar.createEl("button", { text: "Cancel the restore" });
    cancel.addEventListener("click", () => void host.onCancelPending());
  }

  if (entries.length === 0) {
    parent.createDiv({
      cls: "setting-item-description",
      text: "No backups yet. One is taken the first time the plugin runs after an update, or when you choose Back up now.",
    });
    return;
  }

  const list = parent.createDiv({ cls: "cci-backup-list" });
  for (const e of entries) {
    const row = list.createDiv({ cls: "cci-backup-row" });
    const info = row.createDiv({ cls: "cci-backup-info" });
    info.createSpan({ cls: "cci-backup-date", text: new Date(e.createdAt).toLocaleString() });
    const syncNote = e.includes.some((i) => i !== "data") ? " · with sync files" : "";
    info.createSpan({
      cls: "cci-backup-meta",
      text: `Data from ${versionText(e.fromVersion)} · ${KIND_LABEL[e.kind]} · ${formatBytes(e.storedBytes)}${e.encoding === "gzip" ? "" : " (not compressed)"}${syncNote}`,
    });
    const restore = row.createEl("button", { text: "Restore" });
    restore.addEventListener("click", () => void host.onRestore(e));
  }
}
