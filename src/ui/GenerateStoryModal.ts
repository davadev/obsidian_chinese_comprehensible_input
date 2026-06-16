import { App, Modal, Notice } from "obsidian";
import type CciPlugin from "../main";

export class GenerateStoryModal extends Modal {
  private dueCount: number;
  private lengthChars: number;
  private style: "story" | "article" | "dialogue";
  private targetHsk: string = "auto";
  private includeGlossary: boolean;

  constructor(app: App, private plugin: CciPlugin) {
    super(app);
    this.dueCount = plugin.settings.story.defaultDueCount;
    this.lengthChars = plugin.settings.story.defaultLengthChars;
    this.style = plugin.settings.story.defaultStyle;
    this.includeGlossary = plugin.settings.story.includeGlossary;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Generate Chinese Review Story" });

    if (!this.plugin.settings.ai.enabled) {
      contentEl.createEl("p", { text: "AI is disabled. Enable it in plugin settings first." });
      const close = contentEl.createEl("button", { text: "Close" });
      close.addEventListener("click", () => this.close());
      return;
    }

    this.numberField(contentEl, "Due word count", this.dueCount, (v) => (this.dueCount = v));
    this.numberField(contentEl, "Length (Chinese chars)", this.lengthChars, (v) => (this.lengthChars = v));

    const styleDiv = contentEl.createDiv();
    styleDiv.createEl("label", { text: "Style: " });
    const sel = styleDiv.createEl("select");
    (["story", "article", "dialogue"] as const).forEach((s) => {
      const o = sel.createEl("option", { text: s });
      o.value = s;
    });
    sel.value = this.style;
    sel.addEventListener("change", () => (this.style = sel.value as "story" | "article" | "dialogue"));

    const hskDiv = contentEl.createDiv();
    hskDiv.createEl("label", { text: "Target HSK: " });
    const hskSel = hskDiv.createEl("select");
    for (const v of ["auto", "1", "2", "3", "4", "5", "6"]) {
      const o = hskSel.createEl("option", { text: v });
      o.value = v;
    }
    hskSel.value = this.targetHsk;
    hskSel.addEventListener("change", () => (this.targetHsk = hskSel.value));

    const glossDiv = contentEl.createDiv();
    const glossCb = glossDiv.createEl("input", { type: "checkbox" });
    glossCb.checked = this.includeGlossary;
    glossCb.addEventListener("change", () => (this.includeGlossary = glossCb.checked));
    glossDiv.appendChild(activeDocument.createTextNode(" Include glossary in generated note"));

    const actions = contentEl.createDiv();
    const gen = actions.createEl("button", { text: "Generate" });
    gen.addEventListener("click", async () => {
      gen.setText("Generating…");
      gen.setAttribute("disabled", "true");
      try {
        await this.plugin.story.generateAndSave({
          dueCount: this.dueCount,
          lengthChars: this.lengthChars,
          style: this.style,
          targetHsk: this.targetHsk,
          includeGlossary: this.includeGlossary,
        });
        this.close();
      } catch (e) {
        new Notice("Generation failed: " + (e as Error).message);
        gen.setText("Generate");
        gen.removeAttribute("disabled");
      }
    });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
  }

  private numberField(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void): void {
    const div = parent.createDiv();
    div.createEl("label", { text: `${label}: ` });
    const input = div.createEl("input", { type: "number" });
    input.value = String(value);
    input.addEventListener("change", () => {
      const v = parseInt(input.value, 10);
      if (!Number.isNaN(v)) onChange(v);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
