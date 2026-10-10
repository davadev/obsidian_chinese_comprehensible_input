import { App, Modal, Setting } from "obsidian";
import { liftModal } from "./modalLayer";

export type RestoreChoice = "restore" | "keep" | "later";

export interface RestoreBackupInfo {
  /** The newer version the data was last written by. */
  from: string;
  /** The older version that is running now. */
  to: string;
  /** When the backup on offer was taken. */
  backupDate: Date;
  /** Whether this device's sync files are part of the backup, so the sync caveat applies. */
  includesSyncFiles: boolean;
}

/**
 * Shown once per start after the plugin has been taken back to an older release, offering the backup of the data
 * as that older release left it (#149).
 *
 * Esc, a click outside and the close button all mean "Decide later": the safe answer, which changes nothing and asks
 * again next start. Same resolve-once idiom as SettingsConflictModal, whose unresolved dismissal once left a sync dead (#123).
 */
export class RestoreBackupModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private info: RestoreBackupInfo,
    private onResolve: (choice: RestoreChoice) => void
  ) {
    super(app);
  }

  onOpen(): void {
    liftModal(this);
    const { contentEl } = this;
    contentEl.empty();
    const { from, to, backupDate, includesSyncFiles } = this.info;
    contentEl.createEl("h2", { text: "Restore your earlier data?" });
    contentEl.createEl("p", {
      text: `You went back from ${from} to ${to}. Restore your data from before ${from} (${backupDate.toLocaleString()})?`,
    });
    contentEl.createEl("p", {
      text: `Anything you did in ${from}, such as words you marked, will be lost. Your current data is saved first, so you can undo this from Settings → Backups. The change takes effect after you restart Obsidian (or turn this plugin off and on).`,
    });
    if (includesSyncFiles) {
      contentEl.createEl("p", {
        cls: "cci-settings-warn",
        text: "If another device still has newer data and syncs it back, some of it can reappear. Pause sync and restore the same copy there too.",
      });
    }
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Restore").setCta().onClick(() => this.finish("restore")))
      .addButton((b) => b.setButtonText("Keep current data").onClick(() => this.finish("keep")))
      .addButton((b) => b.setButtonText("Decide later").onClick(() => this.finish("later")));
  }

  private finish(choice: RestoreChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.onResolve(choice);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.onResolve("later");
    }
    this.contentEl.empty();
  }
}
