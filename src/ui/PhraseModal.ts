import { App, Modal, Notice } from "obsidian";
import type CciPlugin from "../main";
import type { ChineseTextFileView } from "../view/ChineseTextFileView";
import { PHRASE_ACTIONS, PhraseAction, estimatePhraseUsd } from "../ai/phraseCost";
import { PhraseCheck, PhraseMeta, PhraseResult, phraseBlocks, phraseFileName, renderPhraseMarkdown } from "../ai/phrase";
import { LocatedCorrection, ProofreadResult, applyCorrections, locateCorrections } from "../ai/proofread";
import { ScoredCandidate, SimplifyOutcome } from "../ai/SimplifyService";
import { Measured, describeGain } from "../ai/simplify";
import { OPENAI_MODELS, resolveOpenAiChoice } from "../ai/openaiProfile";
import { formatUsd } from "../vocabulary/batchMnemonics";
import { copyMarkdown, saveExplanation } from "./explainFiles";
import { describeIssues, renderExplainBlocks } from "./explainPreview";
import { liftModal } from "./modalLayer";
import { startAiStatus } from "./aiStatus";
import { UsageMeter } from "./usageMeter";

/** What the learner selected in the note. */
export interface PhraseSelection {
  /** As sent to the AI: the note's own markup taken off. */
  text: string;
  /** As written in the note between `from` and `to`. */
  raw: string;
  from: number;
  to: number;
  /** The reader the text came from, for replacing text in place; null if it has gone. */
  view: ChineseTextFileView | null;
  /** Markup was removed from `raw` to make `text`. */
  hasMarkup: boolean;
}

const RUNNING_TITLE: Record<PhraseAction, string> = {
  explain: "Writing the explanation…",
  proofread: "Proof reading…",
  simplify: "Finding simpler ways to say it…",
};

/**
 * The dialog behind the lightbulb tool (#186): explain a selected phrase, proof read it, or simplify it (#238).
 *
 * It is also the confirm step: the second tap lands here and nothing is sent until the learner presses the action button,
 * with the text, its length and the likely cost in front of them. Explain checks first that the text is generally
 * correct; if it is not, it says so and offers to proof read instead of explaining wrong grammar. Proof read lists each
 * correction with Apply; applying replaces the text in the note, guarded so a note that changed meanwhile is never damaged.
 * Simplify shows the simplest rewrite the plugin measured, with the numbers that make it simpler, and the other candidates.
 */
export class PhraseModal extends Modal {
  private runId = 0;
  private stopProgress: (() => void) | null = null;
  private meter: UsageMeter;
  private explained: PhraseResult | null = null;
  private issues: string[] = [];
  private meta!: PhraseMeta;
  private proofread: ProofreadResult | null = null;
  private simplified: SimplifyOutcome | null = null;
  /** The candidate written into the note, once one has been: the others can no longer be applied. */
  private appliedText: string | null = null;
  /** The selection as it is in the note now: it changes as corrections are applied. */
  private rawNow: string;
  private to: number;
  /** Which corrections are applied, by where they start in the selected text (stable: the list is rebuilt on every draw). */
  private applied = new Set<number>();

  constructor(
    app: App,
    private plugin: CciPlugin,
    private sel: PhraseSelection,
    private action: PhraseAction
  ) {
    super(app);
    this.meter = new UsageMeter(plugin);
    this.rawNow = sel.raw;
    this.to = sel.to;
  }

  onOpen(): void {
    liftModal(this);
    this.contentEl.addClass("cci-explain-modal");
    this.renderConfirm();
  }

  onClose(): void {
    this.runId++;
    this.meter.stop();
    this.stopProgress?.();
    this.contentEl.empty();
  }

  private get verb(): string {
    return PHRASE_ACTIONS[this.action].label;
  }

