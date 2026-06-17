import { Notice, TextFileView, WorkspaceLeaf } from "obsidian";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type CciPlugin from "../main";
import { VIEW_TYPE_CHINESE } from "../constants";
import { ViewToolbar } from "./ViewToolbar";
import { buildChineseDecorations, cciRedecorateEffect, cciReTokenizeEffect } from "../editor/chineseDecorations";
import { wordInteractionPlugin } from "../editor/wordInteractionPlugin";
import { buildMarkdownRendering, markdownLinkClickHandler } from "../editor/markdownRendering";

/**
 * Markdown syntax highlighting tuned for the Chinese reader.
 * Larger headings, bold/italic, code dim, list markers de-emphasized.
 */
const cciMarkdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.7em", fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading2, fontSize: "1.45em", fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading3, fontSize: "1.25em", fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading4, fontSize: "1.1em", fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading5, fontSize: "1em", fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading6, fontSize: "1em", fontWeight: "700", color: "var(--text-muted)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-muted)" },
  { tag: t.link, color: "var(--text-accent)" },
  { tag: t.url, color: "var(--text-accent)" },
  { tag: t.monospace, fontFamily: "var(--font-monospace, ui-monospace, monospace)", background: "var(--background-secondary)" },
  { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--text-muted)" },
  { tag: t.processingInstruction, color: "var(--text-faint)" }, // markdown markers like # *
]);

/**
 * Splits a Markdown file's YAML `---` … `---` frontmatter from its body.
 * Returns `{ frontmatter: "", body: data }` when no frontmatter is present.
 * The closing newline after the second `---` is included in `frontmatter`
 * so the body starts cleanly. Pure string ops — no CM6 dependency.
 */
function splitFrontmatter(data: string): { frontmatter: string; body: string } {
  if (!data.startsWith("---")) return { frontmatter: "", body: data };
  const firstNL = data.indexOf("\n");
  if (firstNL === -1) return { frontmatter: "", body: data };
  if (data.substring(0, firstNL).trim() !== "---") return { frontmatter: "", body: data };
  let pos = firstNL + 1;
  for (let i = 0; i < 200 && pos <= data.length; i++) {
    const nextNL = data.indexOf("\n", pos);
    const lineEnd = nextNL === -1 ? data.length : nextNL;
    if (data.substring(pos, lineEnd).trim() === "---") {
      const cut = nextNL === -1 ? data.length : nextNL + 1;
      return { frontmatter: data.substring(0, cut), body: data.substring(cut) };
    }
    if (nextNL === -1) break;
    pos = nextNL + 1;
  }
  return { frontmatter: "", body: data };
}

/**
 * Custom view that owns its own CodeMirror 6 editor pointed at the underlying
 * Markdown file. Extends TextFileView so Obsidian wires save/load and the
 * file lifecycle correctly across mobile and desktop.
 */
export class ChineseTextFileView extends TextFileView {
  private toolbar: ViewToolbar | null = null;
  private previewActionsEl: HTMLElement | null = null;
  private editorContainer: HTMLElement | null = null;
  private editor: EditorView | null = null;
  private editableComp = new Compartment();
  private suppressNextSetData = false;
  /**
   * YAML frontmatter is stripped before reaching the editor and re-prefixed
   * on save. The editor never sees the `---` … `---` block, which keeps the
   * Chinese decoration pipeline simple and avoids the CM6 layout breakage
   * that plagued the in-editor hide attempts (0.1.13 / 0.1.14).
   */
  private frontmatterText = "";

  constructor(leaf: WorkspaceLeaf, private plugin: CciPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CHINESE;
  }

  getDisplayText(): string {
    return this.file ? `中文: ${this.file.basename}` : "Chinese Learning";
  }

  getIcon(): string {
    return "cci-zhong";
  }

  // TextFileView API ---------------------------------------------------

  getViewData(): string {
    if (!this.editor) return this.data;
    return this.frontmatterText + this.editor.state.doc.toString();
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.refreshPreviewActions();
    if (this.suppressNextSetData) {
      this.suppressNextSetData = false;
      return;
    }
    const split = splitFrontmatter(data);
    this.frontmatterText = split.frontmatter;
    void this.swapDocContent(split.body);
  }

