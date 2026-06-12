import { Modal, Notice, App } from "obsidian";
import type CciPlugin from "../main";
import { DictionaryEntry } from "../dictionary/DictionaryTypes";
import { makeKey } from "../dictionary/normalizeChinese";
import { hasCjk } from "../dictionary/normalizeChinese";

/**
 * Two modes:
 *   - "override": surface text is locked, fields are pre-filled from the
 *     dictionary entry. Save writes a DictionaryOverride keyed by the
 *     entry's canonical key. Reset deletes the override.
 *   - "custom": user is creating a brand-new word from a selection. Save
 *     writes a DictionaryCustomWord keyed by the surface. Edit/delete a
 *     custom word also goes through this mode (with the surface locked).
 */
export type EditDictionaryMode = "override" | "custom";

export interface EditDictionaryProps {
  mode: EditDictionaryMode;
  /** Surface to edit / create. For override mode, the canonical entry surface. */
  surface: string;
  /** Initial values for the form fields. */
  initial: {
    traditional?: string;
    pinyin?: string;
    definitions?: string[];
    hskLevel?: string;
  };
  /** Override mode only: the dictionary's original entry, for the canonical key
   *  and the Reset-to-default button. */
  originalEntry?: DictionaryEntry;
  /** Custom mode only: true when editing an existing custom word (shows Delete). */
  isExistingCustom?: boolean;
}

export class EditDictionaryModal extends Modal {
  private vvHandler: (() => void) | null = null;

  constructor(app: App, private plugin: CciPlugin, private props: EditDictionaryProps) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cci-edit-dict-modal");

    // iOS: track visualViewport so the modal stays above the keyboard.
    const adjust = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      contentEl.style.maxHeight = `${vv.height - 60}px`;
    };
    window.visualViewport?.addEventListener("resize", adjust);
    this.vvHandler = adjust;
    adjust();

    contentEl.createEl("h3", {
      text: this.props.mode === "override" ? "Edit dictionary entry" : "Add custom word",
    });

    const surfaceInput = this.field(contentEl, "Surface (simplified)", this.props.surface);
    if (this.props.mode === "override" || this.props.isExistingCustom) {
      surfaceInput.disabled = true;
    }

    const tradInput = this.field(contentEl, "Traditional (optional)", this.props.initial.traditional ?? "");
    const pinyinInput = this.field(
      contentEl,
      "Pinyin (tone marks or numbers)",
      this.props.initial.pinyin ?? "",
      "e.g. nǐ hǎo or ni3 hao3"
    );
    const defsArea = this.textarea(
      contentEl,
      "Definitions (one per line)",
      (this.props.initial.definitions ?? []).join("\n")
    );

    const hskRow = contentEl.createDiv({ cls: "cci-edit-dict-row" });
    hskRow.createEl("label", { text: "HSK level" });
    const hskSel = hskRow.createEl("select");
    hskSel.createEl("option", { text: "(none)", value: "" });
    for (const lvl of ["1", "2", "3", "4", "5", "6", "7"]) {
      hskSel.createEl("option", { text: `HSK ${lvl}`, value: lvl });
    }
    hskSel.value = this.props.initial.hskLevel ?? "";

    const buttons = contentEl.createDiv({ cls: "cci-edit-dict-buttons" });

    const save = buttons.createEl("button", { text: "Save", cls: "mod-cta" });
    save.addEventListener("click", () => this.handleSave(surfaceInput.value, tradInput.value, pinyinInput.value, defsArea.value, hskSel.value));

    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());

    if (this.props.mode === "override") {
      const reset = buttons.createEl("button", { text: "Reset to dictionary default" });
      reset.addEventListener("click", () => this.handleResetOverride());
    }

    if (this.props.mode === "custom" && this.props.isExistingCustom) {
      const del = buttons.createEl("button", { text: "Delete custom word", cls: "mod-warning" });
      del.addEventListener("click", () => this.handleDeleteCustom());
    }
  }

  onClose(): void {
    if (this.vvHandler) {
      window.visualViewport?.removeEventListener("resize", this.vvHandler);
      this.vvHandler = null;
    }
    this.contentEl.empty();
  }

  // Field helpers ------------------------------------------------------

  private field(parent: HTMLElement, label: string, value: string, placeholder?: string): HTMLInputElement {
    const row = parent.createDiv({ cls: "cci-edit-dict-row" });
    row.createEl("label", { text: label });
    const input = row.createEl("input", { type: "text" });
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    return input;
  }

  private textarea(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
    const row = parent.createDiv({ cls: "cci-edit-dict-row" });
    row.createEl("label", { text: label });
    const ta = row.createEl("textarea");
    ta.value = value;
    ta.rows = 4;
    return ta;
  }

  // Actions ------------------------------------------------------------

  private async handleSave(surface: string, traditional: string, pinyin: string, definitionsRaw: string, hsk: string): Promise<void> {
    const trimSurface = surface.trim();
    if (!hasCjk(trimSurface)) {
      new Notice("Surface must contain at least one Chinese character.");
      return;
    }
    const definitions = definitionsRaw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (this.props.mode === "custom" && !pinyin.trim()) {
      new Notice("Pinyin is required for custom words.");
      return;
    }

    const hskField = hsk ? { source: "user", levels: [hsk] } : undefined;

    if (this.props.mode === "override") {
      const e = this.props.originalEntry;
      if (!e) {
        new Notice("Missing original entry — cannot save override.");
        return;
      }
      const key = makeKey(e.simplified, e.pinyin);
      await this.plugin.setDictionaryOverride(key, {
        pinyin: pinyin.trim() || undefined,
        traditional: traditional.trim() || undefined,
        definitions: definitions.length ? definitions : undefined,
        hsk: hskField,
        updatedAt: new Date().toISOString(),
      });
      new Notice("Dictionary override saved.");
    } else {
      await this.plugin.setCustomWord(trimSurface, {
        simplified: trimSurface,
        traditional: traditional.trim() || undefined,
        pinyin: pinyin.trim(),
        definitions,
        hsk: hskField,
      });
      new Notice(`Custom word "${trimSurface}" saved.`);
    }
    this.close();
  }

  private async handleResetOverride(): Promise<void> {
    const e = this.props.originalEntry;
    if (!e) return;
    const key = makeKey(e.simplified, e.pinyin);
    await this.plugin.deleteDictionaryOverride(key);
    new Notice("Override removed; using dictionary default.");
    this.close();
  }

  private async handleDeleteCustom(): Promise<void> {
    if (!confirm(`Delete custom word "${this.props.surface}"?`)) return;
    await this.plugin.deleteCustomWord(this.props.surface);
    new Notice("Custom word deleted.");
    this.close();
  }
}
