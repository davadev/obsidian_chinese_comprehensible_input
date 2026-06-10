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
              view.dispatch({ effects: cciRedecorateEffect.of(null) });
              return;
            }
            const tokens = await plugin.tokenizer.tokenize(text);
            this.lastTokens = tokens;
            this.lastSourceVersion = version;
            this.decorations = this.build(view, text, tokens);
            // Tell CM6 to re-render: a plain empty transaction is treated
            // as a no-op, so we dispatch our redecorate effect.
            view.dispatch({ effects: cciRedecorateEffect.of(null) });
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

/**
 * Widget that renders one annotated word.
 *
 * Constructor captures a *snapshot* of the rendered state (color, axes,
 * pinyin, gloss) so that CM6's `eq()` check can compare primitives rather
 * than chase the live WordRecord that the vocabulary store mutates in
 * place — otherwise both widgets would see the same up-to-date record and
 * the DOM would not refresh after a status change.
 */
class RubyWidget extends WidgetType {
  private readonly color: ColorState;
  private readonly axes: KnownAxes;
  private readonly pinyin: string;
  private readonly def: string;
  private readonly showPinyin: boolean;
  private readonly showGloss: boolean;

  constructor(
    private surface: string,
    tok: Token,
    rec: WordRecord | undefined,
    private mode: DisplayMode,
    private settings: CciSettings
  ) {
    super();
    this.color = colorOf(rec);
    this.axes = rec?.axes ?? axesFromStatus(rec?.status ?? "new") ?? { chars: false, pinyin: false, meaning: false };
    const isNew = !rec || rec.status === "new";
    this.pinyin = tok.selected?.pinyin ?? rec?.pinyin ?? "";
    this.showPinyin = isNew || !this.axes.pinyin || !this.axes.chars;
    this.showGloss = mode === "three-line" && (isNew || !this.axes.meaning);
    this.def = this.showGloss
      ? tok.selected?.definitions?.[0] ?? rec?.definitions?.[0] ?? ""
      : "";
  }

  eq(other: RubyWidget): boolean {
    return (
      other.surface === this.surface &&
      other.mode === this.mode &&
      other.color === this.color &&
      other.axes.chars === this.axes.chars &&
      other.axes.pinyin === this.axes.pinyin &&
      other.axes.meaning === this.axes.meaning &&
      other.pinyin === this.pinyin &&
      other.def === this.def
    );
  }

  toDOM(): HTMLElement {
    /*
     * Layout:
     *
     *   <span class="cci-stack">                       inline-block, baseline = chars baseline
     *     <span class="cci-stack-gloss">English</span> block, drives word width if wider
     *     <span class="cci-stack-cells">               block, white-space: nowrap
     *       <span class="cci-stack-cell">              inline-block
     *         <span class="cci-stack-pinyin">pīn</span> block, centered above char
     *         <span class="cci-stack-chars">字</span>   block
     *       </span>
     *       ...
     *     </span>
     *   </span>
     *
     * Because the chars row is the LAST in-flow block inside the inline-
     * block `.cci-stack`, that's the baseline CM6/Chromium reports for the
     * inline-block — so the chars row sits on the same baseline as plain
     * surrounding text. The gloss row, if present, pushes the inline-block
     * wider when its content is longer than the chars row, naturally
     * spacing words apart so glosses do not overlap their neighbors.
     */
    const stack = document.createElement("span");
    stack.className = `cci-stack cci-word cci-color-${this.color}`;
    stack.setAttribute("data-cci-surface", this.surface);
    stack.setAttribute("data-cci-color", this.color);

    if (this.showGloss && this.def) {
      const g = stack.createSpan({ cls: "cci-stack-gloss" });
      g.textContent = shortenDefinition(this.def, 28);
    }

    const cells = stack.createSpan({ cls: "cci-stack-cells" });
    const chars = Array.from(this.surface);
    const formattedPinyin =
      this.showPinyin && this.pinyin
        ? formatPinyin(this.pinyin, this.settings.pinyinStyle)
        : "";
    const syllables = formattedPinyin ? formattedPinyin.split(/\s+/).filter(Boolean) : [];
    const perChar = this.showPinyin && syllables.length === chars.length;

    if (perChar) {
      for (let i = 0; i < chars.length; i++) {
        const cell = cells.createSpan({ cls: "cci-stack-cell" });
        const p = cell.createSpan({ cls: "cci-stack-pinyin" });
        p.textContent = syllables[i];
        const c = cell.createSpan({ cls: "cci-stack-chars" });
        c.textContent = chars[i];
      }
    } else {
      // Pinyin syllable count doesn't match char count → fall back to a
      // single pinyin row above the entire word.
      const cell = cells.createSpan({ cls: "cci-stack-cell cci-stack-cell-word" });
      if (this.showPinyin && this.pinyin) {
        const p = cell.createSpan({ cls: "cci-stack-pinyin cci-stack-pinyin-word" });
        p.textContent = formattedPinyin;
      }
      const c = cell.createSpan({ cls: "cci-stack-chars" });
      c.textContent = this.surface;
    }

    return stack;
  }

  ignoreEvent(): boolean {
    return false;
  }
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
