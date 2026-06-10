import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

/**
 * Markdown "live preview lite":
 *   - Hides markdown markers ( #  *  _  >  -  `  ~ ) on every line that
 *     does NOT currently contain the cursor or selection. Editing a line
 *     reveals its markers again.
 *   - Marks YAML frontmatter ( leading --- block --- ) with a `cm-line`
 *     class so it can be styled like Obsidian's default callout-ish view.
 */
const MARKER_NODE_NAMES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "QuoteMark",
  "LinkMark",
  "StrikethroughMark",
  "ListMark",
  "URL", // URL inside autolinks
]);

export function markdownLivePreviewPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = this.build(u.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const { state } = view;
        const cursorLine = state.doc.lineAt(state.selection.main.head).number;

        const frontmatter = detectFrontmatter(view);

        // Emit decorations in source order: line decorations at line.from,
        // then range decorations within the line.
        const lineMarkers = new Map<number, { from: number; to: number }[]>();
        if (frontmatter) {
          for (const range of view.visibleRanges) {
            // Annotated frontmatter line class is emitted later in order.
            void range;
          }
        }

        try {
          for (const range of view.visibleRanges) {
            syntaxTree(state).iterate({
              from: range.from,
              to: range.to,
              enter: (node) => {
                if (!MARKER_NODE_NAMES.has(node.name)) return;
                const lineNo = state.doc.lineAt(node.from).number;
                if (lineNo === cursorLine) return;
                // Skip hiding URL inside [text](url): leave the markers
                // intact when inside selection's line; otherwise hide the
                // raw URL. (CM6 + Obsidian default: URL hidden too.)
                const list = lineMarkers.get(lineNo) ?? [];
                list.push({ from: node.from, to: node.to });
                lineMarkers.set(lineNo, list);
              },
            });
          }
        } catch {
          // syntaxTree might not be ready on first render; skip silently.
        }

        // Collect per-line work and emit in document order.
        const linesWithWork = new Set<number>();
        for (const ln of lineMarkers.keys()) linesWithWork.add(ln);
        if (frontmatter) {
          for (let i = frontmatter.startLine; i <= frontmatter.endLine; i++) linesWithWork.add(i);
        }
        const sortedLines = Array.from(linesWithWork).sort((a, b) => a - b);

        for (const ln of sortedLines) {
          const line = state.doc.line(ln);
          if (frontmatter && ln >= frontmatter.startLine && ln <= frontmatter.endLine) {
            builder.add(line.from, line.from, Decoration.line({ class: "cci-frontmatter-line" }));
          }
          const markers = lineMarkers.get(ln);
          if (!markers) continue;
          markers.sort((a, b) => a.from - b.from);
          for (const m of markers) {
            // Also swallow a single trailing space after a HeaderMark, so
            // "# Title" cleanly becomes "Title" when the marker hides.
            let to = m.to;
            if (state.doc.sliceString(to, to + 1) === " ") to += 1;
            builder.add(m.from, to, Decoration.replace({}));
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * Detect a YAML-ish frontmatter block: file starts with `---` on the
 * first non-empty line and has a matching closing `---` within the first
 * 80 lines.
 */
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
