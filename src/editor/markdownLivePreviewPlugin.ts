import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

/**
 * Visual styling for Obsidian-flavoured markdown elements that
 * `@codemirror/lang-markdown` doesn't handle:
 *
 *  - YAML frontmatter ( leading `---` block ) → line class for dim styling
 *  - Obsidian wikilinks `[[note]]` and embeds `![[asset]]` → mark decoration
 *
 * Deliberately does NOT hide any markdown markers — earlier versions of
 * this plugin attempted a "live preview lite" that hid `#`, `*`, etc.
 * on lines without the cursor; that turned out to interact badly with
 * the Chinese annotation widgets, so it's been removed.
 */
const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

export function markdownLivePreviewPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = this.build(u.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const { state } = view;
        const frontmatter = detectFrontmatter(view);

        // Collect (lineNo, line-decoration) and (range, mark) entries
        // then emit them in source order so RangeSetBuilder stays happy.
        type Entry = { from: number; to: number; deco: Decoration };
        const entries: Entry[] = [];

        if (frontmatter) {
          for (let i = frontmatter.startLine; i <= frontmatter.endLine; i++) {
            const line = state.doc.line(i);
            entries.push({
              from: line.from,
              to: line.from,
              deco: Decoration.line({ class: "cci-frontmatter-line" }),
            });
          }
        }

        for (const range of view.visibleRanges) {
          const text = state.doc.sliceString(range.from, range.to);
          WIKILINK_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = WIKILINK_RE.exec(text))) {
            const start = range.from + m.index;
            const end = start + m[0].length;
            const isEmbed = m[1] === "!";
            entries.push({
              from: start,
              to: end,
              deco: Decoration.mark({
                class: isEmbed ? "cci-md-embed" : "cci-md-wikilink",
                attributes: { "data-cci-target": m[2] },
              }),
            });
          }
        }

        entries.sort((a, b) => {
          if (a.from !== b.from) return a.from - b.from;
          // Line decorations (from === to) before mark decorations
          if (a.from === a.to && b.from !== b.to) return -1;
          if (a.from !== a.to && b.from === b.to) return 1;
          return 0;
        });

        for (const e of entries) builder.add(e.from, e.to, e.deco);
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
