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
import { hasCjk, shortenDefinition, toneMarksToNumbers } from "../dictionary/normalizeChinese";
import { axesFromStatus, colorClassKey, ColorClassKey, colorOf } from "../vocabulary/axes";
import { DEFAULT_HIGHLIGHT_BG, findHighlightSpans, resolveHighlightPalette } from "./highlightPalette";

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
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(fire);
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
        // Keep the existing decoration set positionally valid across the edit.
        // CM6 does NOT auto-map ViewPlugin decorations; without this, after a
        // doc change (e.g. inserting a highlight's `==` / `<mark>`) our set
        // stays at the OLD offsets until the async re-tokenize lands, while the
        // markdown renderer rebuilds synchronously with the NEW offsets — the
        // two disagree and CM6 paints the line twice (the highlight-duplication
        // bug). Mapping shifts our ranges to match the new document immediately.
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
        }
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
        // Highlight spans so annotated (ruby) words can tint their characters —
        // a Decoration.mark background is otherwise dropped under the replace
        // widget. Plain-mark words still get the background from the markdown
        // renderer's overlay.
        const palette = resolveHighlightPalette(plugin.app, settings);
        const highlightSpans = findHighlightSpans(text, palette);
        const highlightBgAt = (tok: Token): string | undefined => {
          for (const s of highlightSpans) {
            if (s.openFrom > tok.start) break; // spans sorted by openFrom
            if (tok.start >= s.contentFrom && tok.end <= s.contentTo) {
              return s.color ?? DEFAULT_HIGHLIGHT_BG;
            }
          }
          return undefined;
        };
        // Per-character helpers for non-word runs. A non-word token spans the
        // whole gap between CJK spans (it can swallow newlines + an adjacent
        // line's `1. `), so we render those runs one glyph at a time: each glyph
        // is an exact tap target and its own 1em tint cell.
        // Color for a single glyph fully inside a highlight span's content.
        const charBg = (cs: number, ce: number): string | undefined => {
          for (const s of highlightSpans) {
            if (s.openFrom > cs) break; // spans sorted by openFrom
            if (cs >= s.contentFrom && ce <= s.contentTo) {
              return s.color ?? DEFAULT_HIGHLIGHT_BG;
            }
          }
          return undefined;
        };
        // True when [cs, ce) is the hidden markup of a highlight (`==` / `<mark…>`
        // / `</mark>`) — the renderer replaces it, so we emit no mark there.
        const inHiddenDelimiter = (cs: number, ce: number): boolean => {
          for (const s of highlightSpans) {
            if (s.openFrom > ce) break;
            if ((cs >= s.openFrom && ce <= s.contentFrom) ||
                (cs >= s.contentTo && ce <= s.closeTo)) {
              return true;
            }
          }
          return false;
        };
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
        // In format mode every visible character should be a valid tap target
        // (start/end of a selection), not just tokenized Chinese words.
        const formatMode = plugin.activeViewMode() === "format";
        // In ruby modes the markdown renderer skips the highlight content tint
        // (it would overlap the ruby widgets), so non-word runs inside a
        // highlight must be tinted here too — otherwise digits/punctuation in a
        // highlighted span render with no background.
        const rubyMode =
          settings.defaultDisplayMode === "two-line" ||
          settings.defaultDisplayMode === "three-line";
        for (const range of ranges) {
          for (const tok of tokens) {
            if (tok.end <= range.from) continue;
            if (tok.start >= range.to) break;
            if (!tok.isWord || tok.candidates.length === 0) {
              // Non-word run — render one glyph at a time so each is an exact tap
              // target (format mode) and its own 1em tint cell (ruby mode). A
              // coarse whole-token mark made `posAtDOM` resolve to the token
              // start, breaking selection of `1.` / `？` (#21).
              let off = tok.start;
              for (const ch of Array.from(tok.surface)) {
                const cs = off;
                const ce = off + ch.length; // UTF-16 doc offsets
                off = ce;
                if (!/\S/.test(ch)) continue; // skip whitespace / newlines
                // Per-char exclusion: skips the `<mark …>`/`</mark>` tag chars,
                // code, math — but NOT the content glyph next to a tag. (Testing
                // the whole token would drop `1.`/`？` for an embedded `<mark>`.)
                if (isRangeExcluded(exclusions, cs, ce)) continue;
                if (inHiddenDelimiter(cs, ce)) continue; // also hides `==` delimiters
                const bg = rubyMode ? charBg(cs, ce) : undefined;
                if (bg) {
                  // Render a highlighted non-word glyph through the SAME widget as
                  // a ruby character so the tint band is pixel-identical (and
                  // scales with the heading level). The empty-candidate fake token
                  // means RubyWidget draws no pinyin/gloss — just the char in
                  // `.cci-stack-chars-hl`. It still carries `cci-word` + the data
                  // offsets, so it stays a clickable selection boundary.
                  const ftok: Token = {
                    start: cs,
                    end: ce,
                    surface: ch,
                    isWord: false,
                    candidates: [],
                    confidence: 1,
                  };
                  builder.add(
                    cs,
                    ce,
                    Decoration.replace({
                      widget: new RubyWidget(
                        ch,
                        ftok,
                        undefined,
                        settings.defaultDisplayMode,
                        settings,
                        headingLevelAt(cs),
                        undefined,
                        bg
                      ),
                      inclusive: false,
                    })
                  );
                } else if (formatMode) {
                  // Not highlighted — a plain clickable selection boundary (only
                  // in format mode; otherwise a tap on a digit would open a popup).
                  builder.add(
                    cs,
                    ce,
                    Decoration.mark({
                      class: "cci-word",
                      attributes: {
                        "data-cci-surface": ch,
                        "data-cci-start": String(cs),
                        "data-cci-end": String(ce),
                        "data-cci-doclen": String(ch.length),
                      },
                    })
                  );
                }
              }
              continue;
            }
            // Word token: exclude only if the whole word sits in an excluded
            // range (code / math / a link URL) — a CJK word never contains the
            // adjacent `<mark>` tag, so this stays a clean whole-token test.
            if (isRangeExcluded(exclusions, tok.start, tok.end)) continue;
            this.emitDecoration(
              builder,
              tok,
              settings,
              plugin,
              headingLevelAt(tok.start),
              highlightBgAt(tok)
            );
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
        headingLevel: number,
        highlightBg: string | undefined
      ) {
        const rec = plugin.vocab.bySurface(tok.surface);
        const statusColor: ColorState = colorOf(rec);
        if (statusColor === "ignored") return;

        const colorKey = colorClassKey(rec, settings.colorMode, settings.hskSource);

        const editMode = plugin.activeViewMode() === "edit";
        // Format mode taps the start/end word, so words must be clickable and
        // expose their document offsets — but the ruby annotations should stay
        // visible, so we keep the display mode and add the offsets to the ruby
        // widget (and to the fallback mark below) rather than forcing plain text.
        const formatMode = plugin.activeViewMode() === "format";
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
                showColor ? colorKey : undefined,
                highlightBg
              ),
              inclusive: false,
            })
          );
          return;
        }

        const posAttrs = {
          "data-cci-start": String(tok.start),
          "data-cci-end": String(tok.end),
          "data-cci-doclen": String(tok.end - tok.start),
        };
        // In ruby modes the markdown renderer does NOT tint highlight content
        // (it would overlap the ruby widgets), so mark-rendered words tint here.
        const rubyMode = mode === "two-line" || mode === "three-line";
        const hlAttrs: Record<string, string> =
          highlightBg && rubyMode ? { style: `background-color:${highlightBg};` } : {};
        const hlClass = highlightBg && rubyMode ? " cci-md-highlight" : "";
        if (showColor) {
          builder.add(
            tok.start,
            tok.end,
            Decoration.mark({
              class: `cci-word cci-color-${colorKey}${hlClass}`,
              attributes: {
                "data-cci-surface": tok.surface,
                "data-cci-color": colorKey,
                ...posAttrs,
                ...hlAttrs,
              },
            })
          );
        } else if (formatMode || (statusColor === "known" && settings.knownWordPopups)) {
          // No tint, but make it clickable: the popup can open (knownWordPopups)
          // or the formatting mode can read the span offsets. Without this the
          // `.cci-word` lookup in wordInteractionPlugin finds nothing.
          builder.add(
            tok.start,
            tok.end,
            Decoration.mark({
              class: `cci-word${hlClass}`,
              attributes: { "data-cci-surface": tok.surface, ...posAttrs, ...hlAttrs },
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
  private readonly start: number;
  private readonly end: number;

  constructor(
    private surface: string,
    tok: Token,
    rec: WordRecord | undefined,
    private mode: DisplayMode,
    private settings: CciSettings,
    private headingLevel: number = 0,
    colorKey?: ColorClassKey,
    private highlightBg?: string
  ) {
    super();
    this.start = tok.start;
    this.end = tok.end;
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
      other.headingLevel === this.headingLevel &&
      other.highlightBg === this.highlightBg
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
    const stack = activeDocument.createElement("span");
    const headingCls = this.headingLevel > 0 ? ` cci-stack-h${this.headingLevel}` : "";
    const colorCls = this.colorKey ? ` cci-color-${this.colorKey}` : "";
    stack.className = `cci-stack cci-word${colorCls}${headingCls}`;
    stack.setAttribute("data-cci-surface", this.surface);
    stack.setAttribute("data-cci-start", String(this.start));
    stack.setAttribute("data-cci-end", String(this.end));
    stack.setAttribute("data-cci-doclen", String(this.end - this.start));
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

    // Highlight the characters only — pinyin/gloss stay un-tinted (#21).
    const charsCls = this.highlightBg ? "cci-stack-chars cci-stack-chars-hl" : "cci-stack-chars";
    const tintChars = (c: HTMLElement) => {
      if (this.highlightBg) c.style.backgroundColor = this.highlightBg;
    };

    if (perChar) {
      for (let i = 0; i < chars.length; i++) {
        const cell = cells.createSpan({ cls: "cci-stack-cell" });
        const p = cell.createSpan({ cls: "cci-stack-pinyin" });
        p.textContent = syllables[i];
        const c = cell.createSpan({ cls: charsCls });
        c.textContent = chars[i];
        tintChars(c);
      }
    } else {
      // Pinyin syllable count doesn't match char count → fall back to a
      // single pinyin row above the entire word.
      const cell = cells.createSpan({ cls: "cci-stack-cell cci-stack-cell-word" });
      if (this.showPinyin && this.pinyin) {
        const p = cell.createSpan({ cls: "cci-stack-pinyin cci-stack-pinyin-word" });
        p.textContent = formattedPinyin;
      }
      const c = cell.createSpan({ cls: charsCls });
      c.textContent = this.surface;
      tintChars(c);
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
  // Numbers — reuse normalizer from dictionary module.
  return toneMarksToNumbers(p);
}
