import { App, Modal, Notice, TFile } from "obsidian";
import type CciPlugin from "../main";
import { ExplainMeta, ExplainResult, explainBlocks, explainFileName, renderExplainMarkdown } from "../ai/explain";
import { explainInputFor, explainKey, findExplainNote, saveExplainNote } from "../ai/explainNotes";
import { OPENAI_MODELS, resolveOpenAiChoice } from "../ai/openaiProfile";
import { countTraditionalMarkers } from "../dictionary/scriptDetect";
import { VIEW_TYPE_CHINESE } from "../constants";
import { renderExplainBlocks } from "./explainPreview";
import { liftModal } from "./modalLayer";

/**
 * The Explain dialog (#186): ask the AI for a thorough usage note on one word, read it here, and only then decide
 * whether to keep it. Nothing is written to the vault until Save, because the text is the model's and unchecked.
 *
 * If the word already has an explanation note the dialog says so first and offers to open it, so a second press costs
 * nothing; a new version is written beside it, never over it.
 */
export class ExplainModal extends Modal {
  /** Bumped on every request and on close so a slow answer cannot land in a closed or newer dialog. */
  private runId = 0;
  private result: ExplainResult | null = null;
  private issues: string[] = [];
  private meta!: ExplainMeta;
  private existing: TFile | null = null;

  constructor(
    app: App,
    private plugin: CciPlugin,
    private surface: string,
    private sentence: string | undefined
  ) {
    super(app);
  }

  onOpen(): void {
    liftModal(this);
    this.contentEl.addClass("cci-explain-modal");
    this.existing = findExplainNote(this.app, explainKey(this.deps(), this.surface));
    if (this.existing) this.renderExisting(this.existing);
    else void this.generate();
  }

  onClose(): void {
    this.runId++;
    this.contentEl.empty();
  }

  private deps() {
    const p = this.plugin;
    return {
      lookup: (s: string) => p.dictionary.lookup(s),
      bySurface: (s: string) => p.vocab.bySurface(s),
      region: p.settings.pronunciationRegion,
      scriptVariant: p.settings.scriptVariant,
      countTraditionalMarkers: (t: string) => countTraditionalMarkers(t, p.dictionary),
    };
  }

  private heading(sub?: string): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: `Explain ${this.surface}` });
    if (sub) this.contentEl.createEl("p", { cls: "cci-explain-muted", text: sub });
  }

  private actions(): HTMLElement {
    const bar = this.contentEl.createDiv({ cls: "cci-explain-actions" });
    bar.createDiv({ cls: "cci-explain-spacer" });
    return bar;
  }

  private renderExisting(file: TFile): void {
    this.heading(`You already have an explanation of this word: ${file.path}`);
    const bar = this.actions();
    bar.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
    bar.createEl("button", { text: "Write a new version" }).addEventListener("click", () => void this.generate());
    bar.createEl("button", { text: "Open it", cls: "mod-cta" }).addEventListener("click", () => {
      void this.openInReader(file);
      this.close();
    });
  }

  private async generate(): Promise<void> {
    const run = ++this.runId;
    this.heading("Writing the explanation… this usually takes 20 to 40 seconds.");
    const bar = this.actions();
    bar.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    try {
      const input = explainInputFor(this.deps(), this.surface, this.sentence);
      const { result, issues } = await this.plugin.explain.generate(input);
      if (run !== this.runId) return;
      this.result = result;
      this.issues = issues;
      this.meta = this.metaFor(input.pinyin, input.hskLevels);
      this.renderPreview();
    } catch (err) {
      if (run !== this.runId) return;
      this.heading(`The explanation failed: ${(err as Error).message}`);
      const fail = this.actions();
      fail.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
      fail.createEl("button", { text: "Try again", cls: "mod-cta" }).addEventListener("click", () => void this.generate());
    }
  }

  private metaFor(pinyin: string, hskLevels: string[]): ExplainMeta {
    const s = this.plugin.settings;
    const model = s.ai.provider === "openai" ? OPENAI_MODELS[resolveOpenAiChoice(s.ai.openaiModel)].id : s.ai.ollama.chatModel;
    return {
      word: this.surface,
      pinyin,
      key: explainKey(this.deps(), this.surface),
      hsk: hskLevels.join("/"),
      provider: s.ai.provider,
      model,
      date: new Date().toISOString().slice(0, 10),
      showPinyin: s.explain.pinyinInExamples,
    };
  }

  private renderPreview(): void {
    const result = this.result as ExplainResult;
    this.heading();
    const { contentEl } = this;
    if (this.issues.length > 0) {
      contentEl.createEl("p", {
        cls: "cci-explain-caveat",
        text: `The plugin could not get every rule right even after asking again: ${this.issues.join(" ")}`,
      });
    }
    const body = contentEl.createDiv({ cls: "cci-explain-body" });
    renderExplainBlocks(body, explainBlocks(result, this.meta));

    const bar = this.actions();
    bar.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
    bar.createEl("button", { text: "Copy" }).addEventListener("click", () => void this.copy());
    bar.createEl("button", { text: "Regenerate" }).addEventListener("click", () => void this.generate());
    const label = this.existing ? "Save as another version" : "Save as note";
    bar.createEl("button", { text: label, cls: "mod-cta" }).addEventListener("click", () => void this.save());
  }

  private markdown(): string {
    return renderExplainMarkdown(this.result as ExplainResult, this.meta);
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.markdown());
      new Notice("Explanation copied.");
    } catch {
      new Notice("Could not copy to the clipboard.");
    }
  }

  private async save(): Promise<void> {
    const run = this.runId;
    try {
      const file = await saveExplainNote(
        this.app,
        this.plugin.settings.explain.folder,
        explainFileName(this.meta.word, this.meta.pinyin),
        this.markdown()
      );
      new Notice(`Saved ${file.path}`);
      if (this.plugin.settings.explain.openAfterSave) await this.openInReader(file);
      if (run === this.runId) this.close();
    } catch (err) {
      new Notice(`Could not save the explanation: ${(err as Error).message}`);
    }
  }

  /** In the reader, so the Chinese in the note is annotated and tappable like any other note. */
  private async openInReader(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: file.path } });
  }
}

