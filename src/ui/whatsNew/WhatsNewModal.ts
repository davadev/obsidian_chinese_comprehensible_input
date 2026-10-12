import { App, Modal } from "obsidian";
import { liftModal } from "../modalLayer";
import type { ReleaseNote } from "./releaseNotes";

/** The "What's new" popup: one section per release note, one button. See `releaseNotes.ts` for when it appears. */
export class WhatsNewModal extends Modal {
  constructor(
    app: App,
    private notes: ReleaseNote[]
  ) {
    super(app);
  }

  onOpen(): void {
    liftModal(this);
    const { contentEl } = this;
    contentEl.addClass("cci-whatsnew-modal");
    this.notes.forEach((note) => {
      contentEl.createEl("h2", { text: note.title });
      contentEl.createEl("p", { cls: "cci-whatsnew-intro", text: note.intro });
      const list = contentEl.createEl("ul", { cls: "cci-whatsnew-list" });
      for (const item of note.items) {
        const li = list.createEl("li");
        li.createEl("strong", { text: item.title });
        li.appendChild(activeDocument.createTextNode(` — ${item.text}`));
      }
    });
    const actions = contentEl.createDiv({ cls: "cci-whatsnew-actions" });
    actions.createEl("button", { text: "Got it", cls: "mod-cta" }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
