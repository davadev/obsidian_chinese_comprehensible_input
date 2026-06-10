import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";

/** Dispatch this effect to make the decoration plugin recompute without rebuilding the editor. */
export const cciRedecorateEffect = StateEffect.define<null>();
import type CciPlugin from "../main";
import { computeExcludedRanges, isRangeExcluded } from "./markdownExclusionRanges";
import { Token } from "../tokenizer/tokenizerTypes";
import { ColorState, KnownAxes, WordRecord } from "../vocabulary/VocabularyTypes";
import { CciSettings, DisplayMode } from "../settings/types";
import { hasCjk, shortenDefinition } from "../dictionary/normalizeChinese";
import { axesFromStatus, colorOf } from "../vocabulary/axes";

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
        const redecorate = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(cciRedecorateEffect))
        );
        if (update.docChanged || update.viewportChanged || redecorate) {
          if (redecorate) {
            // Reuse cached tokens; only rebuild decorations against new state.
            if (this.lastTokens.length > 0) {
              this.decorations = this.build(update.view, update.view.state.doc.toString(), this.lastTokens);
              return;
            }
          }
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
        const color: ColorState = colorOf(rec);
        if (color === "ignored") return;

        const editMode = plugin.activeViewMode() === "edit";
        // In edit mode we must NOT replace text with widgets; otherwise typing
        // and cursor placement break. Apply only a plain mark decoration so
        // the colour highlight remains but characters stay editable.
        const mode = editMode ? "popup-only" : settings.defaultDisplayMode;

        const showColor = colorShouldShow(color, settings);

        const wantsRuby =
          (mode === "two-line" || mode === "three-line") && color !== "known";

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
              class: `cci-word cci-color-${color}`,
              attributes: {
                "data-cci-surface": tok.surface,
                "data-cci-color": color,
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
      colorOf(other.rec) === colorOf(this.rec) &&
      sameAxes(other.rec, this.rec)
    );
  }

  toDOM(): HTMLElement {
    const color = colorOf(this.rec);
    const axes: KnownAxes =
      this.rec?.axes ?? axesFromStatus(this.rec?.status ?? "new") ?? { chars: false, pinyin: false, meaning: false };
    const pinyin = this.tok.selected?.pinyin ?? this.rec?.pinyin ?? "";
    // Decide what inline info to show. Logic:
    //   - if pinyin axis unknown → show pinyin
    //   - if chars axis unknown (but meaning known via pinyin) → still show pinyin for char-recognition aid
    //   - if meaning axis unknown → show gloss (3-line only)
    //   - default for `new` (no record yet) → show everything.
    const isNew = !this.rec || this.rec.status === "new";
    const showPinyin = isNew || !axes.pinyin || !axes.chars;
    const showGloss =
      this.mode === "three-line" && (isNew || !axes.meaning);
    const def = showGloss
      ? this.tok.selected?.definitions?.[0] ?? this.rec?.definitions?.[0] ?? ""
      : "";

    if (this.mode === "three-line") {
      // Native <ruby> with two <rt> elements renders side-by-side in
      // WebKit/Chromium, so for 3-line we build a vertical inline-flex stack
      // by hand: gloss → pinyin → chars (top to bottom).
      const stack = document.createElement("span");
      stack.className = `cci-stack cci-word cci-color-${color}`;
      stack.setAttribute("data-cci-surface", this.surface);
      stack.setAttribute("data-cci-color", color);

      if (def) {
        const g = stack.createSpan({ cls: "cci-stack-gloss" });
        g.textContent = shortenDefinition(def, 24);
      }
      if (showPinyin && pinyin) {
        const p = stack.createSpan({ cls: "cci-stack-pinyin" });
        p.textContent = formatPinyin(pinyin, this.settings.pinyinStyle);
      }
      const c = stack.createSpan({ cls: "cci-stack-chars" });
      c.textContent = this.surface;
      return stack;
    }

    // 2-line — native ruby works fine for a single rt.
    const ruby = document.createElement("ruby");
    ruby.className = `cci-ruby cci-word cci-color-${color}`;
    ruby.setAttribute("data-cci-surface", this.surface);
    ruby.setAttribute("data-cci-color", color);
    ruby.appendChild(document.createTextNode(this.surface));
    if (showPinyin && pinyin) {
      const rt = document.createElement("rt");
      rt.textContent = formatPinyin(pinyin, this.settings.pinyinStyle);
      ruby.appendChild(rt);
    }
    return ruby;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function sameAxes(a: WordRecord | undefined, b: WordRecord | undefined): boolean {
  const ax = a?.axes ?? axesFromStatus(a?.status ?? "new");
  const bx = b?.axes ?? axesFromStatus(b?.status ?? "new");
  if (!ax && !bx) return true;
  if (!ax || !bx) return false;
  return ax.chars === bx.chars && ax.pinyin === bx.pinyin && ax.meaning === bx.meaning;
}

function colorShouldShow(color: ColorState, settings: CciSettings): boolean {
  if (color === "known") return settings.showKnownColor;
  if (color === "partial") return settings.showPartialColor;
  if (color === "unknown") return settings.showUnknownColor;
  if (color === "new") return true;
  return false;
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
