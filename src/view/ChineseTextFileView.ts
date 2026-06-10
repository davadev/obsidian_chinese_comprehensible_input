import { TextFileView, WorkspaceLeaf } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type CciPlugin from "../main";
import { VIEW_TYPE_CHINESE } from "../constants";
import { ViewToolbar } from "./ViewToolbar";
import { buildChineseDecorations, cciRedecorateEffect } from "../editor/chineseDecorations";
import { wordInteractionPlugin } from "../editor/wordInteractionPlugin";

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
  private editorContainer: HTMLElement | null = null;
  private editor: EditorView | null = null;
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
    return "book-open-check";
  }

  // TextFileView API ---------------------------------------------------

  getViewData(): string {
    if (!this.editor) return this.data;
    return this.frontmatterText + this.editor.state.doc.toString();
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    if (this.suppressNextSetData) {
      this.suppressNextSetData = false;
      return;
    }
    const split = splitFrontmatter(data);
    this.frontmatterText = split.frontmatter;
    const visible = split.body;
    // Best-effort: pre-warm the shared token cache for the new doc so the
    // decoration plugin's next build hits the cache instead of racing the
    // async tokenize. Fire-and-forget — the existing async path still
    // dispatchRedecorates when it lands.
    void this.plugin.tokenizer.tokenize(visible).catch(() => {});
    if (this.editor) {
      const current = this.editor.state.doc.toString();
      if (current !== visible) {
        this.editor.dispatch({
          changes: { from: 0, to: current.length, insert: visible },
        });
      }
    } else {
      this.ensureEditor(visible);
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
      () => this.editor?.state.doc.toString() ?? this.data ?? ""
    );

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
      requestAnimationFrame(() => {
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

  refreshToolbar(): void {
    this.toolbar?.refresh();
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
        wordInteractionPlugin(this.plugin),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            this.suppressNextSetData = true;
            this.requestSave();
            this.toolbar?.refresh();
          }
        }),
        EditorView.editable.of(this.plugin.activeViewMode() === "edit"),
      ],
    });
    this.editor = new EditorView({
      state,
      parent: this.editorContainer,
    });
  }

  reconfigureEditor(): void {
    if (!this.editor || !this.editorContainer) return;
    const data = this.editor.state.doc.toString();
    const selection = this.editor.state.selection.main;
    // Capture the document offset of the line at the top of the viewport.
    // Restoring by pixel scrollTop fails on display-mode change because the
    // new mode has a different line-height: the same scrollTop maps to a
    // different logical line. Restoring by document offset lands the user
    // on approximately the same line.
    let topOffset = 0;
    try {
      const block = this.editor.lineBlockAtHeight(
        this.editor.scrollDOM.scrollTop + 1
      );
      topOffset = block.from;
    } catch {
      topOffset = 0;
    }
    this.ensureEditor(data);
    if (this.editor) {
      try {
        const len = this.editor.state.doc.length;
        const anchor = Math.min(selection.anchor, len);
        const head = Math.min(selection.head, len);
        this.editor.dispatch({ selection: { anchor, head } });
      } catch {
        // selection restore is best-effort
      }
      const target = Math.min(topOffset, this.editor.state.doc.length);
      requestAnimationFrame(() => {
        try {
          this.editor?.dispatch({
            effects: EditorView.scrollIntoView(target, { y: "start" }),
          });
        } catch {
          // scroll restore is best-effort
        }
      });
    }
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
}
