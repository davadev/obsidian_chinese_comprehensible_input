import { App, Modal, Notice } from "obsidian";
import type CciPlugin from "../main";
import { OPENAI_MODELS, computeOpenAiCostUsd, resolveOpenAiChoice } from "../ai/openaiProfile";
import {
  BatchItem,
  BatchOutcome,
  batchInput,
  estimateOpenAiUsd,
  formatSpentUsd,
  formatUsd,
  runBatch,
  selectBatchWords,
} from "../vocabulary/batchMnemonics";
import { liftModal } from "./modalLayer";

const SCOPE_TEXT = {
  notKnown: "words that are not known yet",
  marked: "words you marked unknown or partial",
  unknown: "words you marked unknown",
} as const;

/**
 * "Mnemonics for this note" from the reader's ⋯ menu: fill in a mnemonic for every word of the open note that has none,
 * or regenerate all of them. The single-word editor stays the place to read, edit and reroll one. Filling gaps never
 * touches a word that already has a mnemonic; regenerating does, so it asks a second time and says that hand-written ones
 * go too. Either way it says what it is about to do (how many words, what it costs, what leaves the device) before it
 * starts, and what it cost when it is done.
 */
export class BatchMnemonicModal extends Modal {
  /** Bumped when the modal closes or a new run starts, so a late result cannot touch a closed dialog. */
  private runId = 0;
  private stopRequested = false;
  private missing: BatchItem[] = [];
  private existing: BatchItem[] = [];
  /** What this dialog's requests cost on OpenAI, summed over every run in it (a retry adds to it). */
  private spentUsd = 0;
  private requests = 0;

  constructor(
    app: App,
    private plugin: CciPlugin,
    private text: string
  ) {
    super(app);
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
      this.closeButton();
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

    const actions = contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    if (k > 0) {
      const regen = actions.createEl("button", { text: `Regenerate all ${n + k}…`, cls: "mod-warning" });
      regen.addEventListener("click", () => this.renderReplaceConfirm());
    }
    if (n > 0) {
      const go = actions.createEl("button", { text: `Generate ${n} missing`, cls: "mod-cta" });
      go.addEventListener("click", () => void this.start(this.missing));
    }
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
    const stopCounting = plugin.onAiUsage((entry) => {
      if (entry.provider !== "openai") return;
      this.requests++;
      this.spentUsd += computeOpenAiCostUsd(entry, entry.model);
    });
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
      stopCounting();
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
    if (this.plugin.settings.ai.provider === "openai" && this.requests > 0) {
      contentEl.createEl("p", {
        cls: "cci-batch-muted",
        text: `Cost on OpenAI: ${formatSpentUsd(this.spentUsd)} (${this.requests} ${this.requests === 1 ? "request" : "requests"}).`,
      });
    }
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
