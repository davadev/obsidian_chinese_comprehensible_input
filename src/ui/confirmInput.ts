import { App, Modal, Setting } from "obsidian";
import { liftModal } from "./modalLayer";

/**
 * Obsidian-Modal-backed replacement for native `confirm()`. Native confirm
 * is disabled inside Obsidian on iOS and discouraged by the community-plugin
 * lint, so destructive prompts route through this helper instead.
 *
 * Resolves `true` if the user clicked the destructive primary action,
 * `false` if they cancelled (or dismissed the modal any other way).
 */
export function confirmAsync(app: App, message: string, confirmLabel = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(app);
    liftModal(modal);
    modal.contentEl.createEl("p", { text: message });
    new Setting(modal.contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          answered = true;
          resolve(false);
          modal.close();
        })
      )
      .addButton((b) => {
        b
          .setButtonText(confirmLabel)
          .onClick(() => {
            answered = true;
            resolve(true);
            modal.close();
          });
        b.buttonEl.addClass("mod-warning");
      });
    modal.onClose = () => {
      if (!answered) resolve(false);
    };
    modal.open();
  });
}
