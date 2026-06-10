import { TextFileView, WorkspaceLeaf } from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type CciPlugin from "../main";
import { VIEW_TYPE_CHINESE } from "../constants";
import { ViewToolbar } from "./ViewToolbar";
import { buildChineseDecorations, cciRedecorateEffect } from "../editor/chineseDecorations";
import { wordInteractionPlugin } from "../editor/wordInteractionPlugin";

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
    return this.editor.state.doc.toString();
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    if (this.suppressNextSetData) {
      this.suppressNextSetData = false;
      return;
    }
    if (this.editor) {
      const current = this.editor.state.doc.toString();
      if (current !== data) {
        this.editor.dispatch({
          changes: { from: 0, to: current.length, insert: data },
        });
      }
    } else {
      this.ensureEditor(data);
    }
  }

  clear(): void {
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
    this.toolbar = new ViewToolbar(this.plugin, top, () => {
      this.applyReaderFont();
      this.applyDisplayAttr();
      this.reconfigureEditor();
    });

    this.editorContainer = this.containerEl.children[1].createDiv({ cls: "cci-editor" });
    this.ensureEditor(this.data ?? "");
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
        buildChineseDecorations(this.plugin),
        wordInteractionPlugin(this.plugin),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            this.suppressNextSetData = true;
            this.requestSave();
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
    const scrollTop = this.editor.scrollDOM.scrollTop;
    const selection = this.editor.state.selection.main;
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
      // Restore scroll after layout settles.
      requestAnimationFrame(() => {
        if (this.editor) this.editor.scrollDOM.scrollTop = scrollTop;
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
