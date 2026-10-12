import { App, Modal, Notice } from "obsidian";
import type CciPlugin from "../main";
import { OPENAI_MODELS, resolveOpenAiChoice } from "../ai/openaiProfile";
import {
  BatchItem,
  BatchOutcome,
  batchInput,
  estimateBatchUsd,
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
 * "Generate mnemonics" from the reader's ⋯ menu: one mnemonic for every word in the open note that has none, saved as
 * it goes. The single-word editor stays the place to read, edit and reroll one; this fills the gaps in bulk, so it never
 * touches a word that already has a mnemonic, and it says what it is about to do (how many words, what it costs, what
 * leaves the device) before it starts.
 */
export class BatchMnemonicModal extends Modal {
  /** Bumped when the modal closes or a new run starts, so a late result cannot touch a closed dialog. */
  private runId = 0;
  private stopRequested = false;
  private items: BatchItem[] = [];

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
    this.contentEl.createEl("h2", { text: "Generate mnemonics for this note" });
  }

  private async scan(): Promise<void> {
    const run = ++this.runId;
    this.heading();
    this.contentEl.createEl("p", { text: "Reading the note…" });
    let items: BatchItem[];
    let haveMnemonic: number;
    try {
      const tokens = await this.plugin.tokenizer.tokenize(this.text);
      ({ items, haveMnemonic } = selectBatchWords(this.text, tokens, this.plugin.vocab, this.plugin.settings.batchMnemonicScope));
    } catch (err) {
      if (run !== this.runId) return;
      this.heading();
      this.contentEl.createEl("p", { text: `Could not read the note: ${(err as Error).message}` });
      this.closeButton();
      return;
    }
    if (run !== this.runId) return;
    this.items = items;
    this.renderConfirm(haveMnemonic);
  }

  private closeButton(): void {
    const actions = this.contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
  }

  private renderConfirm(haveMnemonic: number): void {
    this.heading();
    const { contentEl } = this;
    const n = this.items.length;
    const scope = SCOPE_TEXT[this.plugin.settings.batchMnemonicScope];
    if (n === 0) {
      contentEl.createEl("p", {
        text:
          haveMnemonic > 0
            ? `All the ${scope} in this note already have a mnemonic.`
            : `There are no ${scope} in this note.`,
      });
      this.closeButton();
      return;
    }
    contentEl.createEl("p", {
      text: `${n} ${n === 1 ? "word" : "words"} in this note ${n === 1 ? "has" : "have"} no mnemonic yet (${scope}).`,
    });
    if (haveMnemonic > 0) {
      contentEl.createEl("p", {
        cls: "cci-batch-muted",
        text: `${haveMnemonic} that already ${haveMnemonic === 1 ? "has one is" : "have one are"} left alone.`,
      });
    }
    const ai = this.plugin.settings.ai;
    const modelId = OPENAI_MODELS[resolveOpenAiChoice(ai.openaiModel)].id;
    const usd = estimateBatchUsd(n, ai.provider, modelId);
    contentEl.createEl("p", {
      cls: "cci-batch-muted",
      text:
        usd === null
          ? "Runs on your own model; nothing is billed."
          : `Estimated cost ${formatUsd(usd)} on OpenAI.`,
    });
    contentEl.createEl("p", {
      cls: "cci-batch-muted",
      text: `Each word and the sentence it first appears in is sent to ${ai.provider === "openai" ? "OpenAI" : "your Ollama server"}. Mnemonics are saved as they are made; Stop keeps what is done.`,
    });
    const list = contentEl.createEl("details", { cls: "cci-batch-words" });
    list.createEl("summary", { text: "Show the words" });
    list.createDiv({ text: this.items.map((i) => i.surface).join("、") });

    const actions = contentEl.createDiv({ cls: "cci-batch-actions" });
    actions.createDiv({ cls: "cci-batch-spacer" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const go = actions.createEl("button", { text: `Generate ${n} ${n === 1 ? "mnemonic" : "mnemonics"}`, cls: "mod-cta" });
    go.addEventListener("click", () => void this.start(this.items));
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
    const { outcomes, stopped } = await runBatch(
      items,
      async (item) => {
        const result = await plugin.mnemonic.generate(batchInput(item, deps));
        // Saved at once, so a Stop, a closed dialog or a crash keeps everything already made.
        const text = result.mnemonic || undefined;
        const story = result.story || undefined;
        // An answer that cleaned down to nothing is a failure to retry, not an empty record to save.
        if (!text && !story) throw new Error("The AI returned nothing usable.");
        plugin.vocab.updateMnemonic(item.storage, { text, story });
        return result.notes;
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
    plugin.refreshChineseViews();
    if (run !== this.runId) return;
    this.renderDone(outcomes, stopped, items.length);
  }

  private renderDone(outcomes: BatchOutcome[], stopped: "user" | "failures" | null, total: number): void {
    this.heading();
    const { contentEl } = this;
    const failed = outcomes.filter((o) => !o.ok);
    const caveats = outcomes.filter((o) => o.ok && o.caveats?.length);
    const saved = outcomes.length - failed.length;
    if (saved > 0) contentEl.createEl("p", { text: `Saved ${saved} ${saved === 1 ? "mnemonic" : "mnemonics"}.` });
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
