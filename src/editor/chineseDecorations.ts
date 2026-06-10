import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type CciPlugin from "../main";
import { computeExcludedRanges, isRangeExcluded } from "./markdownExclusionRanges";
import { Token } from "../tokenizer/tokenizerTypes";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { CciSettings, DisplayMode } from "../settings/types";
import { hasCjk, shortenDefinition } from "../dictionary/normalizeChinese";

/**
 * Symbol passed via ViewPlugin's compartment-side facet to share the plugin instance.
 * We avoid a global by stashing it on EditorView state.
 */
export const PLUGIN_FIELD_KEY = "__cci_plugin__";

export function buildChineseDecorations(plugin: CciPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      lastTokens: Token[] = [];
      lastSourceVersion = -1;
      tokenPromise: Promise<void> | null = null;

      constructor(view: EditorView) {
        this.decorations = Decoration.none;
        this.scheduleTokenize(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.scheduleTokenize(update.view);
        }
      }

      scheduleTokenize(view: EditorView) {
        const text = view.state.doc.toString();
        const version = hash(text);
        if (version === this.lastSourceVersion && this.lastTokens.length > 0) {
          this.decorations = this.build(view, text, this.lastTokens);
          return;
        }
        if (this.tokenPromise) return;
        this.tokenPromise = (async () => {
          try {
            if (!hasCjk(text)) {
              this.lastTokens = [];
              this.lastSourceVersion = version;
              this.decorations = Decoration.none;
              view.dispatch({}); // poke
              return;
            }
            const tokens = await plugin.tokenizer.tokenize(text);
            this.lastTokens = tokens;
            this.lastSourceVersion = version;
            this.decorations = this.build(view, text, tokens);
            view.dispatch({});
          } finally {
            this.tokenPromise = null;
          }
        })();
      }

      build(view: EditorView, text: string, tokens: Token[]): DecorationSet {
        const settings = plugin.settings;
        const exclusions = computeExcludedRanges(text);
        const builder = new RangeSetBuilder<Decoration>();
        const ranges = view.visibleRanges;
        for (const range of ranges) {
          for (const tok of tokens) {
            if (tok.end <= range.from) continue;
            if (tok.start >= range.to) break;
            if (!tok.isWord || tok.candidates.length === 0) continue;
            if (isRangeExcluded(exclusions, tok.start, tok.end)) continue;
            this.emitDecoration(builder, tok, settings, plugin);
          }
        }
        return builder.finish();
      }

      emitDecoration(
        builder: RangeSetBuilder<Decoration>,
        tok: Token,
        settings: CciSettings,
        plugin: CciPlugin
      ) {
        const rec = plugin.vocab.bySurface(tok.surface);
        const status: WordStatus = rec?.status ?? "new";
        if (status === "ignored") return;

        const mode = settings.defaultDisplayMode;
        const showColor =
          (status === "known" && settings.showKnownColor) ||
          (status === "unknown" && settings.showUnknownColor) ||
          ((status === "meaningKnownPinyinUnknown" || status === "pinyinKnownMeaningUnknown") &&
            settings.showPartialColor) ||
          status === "new";

        // Inline ruby modes wrap word as a replacing widget so pinyin/gloss appear above.
        const wantsRuby =
          (mode === "two-line" || mode === "three-line") &&
          (status === "unknown" ||
            status === "meaningKnownPinyinUnknown" ||
            status === "pinyinKnownMeaningUnknown" ||
            (status === "new" && settings.newWordBehavior === "annotate"));

        if (wantsRuby) {
          builder.add(
            tok.start,
            tok.end,
            Decoration.replace({
              widget: new RubyWidget(tok.surface, tok, rec, mode, settings),
              inclusive: false,
            })
          );
          return;
        }

        if (showColor || mode === "popup-only" || mode === "color-only") {
          builder.add(
            tok.start,
            tok.end,
            Decoration.mark({
              class: `cci-word cci-status-${status}`,
              attributes: {
                "data-cci-surface": tok.surface,
                "data-cci-status": status,
              },
            })
          );
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

class RubyWidget extends WidgetType {
  constructor(
    private surface: string,
    private tok: Token,
    private rec: WordRecord | undefined,
    private mode: DisplayMode,
    private settings: CciSettings
  ) {
    super();
  }

  eq(other: RubyWidget): boolean {
    return (
      other.surface === this.surface &&
      other.mode === this.mode &&
      other.rec?.status === this.rec?.status
    );
  }

  toDOM(): HTMLElement {
    const status = this.rec?.status ?? "new";
    const ruby = document.createElement("ruby");
    ruby.className = `cci-ruby cci-word cci-status-${status}`;
    ruby.setAttribute("data-cci-surface", this.surface);
    ruby.setAttribute("data-cci-status", status);

    ruby.appendChild(document.createTextNode(this.surface));

    const pinyin = this.tok.selected?.pinyin ?? this.rec?.pinyin ?? "";
    if (pinyin && status !== "pinyinKnownMeaningUnknown") {
      const rt = document.createElement("rt");
      rt.textContent = formatPinyin(pinyin, this.settings.pinyinStyle);
      ruby.appendChild(rt);
    }

    if (this.mode === "three-line" && status !== "meaningKnownPinyinUnknown") {
      const def = this.tok.selected?.definitions?.[0] ?? this.rec?.definitions?.[0] ?? "";
      if (def) {
        const rt2 = document.createElement("rt");
        rt2.textContent = shortenDefinition(def, 24);
        rt2.className = "cci-gloss";
        ruby.appendChild(rt2);
      }
    }

    return ruby;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function formatPinyin(p: string, style: CciSettings["pinyinStyle"]): string {
  if (style === "none") return "";
  if (style === "marks") return p;
  // Numbers — reuse normalizer from dictionary module
  // (lazy import to avoid circular).
  const { toneMarksToNumbers } = require("../dictionary/normalizeChinese");
  return toneMarksToNumbers(p);
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
