import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

/**
 * Styles the YAML-style frontmatter block (leading `---` … `---`) with a
 * line class so it renders as a dim monospace strip. Strictly emits
 * `Decoration.line` ranges — no content replacement, no marker hiding,
 * no interaction with the Chinese annotation widget.
 */
export function frontmatterPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate) {
        if (u.docChanged) {
          this.decorations = this.build(u.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        try {
          const range = detectFrontmatter(view);
          if (!range) return builder.finish();
          for (let i = range.startLine; i <= range.endLine; i++) {
            const line = view.state.doc.line(i);
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: "cci-frontmatter-line" })
            );
          }
        } catch {
          // Defensive: never block the editor.
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

function detectFrontmatter(view: EditorView): { startLine: number; endLine: number } | null {
  const doc = view.state.doc;
  if (doc.lines === 0) return null;
  const first = doc.line(1);
  if (first.text.trim() !== "---") return null;
  const max = Math.min(80, doc.lines);
  for (let i = 2; i <= max; i++) {
    const line = doc.line(i);
    if (line.text.trim() === "---") {
      return { startLine: 1, endLine: i };
    }
  }
  return null;
}
