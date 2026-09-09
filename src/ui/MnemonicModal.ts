import { App, Modal, Notice } from "obsidian";
import { displayPinyin } from "../dictionary/displayForms";
import type CciPlugin from "../main";
import type { MnemonicInput } from "../ai/MnemonicService";
import type { WordRecord } from "../vocabulary/VocabularyTypes";
import {
  MNEMONIC_LINE_MAX_GRAPHEMES,
  clampGraphemes,
  graphemeLength,
} from "../vocabulary/mnemonicText";
import { liftModal } from "./modalLayer";

/**
 * The one place a mnemonic is read, written, or generated (#49).
 *
 * A mnemonic has two halves: a short emoji line (`mnemonic.text`) that is
 * shown on the word card — and is the candidate for a third annotation
 * line in a future release, hence the length cap — and the story
 * (`mnemonic.story`) that unpacks it.
 *
 * Both are plain editable fields. "Generate with AI" fills them in place
 * rather than replacing them behind a preview, so the user can reroll,
 * hand-edit the model's output, or ignore the AI entirely. Nothing is
 * persisted until Save, so Cancel is always a clean escape.
 */
export class MnemonicModal extends Modal {
  private busy = false;
  /** Bumps on every generate so a slow in-flight response from a previous
   *  attempt can't overwrite newer text (or a closed modal). */
  private runId = 0;
  private readonly surface: string;
  private lineInput!: HTMLInputElement;
  private storyInput!: HTMLTextAreaElement;
  private counterEl!: HTMLElement;
  private generateBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private plugin: CciPlugin,
    private rec: WordRecord,
    private sentence: string
  ) {
    super(app);
    this.surface = rec.surfaces[0];
  }

  onOpen(): void {
    liftModal(this);
    this.render();
  }

  onClose(): void {
    // Invalidate any in-flight request so its .then() is a no-op.
    this.runId++;
    this.contentEl.empty();
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

    const lineWrap = contentEl.createDiv({ cls: "cci-mnemonic-field" });
    lineWrap.createDiv({ cls: "cci-mnemonic-label", text: "Emoji line" });
    lineWrap.createDiv({
      cls: "cci-mnemonic-hint",
      text: "Shown on the word card. Keep it short and mostly emoji.",
    });
    this.lineInput = lineWrap.createEl("input", {
      cls: "cci-mnemonic-line-input",
      type: "text",
    });
    this.lineInput.value = this.rec.mnemonic?.text ?? "";
    this.counterEl = lineWrap.createDiv({ cls: "cci-mnemonic-counter" });
    this.lineInput.addEventListener("input", () => this.updateCounter());
    this.updateCounter();

    const storyWrap = contentEl.createDiv({ cls: "cci-mnemonic-field" });
    storyWrap.createDiv({ cls: "cci-mnemonic-label", text: "Story" });
    storyWrap.createDiv({
      cls: "cci-mnemonic-hint",
      text: "The longer explanation — components, tone, meaning. Shown when you expand the mnemonic on the card.",
    });
    this.storyInput = storyWrap.createEl("textarea", {
      cls: "cci-mnemonic-story-input",
    });
    this.storyInput.rows = 6;
    this.storyInput.value = this.rec.mnemonic?.story ?? "";

    const actions = contentEl.createDiv({ cls: "cci-mnemonic-actions" });

    if (this.plugin.settings.ai.enabled) {
      const gen = actions.createEl("button", { text: "Generate with AI" });
      gen.addEventListener("click", () => void this.generate());
      this.generateBtn = gen;
    }

    // Pushes Cancel/Save to the right, leaving Generate on the left.
    actions.createDiv({ cls: "cci-mnemonic-actions-spacer" });

    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());

    const save = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    save.addEventListener("click", () => this.save());
  }

  /** `n/40`, muted normally and flagged once the line is over the cap.
   *  The cap is not enforced by truncating as the user types — that fights
   *  the cursor — it is applied on save. */
  private updateCounter(): void {
    const used = graphemeLength(this.lineInput.value);
    this.counterEl.setText(`${used}/${MNEMONIC_LINE_MAX_GRAPHEMES}`);
    this.counterEl.toggleClass("is-over", used > MNEMONIC_LINE_MAX_GRAPHEMES);
  }

  private aiInput(): MnemonicInput {
    const dict = this.plugin.dictionary.lookup(this.surface)[0];
    return {
      surface: this.surface,
      pinyin: displayPinyin(dict, this.rec, this.plugin.settings.pronunciationRegion),
      traditional: dict?.traditional ?? this.rec.traditional,
      definitions: dict?.definitions ?? this.rec.definitions ?? [],
      sentence: this.sentence,
      hskLevels: this.rec.hsk?.levels ?? [],
      // Send what is in the fields right now, not what is stored, so a
      // reroll can build on an edit the user just made.
      existing: this.lineInput.value,
      existingStory: this.storyInput.value,
    };
  }

  private async generate(): Promise<void> {
    if (this.busy) return;
    const run = ++this.runId;
    this.setBusy(true);
    try {
      const result = await this.plugin.mnemonic.generate(this.aiInput());
      if (run !== this.runId) return;
      this.lineInput.value = result.mnemonic;
      this.storyInput.value = result.story ?? "";
      this.updateCounter();
    } catch (err) {
      if (run !== this.runId) return;
      // Leave both fields untouched — a failed generation must never cost
      // the user what they had typed.
      new Notice(`Mnemonic failed: ${(err as Error).message}`);
    } finally {
      if (run === this.runId) this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    if (this.generateBtn) {
      this.generateBtn.disabled = busy;
      this.generateBtn.setText(busy ? "Generating…" : "Generate with AI");
    }
  }

  private save(): void {
    const text = clampGraphemes(this.lineInput.value.trim());
    const story = this.storyInput.value.trim();
    this.plugin.vocab.updateMnemonic(this.surface, {
      text: text || undefined,
      story: story || undefined,
    });
    new Notice(text || story ? "Mnemonic saved." : "Mnemonic cleared.");
    this.close();
  }
}
