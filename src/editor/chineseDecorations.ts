import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";

/** Dispatch this effect to make the decoration plugin recompute without rebuilding the editor. */
export const cciRedecorateEffect = StateEffect.define<null>();
/**
 * Drop the cached token list and re-tokenize from scratch. Used after a
 * custom-word add/edit/delete so the lattice's new trie produces a fresh
 * tokenization — a plain redecorate would otherwise reuse the stale
 * cached tokens and never pick up the new word.
 */
export const cciReTokenizeEffect = StateEffect.define<null>();
import type CciPlugin from "../main";
import { computeExcludedRanges, isRangeExcluded } from "./markdownExclusionRanges";
import { Token } from "../tokenizer/tokenizerTypes";
import { getCachedTokens, hashText } from "../tokenizer/tokenCache";
import { ColorState, KnownAxes, WordRecord } from "../vocabulary/VocabularyTypes";
import { CciSettings, DisplayMode } from "../settings/types";
import { hasCjk, shortenDefinition } from "../dictionary/normalizeChinese";
import { axesFromStatus, colorClassKey, ColorClassKey, colorOf } from "../vocabulary/axes";

/**
 * Symbol passed via ViewPlugin's compartment-side facet to share the plugin instance.
 * We avoid a global by stashing it on EditorView state.
 */
export const PLUGIN_FIELD_KEY = "__cci_plugin__";

/**
 * Dispatch the redecorate effect on the next animation frame so the new
 * decoration set is picked up after CM6's measure pass. Wrapped in
 * try/catch because the view may be destroyed before the frame fires.
 *
 * Only used for the async/cache-miss path. The cache-hit happy path
 * computes decorations synchronously in the constructor and needs no
 * dispatch — the decoration set is in place before CM6 reads it.
 */