  private heading(title: string): void {
    this.stopProgress?.();
    this.stopProgress = null;
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: title });
  }

  private actions(): HTMLElement {
    const bar = this.contentEl.createDiv({ cls: "cci-explain-actions" });
    bar.createDiv({ cls: "cci-explain-spacer" });
    return bar;
  }

  private button(bar: HTMLElement, text: string, onClick: () => void, cta = false): HTMLButtonElement {
    const b = bar.createEl("button", { text, cls: cta ? "mod-cta" : undefined });
    b.addEventListener("click", onClick);
    return b;
  }

  // ── confirm ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private renderConfirm(): void {
    this.heading(`${this.verb} this text`);
    const { contentEl } = this;
    contentEl.createEl("blockquote", { cls: "cci-explain-quote", text: this.sel.text });
    const chars = Array.from(this.sel.text).length;
    const cap = this.plugin.settings.explain.maxPhraseChars;
    contentEl.createEl("p", { cls: "cci-explain-muted", text: `${chars} of ${cap} characters.` });
    const ai = this.plugin.settings.ai;
    if (ai.provider === "openai") {
      const model = OPENAI_MODELS[resolveOpenAiChoice(ai.openaiModel)].id;
      contentEl.createEl("p", {
        cls: "cci-explain-muted",
        text: `Estimated cost ${formatUsd(estimatePhraseUsd(this.action, chars, model))} on OpenAI.`,
      });
    }
    contentEl.createEl("p", {
      cls: "cci-explain-muted",
      text: `This text is sent to ${ai.provider === "openai" ? "OpenAI" : "your Ollama server"}. Nothing else from the note is.`,
    });
    const bar = this.actions();
    this.button(bar, "Cancel", () => this.close());
    this.button(bar, this.verb, () => void this.run(), true);
  }

  // ── running ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    const run = ++this.runId;
    this.heading(RUNNING_TITLE[this.action]);
    this.stopProgress = startAiStatus(this.contentEl, this.plugin.ai, this.plugin.settings.ai.provider);
    this.button(this.actions(), "Cancel", () => this.close());
    this.meter.usd = 0;
    this.meter.requests = 0;
    this.meter.start();
    try {
      if (this.action === "simplify") {
        const out = await this.plugin.simplify.simplify(this.sel.text);
        this.meter.stop();
        if (run !== this.runId) return;
        this.simplified = out;
        this.issues = out.issues;
        this.appliedText = null;
        this.renderSimplify();
        return;
      }
      if (this.action === "proofread") {
        const out = await this.plugin.proofread.proofread(this.sel.text);
        this.meter.stop();
        if (run !== this.runId) return;
        this.proofread = out.result;
        this.issues = out.issues;
        this.renderProofread();
        return;
      }
      const check = await this.plugin.phraseExplain.check(this.sel.text);
      if (check.verdict === "wrong") {
        this.meter.stop();
        if (run !== this.runId) return;
        this.renderWrong(check);
        return;
      }
      const typo = check.verdict === "typo" ? `${check.original} should be ${check.suggestion}${check.note ? ` (${check.note})` : ""}` : undefined;
      const out = await this.plugin.phraseExplain.explain(this.sel.text, typo);
      this.meter.stop();
      if (run !== this.runId) return;
      this.explained = out.result;
      this.issues = out.issues;
      this.meta = this.metaFor();
      this.renderExplanation();
    } catch (err) {
      this.meter.stop();
      if (run !== this.runId) return;
      this.heading(`That failed: ${(err as Error).message}`);
      const bar = this.actions();
      this.button(bar, "Close", () => this.close());
      this.button(bar, "Try again", () => void this.run(), true);
    }
  }

  private metaFor(): PhraseMeta {
    const s = this.plugin.settings;
    const model = s.ai.provider === "openai" ? OPENAI_MODELS[resolveOpenAiChoice(s.ai.openaiModel)].id : s.ai.ollama.chatModel;
    return {
      text: this.sel.text,
      provider: s.ai.provider,
      model,
      date: new Date().toISOString().slice(0, 10),
      showPinyin: s.explain.pinyinInExamples,
    };
  }

  private costLine(): void {
    const cost = this.meter.line();
    if (cost) this.contentEl.createEl("p", { cls: "cci-explain-muted", text: cost });
  }

  private caveat(): void {
    if (this.issues.length > 0) {
      this.contentEl.createEl("p", {
        cls: "cci-explain-caveat",
        text: describeIssues(this.issues),
      });
    }
  }

  // ── explain ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The text is not generally correct: say so, and offer the proofreader rather than explaining wrong grammar. */
  private renderWrong(check: PhraseCheck): void {
    this.heading("This text may contain a mistake");
    const { contentEl } = this;
    contentEl.createEl("blockquote", { cls: "cci-explain-quote", text: this.sel.text });
    contentEl.createEl("p", { text: check.note || "The grammar looks broken, so an explanation could teach you something wrong." });
    contentEl.createEl("p", { cls: "cci-explain-muted", text: "Proof reading finds the mistakes and suggests the simplest fixes." });
    this.costLine();
    const bar = this.actions();
    this.button(bar, "Close", () => this.close());
    this.button(bar, "Proof read this instead", () => {
      this.action = "proofread";
      void this.run();
    }, true);
  }

  private renderExplanation(): void {
    this.heading("Phrase explained");
    const { contentEl } = this;
    this.caveat();
    renderExplainBlocks(contentEl.createDiv({ cls: "cci-explain-body" }), phraseBlocks(this.explained as PhraseResult, this.meta));
    this.costLine();
    const bar = this.actions();
    this.button(bar, "Close", () => this.close());
    this.button(bar, "Copy", () => void copyMarkdown(this.markdown(), "Explanation"));
    this.button(bar, "Regenerate", () => void this.run());
    this.button(bar, "Save as note", () => void this.save(), true);
  }

  private markdown(): string {
    return renderPhraseMarkdown(this.explained as PhraseResult, this.meta);
  }

  private async save(): Promise<void> {
    const run = this.runId;
    const file = await saveExplanation(this.app, this.plugin, phraseFileName(this.meta.text, this.meta.date), this.markdown(), "explanation");
    if (file && run === this.runId) this.close();
  }

  // ── proof read ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Where a correction sits in the note now. Without markup the model's text is the note's text, so the position found in
   * it, moved by the corrections already applied before it, is exact; with markup the span is searched for in the note.
   * Either way `replaceRange` checks the text there before writing.
   */
  private offsetOf(c: LocatedCorrection, placed: LocatedCorrection[]): number {
    if (this.sel.hasMarkup) return this.rawNow.indexOf(c.original);
    const shift = placed.filter((p) => this.applied.has(p.start) && p.start < c.start).reduce((n, p) => n + p.replacement.length - p.original.length, 0);
    return c.start + shift;
  }

  private canApply(c: LocatedCorrection, placed: LocatedCorrection[]): boolean {
    if (!this.sel.view || this.applied.has(c.start)) return false;
    const at = this.offsetOf(c, placed);
    return at >= 0 && this.rawNow.slice(at, at + c.original.length) === c.original;
  }

  private applyOne(c: LocatedCorrection, placed: LocatedCorrection[]): boolean {
    const view = this.sel.view;
    if (!view) return false;
    const at = this.offsetOf(c, placed);
    if (at < 0 || this.rawNow.slice(at, at + c.original.length) !== c.original) {
      new Notice("Could not find that text in the note any more. Select it again.");
      return false;
    }
    if (!view.replaceRange(this.sel.from + at, this.sel.from + at + c.original.length, c.original, c.replacement)) return false;
    this.rawNow = this.rawNow.slice(0, at) + c.replacement + this.rawNow.slice(at + c.original.length);
    this.to += c.replacement.length - c.original.length;
    this.applied.add(c.start);
    return true;
  }

  private renderProofread(): void {
    const result = this.proofread as ProofreadResult;
    this.heading("Proof reading");
    const { contentEl } = this;
    contentEl.createEl("blockquote", { cls: "cci-explain-quote", text: this.sel.text });
    this.caveat();
    const placed = locateCorrections(this.sel.text, result.corrections);
    if (placed.length === 0) {
      contentEl.createEl("p", { text: "No mistakes found." });
      contentEl.createEl("p", { cls: "cci-explain-muted", text: "Only real mistakes are flagged, not style." });
    }
    const list = contentEl.createDiv({ cls: "cci-proof-list" });
    for (const c of placed) {
      const item = list.createDiv({ cls: "cci-proof-item" });
      const line = item.createDiv({ cls: "cci-proof-line" });
      line.createSpan({ cls: "cci-proof-old", text: `❌ ${c.original}` });
      line.createSpan({ text: " → " });
      line.createSpan({ cls: "cci-proof-new", text: `✅ ${c.replacement || "(delete)"}` });
      item.createDiv({ cls: "cci-explain-muted", text: c.why });
      const done = this.applied.has(c.start);
      const apply = item.createEl("button", { text: done ? "Applied ✓" : "Apply" });
      apply.disabled = done || !this.canApply(c, placed);
      if (!done && apply.disabled) apply.title = "This text can no longer be replaced automatically; copy the corrected text instead.";
      apply.addEventListener("click", () => {
        if (this.applyOne(c, placed)) this.renderProofread();
      });
    }
    this.costLine();
    const bar = this.actions();
    this.button(bar, "Close", () => this.close());
    if (placed.length > 0) {
      this.button(bar, "Copy corrected text", () => void this.copyCorrected(placed));
      const all = this.button(bar, "Apply all", () => {
        for (const c of placed) if (this.canApply(c, placed)) this.applyOne(c, placed);
        this.renderProofread();
      }, true);
      all.disabled = !placed.some((c) => this.canApply(c, placed));
    }
  }

  // ── simplify ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Can the whole selection be replaced right now? Not when markup was taken off it (the replacement would lose that markup). */
  private canReplaceWhole(text: string): boolean {
    return !!this.sel.view && !this.sel.hasMarkup && this.appliedText === null && text !== this.rawNow;
  }

  private applyWhole(text: string): void {
    const view = this.sel.view;
    if (!view || !view.replaceRange(this.sel.from, this.sel.from + this.rawNow.length, this.rawNow, text)) return;
    this.rawNow = text;
    this.to = this.sel.from + text.length;
    this.appliedText = text;
  }

  private candidateRow(parent: HTMLElement, c: ScoredCandidate, original: Measured, best: boolean): void {
    const item = parent.createDiv({ cls: "cci-proof-item" });
    item.createEl("blockquote", { cls: "cci-explain-quote", text: c.text });
    item.createDiv({ cls: "cci-explain-muted", text: describeGain(original, c) });
    if (c.change) item.createDiv({ cls: "cci-explain-muted", text: `What changes: ${c.change}` });
    const done = this.appliedText === c.text;
    const apply = item.createEl("button", { text: done ? "Applied ✓" : "Apply", cls: best && !done ? "mod-cta" : undefined });
    apply.disabled = done || !this.canReplaceWhole(c.text);
    if (!done && apply.disabled && this.sel.hasMarkup) apply.title = "This selection has formatting that a replacement would lose; copy the text instead.";
    apply.addEventListener("click", () => {
      this.applyWhole(c.text);
      this.renderSimplify();
    });
    const copy = item.createEl("button", { text: "Copy" });
    copy.addEventListener("click", () => void copyMarkdown(c.text, "Simpler text"));
  }

  private renderSimplify(): void {
    const out = this.simplified as SimplifyOutcome;
    this.heading(out.best ? "A simpler way to say it" : "Already about as simple as it gets");
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "cci-explain-muted", text: "Original" });
    contentEl.createEl("blockquote", { cls: "cci-explain-quote", text: this.sel.text });
    this.caveat();
    if (out.best) {
      contentEl.createEl("p", { cls: "cci-explain-muted", text: "Simplest, measured against HSK levels and the words you know" });
      this.candidateRow(contentEl.createDiv({ cls: "cci-proof-list" }), out.best, out.original, true);
    } else {
      contentEl.createEl("p", {
        text: out.ranked.length === 0 ? "No simpler way to say this was found." : "None of the rewrites uses easier words than the original.",
      });
      contentEl.createEl("p", { cls: "cci-explain-muted", text: "Simpler means fewer words you don't know yet, and easier ones." });
    }
    const others = out.ranked.filter((c) => c !== out.best);
    if (others.length > 0) {
      const more = contentEl.createEl("details", { cls: "cci-simplify-others" });
      more.createEl("summary", { text: out.best ? `Other ways to say it (${others.length})` : `The rewrites that were tried (${others.length})` });
      const rest = more.createDiv({ cls: "cci-proof-list" });
      for (const c of others) this.candidateRow(rest, c, out.original, false);
    }
    this.costLine();
    const bar = this.actions();
    this.button(bar, "Close", () => this.close());
    this.button(bar, "Regenerate", () => void this.run());
  }

  private async copyCorrected(placed: LocatedCorrection[]): Promise<void> {
    await copyMarkdown(applyCorrections(this.sel.text, placed), "Corrected text");
  }
}
