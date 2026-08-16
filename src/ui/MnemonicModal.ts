import { App, Modal, Notice } from "obsidian";
import type CciPlugin from "../main";
import type { MnemonicInput, MnemonicResult } from "../ai/MnemonicService";
import type { WordRecord } from "../vocabulary/VocabularyTypes";

/**
 * Preview-then-accept flow for AI-generated mnemonics (#49).
 *
 * Deliberately NOT write-on-arrival like the "Enhance" dictionary action:
 * a mnemonic is a personal memory hook the user may have written by hand,
 * so the generated text is shown first and only `Accept` persists it.
 * `Regenerate` re-runs the same prompt in place — mnemonic quality is
 * hit-or-miss by nature, and rerolling is the main interaction.
 */
export class MnemonicModal extends Modal {
  private result: MnemonicResult | null = null;
  private busy = false;
  private error: string | null = null;
  /** Bumps on every generate so a slow in-flight response from a previous
   *  attempt can't overwrite a newer one (or a closed modal). */
  private runId = 0;
  private readonly surface: string;
  private readonly existing: string;

  constructor(
    app: App,
    private plugin: CciPlugin,
    private rec: WordRecord,
    private sentence: string
  ) {
    super(app);
    this.surface = rec.surfaces[0];
    this.existing = rec.mnemonic?.text ?? "";
  }

  onOpen(): void {
    // The word popup and the mobile bottom sheet use hardcoded z-indexes
    // that sit above Obsidian's --layer-modal, so lift our own modal
    // container above them. The caller also closes the popup; this is the
    // belt to that pair of braces (and covers the toolbar overflow menu).
    this.containerEl.addClass("cci-modal-front");
    this.render();
    void this.generate();
  }

  onClose(): void {
    // Invalidate any in-flight request so its .then() is a no-op.
    this.runId++;
    this.contentEl.empty();
  }

  private input(): MnemonicInput {
    const dict = this.plugin.dictionary.lookup(this.surface)[0];
    return {
      surface: this.surface,
      pinyin: dict?.pinyin ?? this.rec.pinyin,
      traditional: dict?.traditional ?? this.rec.traditional,
      definitions: dict?.definitions ?? this.rec.definitions ?? [],
      sentence: this.sentence,
      hskLevels: this.rec.hsk?.levels ?? [],
      existing: this.existing,
    };
  }

  private async generate(): Promise<void> {
    const run = ++this.runId;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const result = await this.plugin.mnemonic.generate(this.input());
      if (run !== this.runId) return;
      this.result = result;
    } catch (err) {
      if (run !== this.runId) return;
      this.error = (err as Error).message;
    } finally {
      if (run === this.runId) {
        this.busy = false;
        this.render();
      }
    }
  }

  private accept(): void {
    if (!this.result) return;
    this.plugin.vocab.updateMnemonic(this.surface, {
      text: this.result.mnemonic,
      story: this.result.story,
    });
    new Notice("Mnemonic saved.");
    this.close();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cci-mnemonic-modal");

    const dict = this.plugin.dictionary.lookup(this.surface)[0];
    const pinyin = dict?.pinyin ?? this.rec.pinyin ?? "";
    contentEl.createEl("h2", {
      text: pinyin ? `${this.surface} (${pinyin})` : this.surface,
    });

    if (this.existing) {
      const prev = contentEl.createDiv({ cls: "cci-mnemonic-existing" });
      prev.createDiv({
        cls: "cci-mnemonic-label",
        text: "Current mnemonic — Accept replaces it",
      });
      prev.createDiv({ text: this.existing });
    }

    if (this.busy) {
      contentEl.createDiv({ cls: "cci-mnemonic-status", text: "Generating…" });
    } else if (this.error) {
      contentEl.createDiv({
        cls: "cci-mnemonic-status cci-mnemonic-error",
        text: `Mnemonic failed: ${this.error}`,
      });
    } else if (this.result) {
      const body = contentEl.createDiv({ cls: "cci-mnemonic-result" });
      body.createDiv({ cls: "cci-mnemonic-text", text: `🧠 ${this.result.mnemonic}` });
      if (this.result.story) {
        body.createDiv({ cls: "cci-mnemonic-label", text: "Story" });
        body.createDiv({ cls: "cci-mnemonic-story", text: this.result.story });
      }
    }

    const actions = contentEl.createDiv({ cls: "cci-mnemonic-actions" });
    const accept = actions.createEl("button", { text: "Accept", cls: "mod-cta" });
    accept.disabled = this.busy || !this.result;
    accept.addEventListener("click", () => this.accept());

    const regen = actions.createEl("button", {
      text: this.error ? "Retry" : "Regenerate",
    });
    regen.disabled = this.busy;
    regen.addEventListener("click", () => void this.generate());

    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
  }
}