function dispatchRedecorate(view: EditorView): void {
  const fire = () => {
    try {
      view.dispatch({ effects: cciRedecorateEffect.of(null) });
    } catch {
      // view destroyed mid-flight; ignore
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fire);
  else fire();
}

export function buildChineseDecorations(plugin: CciPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      lastTokens: Token[] = [];
      lastSourceVersion = -1;
      tokenPromise: Promise<void> | null = null;
      lastText = "";
      lastTextVersion = -1;
      lastExclusions: ReturnType<typeof computeExcludedRanges> = [];
      /** Version (FNV hash) of the doc the in-flight tokenize was started for. */
      inFlightVersion: number | null = null;

      constructor(view: EditorView) {
        this.decorations = Decoration.none;
        // Synchronous cache check: if the host view pre-warmed the shared
        // token cache (see ChineseTextFileView.onOpen), we can build
        // decorations immediately so the first paint already has them.
        // Eliminates the async race that caused the "open note → no
        // annotations until I switch the mode" bug.
        const text = view.state.doc.toString();
        const version = hashText(text);
        this.rememberDoc(text, version);
        const cached = getCachedTokens(text);
        if (cached) {
          this.lastTokens = cached;
          this.lastSourceVersion = version;
          this.decorations = this.build(view, text, cached);
        } else {
          this.scheduleTokenize(view);
        }
      }

      update(update: ViewUpdate) {
        const redecorate = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(cciRedecorateEffect))
        );
        const retokenize = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(cciReTokenizeEffect))
        );
        if (retokenize) {
          this.lastTokens = [];
          this.lastSourceVersion = -1;
          this.scheduleTokenize(update.view);
          return;
        }
        if (!update.docChanged && !update.viewportChanged && !redecorate) return;
        // Fast path: doc unchanged AND tokens already cached → rebuild
        // decorations directly against the (possibly new) viewport without
        // re-stringifying / re-hashing the whole document. This is what was
        // causing visible lag on scroll-up for long notes.
        if (!update.docChanged && this.lastTokens.length > 0) {
          this.decorations = this.build(update.view, this.lastText, this.lastTokens);
          return;
        }
        this.scheduleTokenize(update.view);
      }

      scheduleTokenize(view: EditorView) {
        const text = view.state.doc.toString();
        const version = hashText(text);
        this.rememberDoc(text, version);
        if (version === this.lastSourceVersion && this.lastTokens.length > 0) {
          this.decorations = this.build(view, text, this.lastTokens);
          return;
        }
        // Synchronous cache peek — same fast path the constructor uses.
        // Catches the wikilink-navigation case where swapDocContent has
        // already warmed the shared cache via `await tokenizer.tokenize`
        // before dispatching the doc change. Without this peek the
        // post-switch update is stranded behind a stale in-flight
        // tokenize from the previous file.
        const cached = getCachedTokens(text);
        if (cached) {
          this.lastTokens = cached;
          this.lastSourceVersion = version;
          this.decorations = this.build(view, text, cached);
          return;
        }
        // If an in-flight tokenize is for a different document, drop the
        // reference so we can start a fresh one. The orphan still runs
        // but its stale-result guard below will discard its output.
        if (this.tokenPromise && this.inFlightVersion !== version) {
          this.tokenPromise = null;
        }
        if (this.tokenPromise) return;
        this.inFlightVersion = version;
        this.tokenPromise = (async () => {
          try {
            if (!hasCjk(text)) {
              if (this.inFlightVersion !== version) return;
              this.lastTokens = [];
              this.lastSourceVersion = version;
              this.decorations = Decoration.none;
              dispatchRedecorate(view);
              return;
            }
            const tokens = await plugin.tokenizer.tokenize(text);
            // Stale-result guard: a newer navigation has taken over.
            if (this.inFlightVersion !== version) return;
            this.lastTokens = tokens;
            this.lastSourceVersion = version;
            this.decorations = this.build(view, text, tokens);
            // Defer the redecorate transaction to the next animation frame.
            // If we dispatch synchronously the effect can arrive before CM6
            // finishes its initial measure pass, after which the new
            // decoration set is not painted until the user interacts with
            // the view — that was the "switch the mode to render" bug.
            dispatchRedecorate(view);
          } finally {
            // Only clear if we are still the latest in-flight tokenize.
            if (this.inFlightVersion === version) {
              this.tokenPromise = null;
            }
          }
        })();
      }

      build(view: EditorView, text: string, tokens: Token[]): DecorationSet {
        const settings = plugin.settings;
        const exclusions = this.lastText === text ? this.lastExclusions : computeExcludedRanges(text);
        const builder = new RangeSetBuilder<Decoration>();
        const ranges = view.visibleRanges;
        // Cache heading level per line so multi-token heading lines don't
        // re-parse. Computed lazily on first hit.
        const headingByLine = new Map<number, number>();
        const headingLevelAt = (offset: number): number => {
          try {
            const lineNum = view.state.doc.lineAt(offset).number;
            const cached = headingByLine.get(lineNum);
            if (cached !== undefined) return cached;
            const lineText = view.state.doc.line(lineNum).text;
            const m = /^\s{0,3}(#{1,6})\s/.exec(lineText);
            const level = m ? m[1].length : 0;
            headingByLine.set(lineNum, level);
            return level;
          } catch {
            return 0;
          }
        };
        for (const range of ranges) {
          for (const tok of tokens) {
            if (tok.end <= range.from) continue;
            if (tok.start >= range.to) break;
            if (!tok.isWord || tok.candidates.length === 0) continue;
            if (isRangeExcluded(exclusions, tok.start, tok.end)) continue;
            this.emitDecoration(builder, tok, settings, plugin, headingLevelAt(tok.start));
          }
        }
        return builder.finish();
      }

      rememberDoc(text: string, version: number) {
        if (version === this.lastTextVersion && text === this.lastText) return;
        this.lastText = text;
        this.lastTextVersion = version;
        this.lastExclusions = computeExcludedRanges(text);
      }

      emitDecoration(
        builder: RangeSetBuilder<Decoration>,
        tok: Token,
        settings: CciSettings,
        plugin: CciPlugin,
        headingLevel: number
      ) {
        const rec = plugin.vocab.bySurface(tok.surface);
        const statusColor: ColorState = colorOf(rec);
        if (statusColor === "ignored") return;

        const colorKey = colorClassKey(rec, settings.colorMode, settings.hskSource);

        const editMode = plugin.activeViewMode() === "edit";
        // In edit mode we must NOT replace text with widgets; otherwise typing
        // and cursor placement break. Force "none" so only a mark decoration
        // is applied — characters stay editable.
        const mode = editMode ? "none" : settings.defaultDisplayMode;

        const showColor = colorShouldShow(colorKey, settings);

        const wantsRuby =
          (mode === "two-line" || mode === "three-line") && statusColor !== "known";

        if (wantsRuby) {
          builder.add(
            tok.start,
            tok.end,
            Decoration.replace({
              widget: new RubyWidget(
                tok.surface,
                tok,
                rec,
                mode,
                settings,
                headingLevel,
                showColor ? colorKey : undefined
              ),
              inclusive: false,
            })
          );
          return;
        }

        if (showColor) {
          builder.add(
            tok.start,
            tok.end,
            Decoration.mark({
              class: `cci-word cci-color-${colorKey}`,
              attributes: {
                "data-cci-surface": tok.surface,
                "data-cci-color": colorKey,
              },
            })
          );
        } else if (statusColor === "known" && settings.knownWordPopups) {
          // No tint, but make it clickable so the popup can open. Without
          // this, wordInteractionPlugin's `.cci-word` lookup finds nothing
          // and the knownWordPopups toggle has no observable effect.
          builder.add(
            tok.start,
            tok.end,
            Decoration.mark({
              class: "cci-word",
              attributes: { "data-cci-surface": tok.surface },
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
  /** Empty string when the user has hidden this bucket's color. */
  private readonly colorKey: ColorClassKey | "";
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
    private settings: CciSettings,
    private headingLevel: number = 0,
    colorKey?: ColorClassKey
  ) {
    super();
    this.color = colorOf(rec);
    this.colorKey = colorKey ?? "";
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
      other.colorKey === this.colorKey &&
      other.axes.chars === this.axes.chars &&
      other.axes.pinyin === this.axes.pinyin &&
      other.axes.meaning === this.axes.meaning &&
      other.pinyin === this.pinyin &&
      other.def === this.def &&
      other.headingLevel === this.headingLevel
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
    const headingCls = this.headingLevel > 0 ? ` cci-stack-h${this.headingLevel}` : "";
    const colorCls = this.colorKey ? ` cci-color-${this.colorKey}` : "";
    stack.className = `cci-stack cci-word${colorCls}${headingCls}`;
    stack.setAttribute("data-cci-surface", this.surface);
    if (this.colorKey) stack.setAttribute("data-cci-color", this.colorKey);

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

function colorShouldShow(key: ColorClassKey, settings: CciSettings): boolean {
  switch (key) {
    case "known":
      return settings.showKnownColor;
    case "partial":
      return settings.showPartialColor;
    case "unknown":
      return settings.showUnknownColor;
    case "new":
      return settings.showNewColor;
    case "ignored":
      return false;
    case "hsk-none":
      return false;
    case "hsk-1":
    case "hsk-2":
    case "hsk-3":
    case "hsk-4":
    case "hsk-5":
    case "hsk-6":
    case "hsk-7": {
      const level = key.slice(4) as keyof CciSettings["showHskColors"];
      return settings.showHskColors[level];
    }
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
