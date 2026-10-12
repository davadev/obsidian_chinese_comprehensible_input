import { App, Modal, Notice } from "obsidian";
import type CciPlugin from "../main";
import { OPENAI_MODELS, resolveOpenAiChoice } from "../ai/openaiProfile";
import {
  BatchItem,
  BatchOutcome,
  batchInput,
  estimateOpenAiUsd,
  formatUsd,
  runBatch,
  selectBatchWords,
} from "../vocabulary/batchMnemonics";
import { liftModal } from "./modalLayer";
import { UsageMeter } from "./usageMeter";

const SCOPE_TEXT = {
  notKnown: "words that are not known yet",
  marked: "words you marked unknown or partial",
  unknown: "words you marked unknown",
} as const;

/**
 * "Mnemonics for this note" from the reader's ⋯ menu: fill in a mnemonic for every word of the open note that has none,
 * regenerate all of them, or remove them. The single-word editor stays the place to read, edit and reroll one. Filling gaps
 * never touches a word that already has a mnemonic; regenerating and removing do, so they ask a second time and say that
 * hand-written ones go too. Either way it says what it is about to do (how many words, what it costs, what leaves the device) before it
 * starts, and what it cost when it is done.
 */
export class BatchMnemonicModal extends Modal {
  /** Bumped when the modal closes or a new run starts, so a late result cannot touch a closed dialog. */
  private runId = 0;
  private stopRequested = false;
  private missing: BatchItem[] = [];
  private existing: BatchItem[] = [];
  /** Every word of the note with a mnemonic, in scope or not: what "remove" covers. */
  private removable: BatchItem[] = [];
  /** What this dialog's requests cost on OpenAI, summed over every run in it (a retry adds to it). */
  private meter: UsageMeter;

  constructor(
    app: App,
    private plugin: CciPlugin,
    private text: string
  ) {
    super(app);
    this.meter = new UsageMeter(plugin);
  }

  onOpen(): void {
    liftModal(this);
    this.contentEl.addClass("cci-batch-mnemonic-modal");
    void this.scan();
  }

  onClose(): void {
    this.runId++;
    this.stopRequested = true;
    this.contentEl.empty();
  }

  private heading(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Mnemonics for this note" });
  }

  private async scan(): Promise<void> {
    const run = ++this.runId;
    this.heading();
    this.contentEl.createEl("p", { text: "Reading the note…" });
    let selection;
    try {
      const tokens = await this.plugin.tokenizer.tokenize(this.text);
      selection = selectBatchWords(this.text, tokens, this.plugin.vocab, this.plugin.settings.batchMnemonicScope);
    } catch (err) {
      if (run !== this.runId) return;
      this.heading();
      this.contentEl.createEl("p", { text: `Could not read the note: ${(err as Error).message}` });
      this.closeButton();
      return;
    }
    if (run !== this.runId) return;
    this.missing = selection.items;
    this.existing = selection.withMnemonic;
    this.removable = selection.removable;
    this.renderConfirm();
  }

  private closeButton(): void {
    const actions = this.contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
  }

  private get modelId(): string {
    return OPENAI_MODELS[resolveOpenAiChoice(this.plugin.settings.ai.openaiModel)].id;
  }

  private costLine(label: string, count: number): string {
    return `${label}: ${formatUsd(estimateOpenAiUsd(count, this.modelId))} on OpenAI.`;
  }

  private renderConfirm(): void {
    this.heading();
    const { contentEl } = this;
    const n = this.missing.length;
    const k = this.existing.length;
    const scope = SCOPE_TEXT[this.plugin.settings.batchMnemonicScope];
    if (n + k === 0) {
      contentEl.createEl("p", { text: `There are no ${scope} in this note.` });
      this.renderConfirmActions(false);
      return;
    }
    contentEl.createEl("p", {
      text:
        n > 0
          ? `${n} ${n === 1 ? "word" : "words"} in this note ${n === 1 ? "has" : "have"} no mnemonic yet (${scope}).`
          : `All the ${scope} in this note already have a mnemonic.`,
    });
    if (k > 0 && n > 0) {
      contentEl.createEl("p", { cls: "cci-batch-muted", text: `${k} ${k === 1 ? "has" : "have"} one already.` });
    }
    const isOpenAi = this.plugin.settings.ai.provider === "openai";
    const lines: string[] = [];
    if (!isOpenAi) lines.push("Runs on your own model; nothing is billed.");
    else {
      if (n > 0) lines.push(this.costLine("Filling in the missing ones", n));
      if (k > 0) lines.push(this.costLine(`Regenerating all ${n + k}`, n + k));
    }
    for (const line of lines) contentEl.createEl("p", { cls: "cci-batch-muted", text: line });
    contentEl.createEl("p", {
      cls: "cci-batch-muted",
      text: `Each word and the sentence it first appears in is sent to ${isOpenAi ? "OpenAI" : "your Ollama server"}. Mnemonics are saved as they are made; Stop keeps what is done.`,
    });
    const list = contentEl.createEl("details", { cls: "cci-batch-words" });
    list.createEl("summary", { text: "Show the words" });
    const body = list.createDiv();
    if (n > 0) body.createDiv({ text: `No mnemonic yet: ${this.missing.map((i) => i.surface).join("、")}` });
    if (k > 0) body.createDiv({ text: `Already have one: ${this.existing.map((i) => i.surface).join("、")}` });

    this.renderConfirmActions(true);
  }