  /**
   * Replace the editor's document with the new file's body. We must
   * pre-warm the tokenizer BEFORE dispatching so the Chinese decoration
   * plugin's synchronous build path hits a populated cache for the new
   * content. Then dispatch the doc change together with
   * `cciRedecorateEffect` so both decoration plugins rebuild against the
   * new content immediately — otherwise an in-flight tokenize from the
   * previous file can leave `this.tokenPromise` non-null and the new
   * doc's scheduleTokenize is skipped. This was the bug where clicking
   * a wikilink loaded the target text but left it unannotated.
   */
  private async swapDocContent(visible: string): Promise<void> {
    if (!this.editor) {
      this.ensureEditor(visible);
      return;
    }
    try {
      await this.plugin.tokenizer.tokenize(visible);
    } catch {
      // dictionary not ready — the existing async path will still
      // dispatchRedecorate when tokens land.
    }
    if (!this.editor) return;
    const current = this.editor.state.doc.toString();
    if (current !== visible) {
      this.editor.dispatch({
        changes: { from: 0, to: current.length, insert: visible },
        effects: cciRedecorateEffect.of(null),
      });
    } else {
      this.editor.dispatch({ effects: cciRedecorateEffect.of(null) });
    }
  }

  clear(): void {
    this.frontmatterText = "";
    if (this.editor) {
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: "" },
      });
    }
  }

  // Lifecycle ----------------------------------------------------------

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.containerEl.children[1].addClass("cci-view");
    this.applyReaderFont();
    this.applyDisplayAttr();

    const top = this.containerEl.children[1].createDiv({ cls: "cci-toolbar-wrap" });
    this.toolbar = new ViewToolbar(
      this.plugin,
      top,
      () => this.handleToolbarChange(),
      () => this.editor?.state.doc.toString() ?? this.data ?? "",
      (surface) => void this.openAddCustomWord(surface)
    );
    this.previewActionsEl = this.containerEl.children[1].createDiv({ cls: "cci-preview-actions" });
    this.refreshPreviewActions();

    this.editorContainer = this.containerEl.children[1].createDiv({ cls: "cci-editor" });
    const split = splitFrontmatter(this.data ?? "");
    this.frontmatterText = split.frontmatter;
    // Pre-warm the shared token cache BEFORE creating the editor. The
    // decoration ViewPlugin's constructor reads the cache synchronously and
    // builds decorations in time for the first paint, so the user sees
    // annotations on first open without having to toggle the display mode.
    try {
      await this.plugin.tokenizer.tokenize(split.body);
    } catch {
      // tokenizer not ready (no dictionary yet) — the ViewPlugin will fall
      // back to its async path and dispatchRedecorate when it finishes
    }
    this.ensureEditor(split.body);
    this.refreshPreviewActions();

    // Header action next to the standard view controls — single-tap path to
    // Obsidian's Markdown view in edit mode. Matches the affordance position
    // of Obsidian's own read/edit toggle on MarkdownView.
    this.addAction("pencil", "Edit in Markdown", () => void this.openAsRegularMarkdown(true));
  }

  /**
   * Display-mode / font toggle from the toolbar. Does NOT rebuild the
   * editor — that path destroys the EditorView and races CM6's first
   * measure on rebuild, which is what kept losing the scroll position.
   * Instead: capture the topmost-visible doc offset, change CSS + ask
   * the decoration plugin to redecorate, then scroll the captured
   * offset back to the top of the viewport on the next frame.
   */
  private handleToolbarChange(): void {
    let topOffset = 0;
    if (this.editor) {
      try {
        topOffset = this.editor.lineBlockAtHeight(
          this.editor.scrollDOM.scrollTop + 1
        ).from;
      } catch {
        topOffset = 0;
      }
    }
    this.applyReaderFont();
    this.applyDisplayAttr();
    this.redecorate();
    this.toolbar?.refresh();
    if (this.editor) {
      const target = Math.min(topOffset, this.editor.state.doc.length);
      window.requestAnimationFrame(() => {
        try {
          this.editor?.dispatch({
            effects: EditorView.scrollIntoView(target, { y: "start" }),
          });
        } catch {
          // best-effort
        }
      });
    }
  }

  applyReaderFont(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    const px = Math.max(12, Math.min(48, this.plugin.settings.readerFontPx ?? 22));
    root.style.setProperty("--cci-reader-font", `${px}px`);
  }

  applyDisplayAttr(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.setAttribute("data-display", this.plugin.settings.defaultDisplayMode);
  }

  async onClose(): Promise<void> {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    this.plugin.exposure.resetSession();
  }

  /** Toolbar callback — opens the EditDictionaryModal in custom-word mode. */
  private async openAddCustomWord(surface: string): Promise<void> {
    const cleaned = surface.replace(/\s+/g, "");
    if (!cleaned) {
      new Notice("Select one or more Chinese characters first.");
      return;
    }
    const { EditDictionaryModal } = await import("../ui/EditDictionaryModal");
    const existing = this.plugin.dictionaryCustomWords[cleaned];
    new EditDictionaryModal(this.plugin.app, this.plugin, {
      mode: "custom",
      surface: cleaned,
      isExistingCustom: !!existing,
      initial: existing
        ? {
            traditional: existing.traditional,
            pinyin: existing.pinyin,
            definitions: existing.definitions,
            hskLevel: existing.hsk?.levels?.[0],
          }
        : { pinyin: this.guessPinyinForSurface(cleaned) },
    }).open();
  }

  /**
   * Build a best-effort pinyin pre-fill by looking up each character in
   * the dictionary and concatenating the top entry's pinyin. The user can
   * still overwrite the field; this only saves typing for the common case
   * (proper names whose characters are individually in the dictionary).
   */
  private guessPinyinForSurface(surface: string): string {
    // If the whole surface already resolves to a dictionary entry, use it.
    const whole = this.plugin.dictionary.lookup(surface)[0];
    if (whole?.pinyin) return whole.pinyin;
    const parts: string[] = [];
    for (const ch of Array.from(surface)) {
      const entry = this.plugin.dictionary.lookup(ch)[0];
      if (entry?.pinyin) parts.push(entry.pinyin);
    }
    return parts.join(" ");
  }

  /**
   * Swap the current leaf to Obsidian's built-in Markdown editor on the
   * same file. To come back, the user hits the "Open in Chinese
   * Learning View" ribbon icon (registered in main.ts onload).
   */
  private async openAsRegularMarkdown(editMode = false): Promise<void> {
    const file = this.file;
    if (!file) return;
    await this.leaf.setViewState({
      type: "markdown",
      state: editMode ? { file: file.path, mode: "source" } : { file: file.path },
    });
  }

  refreshToolbar(): void {
    this.toolbar?.refresh();
    this.refreshPreviewActions();
  }

  private refreshPreviewActions(): void {
    const host = this.previewActionsEl;
    if (!host) return;
    host.empty();
    const file = this.file;
    if (!file || file.path !== this.plugin.story.previewPath()) return;

    host.createSpan({ cls: "cci-preview-actions-label", text: "Unsaved smart story preview" });
    const save = host.createEl("button", { text: "Save as note" });
    save.addEventListener("click", () => {
      void (async () => {
      try {
        const saved = await this.plugin.story.commitPreviewAsNote({
          story: { textChinese: "", title: "", targetLevel: "", glossary: [], targetWordsUsed: [] },
          targets: [],
          targetHsk: "0",
          score: 0,
          file,
          iterations: 0,
        });
        new Notice(`Saved to ${saved.path}.`);
        await this.plugin.openFileInChineseView(saved);
      } catch (err) {
        new Notice("Save failed: " + (err as Error).message);
      }
      })();
    });

    const discard = host.createEl("button", { text: "Discard" });
    discard.addEventListener("click", () => {
      void (async () => {
      try {
        await this.plugin.app.fileManager.trashFile(file);
      } catch {
        // best-effort: file may already be gone
      }
      await this.openSmartStories();
      })();
    });

    const regen = host.createEl("button", { text: "Generate again" });
    regen.addEventListener("click", () => {
      void (async () => {
      regen.setAttribute("disabled", "true");
      regen.setText("Generating...");
      try {
        await this.plugin.story.deletePreview({
          story: { textChinese: "", title: "", targetLevel: "", glossary: [], targetWordsUsed: [] },
          targets: [],
          targetHsk: "0",
          score: 0,
          file,
          iterations: 0,
        });
        const settings = this.plugin.settings;
        const preview = await this.plugin.story.generatePreview({
          dueCount: settings.story.defaultDueCount,
          lengthChars: settings.story.defaultLengthChars,
          style: settings.story.defaultStyle,
          targetHsk: "auto",
          includeGlossary: settings.story.includeGlossary,
        });
        await this.plugin.openFileInChineseView(preview.file);
      } catch (err) {
        new Notice("Generation failed: " + (err as Error).message);
        regen.setText("Generate again");
        regen.removeAttribute("disabled");
      }
      })();
    });

    const back = host.createEl("button", { text: "Back to Smart stories" });
    back.addEventListener("click", () => void this.openSmartStories());
  }

  private async openSmartStories(): Promise<void> {
    this.plugin.settings.flashcardsMode = "smart";
    await this.plugin.saveSettings();
    await this.plugin.openStatsView();
  }

  private ensureEditor(initialDoc: string): void {
    if (!this.editorContainer) return;
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(cciMarkdownHighlight),
        buildChineseDecorations(this.plugin),
        buildMarkdownRendering(this.plugin),
        markdownLinkClickHandler(this.plugin),
        wordInteractionPlugin(this.plugin),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          // Only treat USER-originated edits as save triggers. Programmatic
          // dispatches (clear() before a file load, setViewData applying
          // new file contents, our own redecorate effects) carry no
          // userEvent annotation and must not write to disk — otherwise
          // a file load will save empty content over the new file before
          // setViewData has had a chance to inject it. That bug surfaced
          // when wikilink clicks started routing through
          // openFileInChineseView and overwrote the target file.
          const userEdit = u.transactions.some(
            (tr) => typeof tr.annotation === "function" && tr.annotation(Transaction.userEvent)
          );
          if (!userEdit) {
            this.toolbar?.refresh();
            return;
          }
          this.suppressNextSetData = true;
          this.requestSave();
          this.toolbar?.refresh();
        }),
        this.editableComp.of(EditorView.editable.of(this.plugin.activeViewMode() === "edit")),
      ],
    });
    this.editor = new EditorView({
      state,
      parent: this.editorContainer,
    });
  }

  reconfigureEditor(): void {
    if (!this.editor) return;
    let topOffset = 0;
    try {
      topOffset = this.editor.lineBlockAtHeight(
        this.editor.scrollDOM.scrollTop + 1
      ).from;
    } catch {
      topOffset = 0;
    }
    const editable = this.plugin.activeViewMode() === "edit";
    this.editor.dispatch({
      effects: [
        this.editableComp.reconfigure(EditorView.editable.of(editable)),
        cciRedecorateEffect.of(null),
      ],
    });
    const target = Math.min(topOffset, this.editor.state.doc.length);
    window.requestAnimationFrame(() => {
      try {
        this.editor?.dispatch({
          effects: EditorView.scrollIntoView(target, { y: "start" }),
        });
      } catch {
        // scroll restore is best-effort
      }
    });
  }

  /**
   * Lightweight redraw that does NOT rebuild the editor — used after status
   * changes (mark known/unknown) so the user's scroll position is preserved.
   * Forces the decoration view-plugin to recompute by dispatching an empty
   * transaction; the plugin's `update()` runs on every transaction.
   */
  redecorate(): void {
    if (!this.editor) return;
    this.editor.dispatch({ effects: cciRedecorateEffect.of(null) });
  }

  /** Drop cached tokens and force a fresh tokenization on next decoration build. */
  forceRetokenize(): void {
    if (!this.editor) return;
    this.editor.dispatch({ effects: cciReTokenizeEffect.of(null) });
  }
}
