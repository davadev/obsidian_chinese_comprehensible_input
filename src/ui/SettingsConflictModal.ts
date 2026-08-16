import { App, Modal, Setting } from "obsidian";
import { liftModal } from "./modalLayer";

export interface SettingsConflict {
  keyPath: string;
  local: unknown;
  remote: unknown;
}

export type ConflictChoice = "local" | "remote";

/**
 * Per-key picker for settings-mirror conflicts. Shown when both sides
 * have touched the same setting and the values differ (and neither side
 * is the install default — defaults yield automatically). Resolves with
 * a map of choices the caller applies. Cancelling keeps everything
 * local.
 */
export class SettingsConflictModal extends Modal {
  private choices = new Map<string, ConflictChoice>();
  constructor(
    app: App,
    private conflicts: SettingsConflict[],
    private onResolve: (choices: Map<string, ConflictChoice>) => void
  ) {
    super(app);
    for (const c of conflicts) this.choices.set(c.keyPath, "remote");
  }

  onOpen() {
    liftModal(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Settings sync conflict" });
    contentEl.createEl("p", {
      text:
        "Both this device and the remote settings file have changes for the keys below. Pick which value to keep for each. Defaults to remote (most recent).",
    });

    const list = contentEl.createDiv({ cls: "cci-conflict-list" });
    for (const c of this.conflicts) {
      const row = list.createDiv({ cls: "cci-conflict-row" });
      row.createDiv({ text: c.keyPath, cls: "cci-conflict-key" });
      const localBtn = row.createEl("button", { text: `Local: ${preview(c.local)}` });
      const remoteBtn = row.createEl("button", { text: `Remote: ${preview(c.remote)}` });
      const refresh = () => {
        const choice = this.choices.get(c.keyPath);
        localBtn.classList.toggle("mod-cta", choice === "local");
        remoteBtn.classList.toggle("mod-cta", choice === "remote");
      };
      refresh();
      localBtn.addEventListener("click", () => {
        this.choices.set(c.keyPath, "local");
        refresh();
      });
      remoteBtn.addEventListener("click", () => {
        this.choices.set(c.keyPath, "remote");
        refresh();
      });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Keep all local").onClick(() => {
          for (const c of this.conflicts) this.choices.set(c.keyPath, "local");
          this.finish();
        })
      )
      .addButton((b) =>
        b.setButtonText("Use all remote").onClick(() => {
          for (const c of this.conflicts) this.choices.set(c.keyPath, "remote");
          this.finish();
        })
      )
      .addButton((b) =>
        b
          .setButtonText("Apply choices")
          .setCta()
          .onClick(() => this.finish())
      );
  }

  private finish() {
    this.onResolve(this.choices);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

function preview(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}
