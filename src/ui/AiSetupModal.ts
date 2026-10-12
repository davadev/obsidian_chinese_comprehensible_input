import { App, Modal } from "obsidian";
import { liftModal } from "./modalLayer";

/**
 * Shown when an AI action is pressed before any AI provider is set up. It says what is missing and takes the user to the
 * plugin's settings, rather than failing later with an HTTP error.
 */
export class AiSetupModal extends Modal {
  constructor(
    app: App,
    private pluginId: string,
    private what: string
  ) {
    super(app);
  }

  onOpen(): void {
    liftModal(this);
    const { contentEl } = this;
    contentEl.addClass("cci-aisetup-modal");
    contentEl.createEl("h2", { text: "Set up AI first" });
    contentEl.createEl("p", {
      text: `${this.what} needs an AI provider. Switch AI on in the plugin settings and either add your OpenAI API key or point it at your own Ollama server.`,
    });
    const actions = contentEl.createDiv({ cls: "cci-aisetup-actions" });
    actions.createEl("button", { text: "Not now" }).addEventListener("click", () => this.close());
    actions.createEl("button", { text: "Open settings", cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
      const setting = this.app.setting;
      if (setting) {
        setting.open();
        setting.openTabById(this.pluginId);
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
