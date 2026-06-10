import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

/**
 * Visual styling for Obsidian-flavoured links inside the Chinese Learning
 * View. Strictly mark decorations — does NOT replace content, hide
 * markers, or interact with the Chinese annotation widget.
 *
 *   [[wikilink]]   → `cci-md-wikilink`
 *   [[link|alias]] → `cci-md-wikilink`
 *   ![[embed]]     → `cci-md-embed`
 */
const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

export function wikilinkPlugin() {
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
        try {
          for (const range of view.visibleRanges) {
            const text = view.state.doc.sliceString(range.from, range.to);
            WIKILINK_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            const hits: { from: number; to: number; isEmbed: boolean; target: string }[] = [];
            while ((m = WIKILINK_RE.exec(text))) {
              hits.push({
                from: range.from + m.index,
                to: range.from + m.index + m[0].length,
                isEmbed: m[1] === "!",
                target: m[2],
              });
            }
            for (const h of hits) {
              builder.add(
                h.from,
                h.to,
                Decoration.mark({
                  class: h.isEmbed ? "cci-md-embed" : "cci-md-wikilink",
                  attributes: { "data-cci-target": h.target },
                })
              );
            }
          }
        } catch {
          // Be silent — never let this plugin block the editor.
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