  /** Buttons of the first screen. With nothing to generate, only Remove (when something can be removed) and Close. */
  private renderConfirmActions(canGenerate: boolean): void {
    const { contentEl } = this;
    const n = this.missing.length;
    const k = this.existing.length;
    const r = this.removable.length;
    if (!canGenerate && r === 0) {
      this.closeButton();
      return;
    }
    const actions = contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: canGenerate ? "Cancel" : "Close" }).addEventListener("click", () => this.close());
    if (r > 0) {
      const remove = actions.createEl("button", { text: `Remove ${r === 1 ? "the mnemonic" : `all ${r} mnemonics`}…`, cls: "mod-warning" });
      remove.addEventListener("click", () => this.renderRemoveConfirm());
    }
    if (k > 0) {
      const regen = actions.createEl("button", { text: `Regenerate all ${n + k}…`, cls: "mod-warning" });
      regen.addEventListener("click", () => this.renderReplaceConfirm());
    }
    if (n > 0) {
      const go = actions.createEl("button", { text: `Generate ${n} missing`, cls: "mod-cta" });
      go.addEventListener("click", () => void this.start(this.missing));
    }
  }

  /** Removing is as final as regenerating, and it covers known words too, so it is never one tap away either. */
  private renderRemoveConfirm(): void {
    this.heading();
    const r = this.removable.length;
    this.contentEl.createEl("p", {
      text: `This removes the ${r === 1 ? "mnemonic of the 1 word in this note that has one" : `mnemonics of all ${r} words in this note that have one`} (known words included), including any you wrote or edited yourself, and cannot be undone.`,
    });
    const list = this.contentEl.createEl("details", { cls: "cci-batch-words" });
    list.createEl("summary", { text: "Show the words" });
    list.createDiv({ text: this.removable.map((i) => i.surface).join("、") });
    const actions = this.contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: "Back" }).addEventListener("click", () => this.renderConfirm());
    const go = actions.createEl("button", { text: `Remove ${r === 1 ? "it" : `all ${r}`}`, cls: "mod-warning" });
    go.addEventListener("click", () => this.removeAll());
  }

  private removeAll(): void {
    const { plugin, removable } = this;
    // Same as clearing both fields in the single editor, so the removal syncs like any other edit.
    for (const item of removable) plugin.vocab.updateMnemonic(item.storage, { text: undefined, story: undefined });
    plugin.refreshChineseViews();
    this.heading();
    const r = removable.length;
    this.contentEl.createEl("p", { text: `Removed ${r === 1 ? "1 mnemonic" : `${r} mnemonics`}.` });
    this.closeButton();
    new Notice(`Removed ${r === 1 ? "1 mnemonic" : `${r} mnemonics`}.`);
  }

  /** Regenerating overwrites, hand-written mnemonics included, so it is never one tap away. */
  private renderReplaceConfirm(): void {
    this.heading();
    const { contentEl } = this;
    const n = this.missing.length;
    const k = this.existing.length;
    contentEl.createEl("p", {
      text: `This replaces the ${k === 1 ? "mnemonic of the 1 word that already has one" : `mnemonics of the ${k} words that already have one`}, including any you wrote or edited yourself, and cannot be undone.${n > 0 ? ` The ${n} without one will get one too.` : ""}`,
    });
    const actions = contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: "Back" }).addEventListener("click", () => this.renderConfirm());
    const go = actions.createEl("button", { text: `Replace and regenerate ${n + k}`, cls: "mod-warning" });
    go.addEventListener("click", () => void this.start([...this.missing, ...this.existing]));
  }

  private async start(items: BatchItem[]): Promise<void> {
    const run = ++this.runId;
    this.stopRequested = false;
    this.heading();
    const { contentEl } = this;
    const status = contentEl.createEl("p", { text: `0 / ${items.length}` });
    const bar = contentEl.createEl("progress");
    bar.max = items.length;
    bar.value = 0;
    const actions = contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    const stop = actions.createEl("button", { text: "Stop" });
    stop.addEventListener("click", () => {
      this.stopRequested = true;
      stop.disabled = true;
      stop.setText("Stopping…");
    });

    const plugin = this.plugin;
    const deps = {
      lookup: (s: string) => plugin.dictionary.lookup(s),
      bySurface: (s: string) => plugin.vocab.bySurface(s),
      region: plugin.settings.pronunciationRegion,
    };
    // A local model serves one request at a time; a hosted one takes a few at once.
    const concurrency = plugin.settings.ai.provider === "openai" ? 3 : 1;
    // Every request the run makes (including a repair attempt) reports its tokens; add up what OpenAI will bill.
    this.meter.start();
    let result;
    try {
      result = await runBatch(
        items,
        async (item) => {
          const made = await plugin.mnemonic.generate(batchInput(item, deps));
          const text = made.mnemonic || undefined;
          const story = made.story || undefined;
          // An answer that cleaned down to nothing is a failure to retry, not an empty record to save over a real one.
          if (!text && !story) throw new Error("The AI returned nothing usable.");
          // Saved at once, so a Stop, a closed dialog or a crash keeps everything already made.
          plugin.vocab.updateMnemonic(item.storage, { text, story });
          return made.notes;
        },
        {
          concurrency,
          shouldStop: () => this.stopRequested || run !== this.runId,
          onProgress: (done, total, last) => {
            if (run !== this.runId) return;
            status.setText(`${done} / ${total} — ${last.item.surface}`);
            bar.value = done;
          },
        }
      );
    } finally {
      this.meter.stop();
    }
    plugin.refreshChineseViews();
    if (run !== this.runId) return;
    this.renderDone(result.outcomes, result.stopped, items.length);
  }

  private renderDone(outcomes: BatchOutcome[], stopped: "user" | "failures" | null, total: number): void {
    this.heading();
    const { contentEl } = this;
    const failed = outcomes.filter((o) => !o.ok);
    const caveats = outcomes.filter((o) => o.ok && o.caveats?.length);
    const saved = outcomes.length - failed.length;
    if (saved > 0) contentEl.createEl("p", { text: `Saved ${saved} ${saved === 1 ? "mnemonic" : "mnemonics"}.` });
    const cost = this.meter.line();
    if (cost) contentEl.createEl("p", { cls: "cci-batch-muted", text: cost });
    if (stopped === "user") {
      contentEl.createEl("p", { cls: "cci-batch-muted", text: `Stopped; ${total - outcomes.length} not started.` });
    } else if (stopped === "failures") {
      contentEl.createEl("p", {
        text: `Stopped after several failures in a row (${total - outcomes.length} not started). Check your AI provider settings, then run it again; finished words are kept.`,
      });
    }
    if (caveats.length > 0) {
      contentEl.createEl("p", {
        cls: "cci-batch-muted",
        text: `Saved with a caveat — worth a look: ${caveats.map((o) => o.item.surface).join("、")}`,
      });
    }
    if (failed.length > 0) {
      contentEl.createEl("p", { text: `${failed.length} failed:` });
      const ul = contentEl.createEl("ul");
      for (const f of failed.slice(0, 10)) ul.createEl("li", { text: `${f.item.surface} — ${f.error}` });
      if (failed.length > 10) ul.createEl("li", { text: `…and ${failed.length - 10} more` });
    }
    const actions = contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    if (failed.length > 0) {
      const retry = actions.createEl("button", { text: "Retry the failed ones" });
      retry.addEventListener("click", () => void this.start(failed.map((f) => f.item)));
    }
    actions.createEl("button", { text: "Close", cls: "mod-cta" }).addEventListener("click", () => this.close());
    if (saved > 0) new Notice(`Saved ${saved} ${saved === 1 ? "mnemonic" : "mnemonics"}.`);
  }
}
