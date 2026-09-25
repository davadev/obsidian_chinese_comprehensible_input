import type { DisplayMode, LineContent } from "../settings/types";
import type { KnownAxes } from "../vocabulary/VocabularyTypes";
import { shortenDefinition } from "../dictionary/normalizeChinese";
import { clampGraphemes, MNEMONIC_INLINE_MAX_GRAPHEMES } from "../vocabulary/mnemonicText";

/**
 * Decides what goes on each annotation row above a word, and whether it can be
 * aligned per character (#56).
 *
 * Deliberately pure — no DOM, no CodeMirror, no Obsidian. `chineseDecorations`
 * is 642 lines and is where most of this plugin's rendering bugs have lived, so
 * the part of it that is plain decision-making lives here where it can be
 * tested directly. `RubyWidget` keeps only the DOM construction.
 *
 * Numbering matches the settings UI and counts UPWARD from the characters:
 *
 *     line 3   configurable   (English, by default)
 *     line 2   configurable   (pinyin, by default)
 *     line 1   characters     always, never selectable
 *
 * Note the DOM renders top-down, so line 3 is emitted first.
 */

export interface ResolvedRow {
  content: LineContent;
  text: string;
}

export interface ResolvedAnnotationLines {
  /** The row furthest from the characters. Absent in two-line and none modes. */
  line3?: ResolvedRow;
  /** The row directly above the characters. Absent in none mode. */
  line2?: ResolvedRow;
  /**
   * True only when line 2 holds pinyin AND its syllable count matches the
   * character count, so each syllable can sit over its own glyph. Any other
   * row renders as a single span across the whole word.
   */
  perCharPinyin: boolean;
}

export interface AnnotationLineInput {
  mode: DisplayMode;
  line2Content: LineContent;
  line3Content: LineContent;
  /** No record at all, or one still at status "new". */
  isNew: boolean;
  axes: KnownAxes;
  /** Already region-resolved and tone-formatted by the caller. */
  pinyin: string;
  definition: string;
  mnemonic: string;
  charCount: number;
  /** Strip parentheticals from the inline translation (#103 follow-up). */
  stripGlossParentheticals: boolean;
}

/** Longest inline translation before it is truncated with an ellipsis. */
export const GLOSS_INLINE_MAX_CHARS = 28;

/**
 * Strip `(...)` groups from a translation.
 *
 * CC-CEDICT puts register, era and etymology in parentheses — "(Internet
 * slang)", "(Ming Dynasty)", "(loanword)" — which is detail for the word card
 * rather than for a row sitting over running text. Measured over the full
 * 125,008-entry dictionary: 29.3% of first definitions carry one, and removing
 * it sheds ~20 characters on average.
 *
 * Returns the ORIGINAL when stripping would leave nothing: 0.82% of those
 * entries are nothing but a parenthetical ("(used in place names)"), and an
 * empty row would silently drop the only translation the word has.
 */
export function stripParentheticals(def: string): string {
  const out = def
    .replace(/\s*[(（][^)）]*[)）]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out === "" ? def : out;
}

/**
 * Is this content still useful to the learner for this word?
 *
 * Keyed to the CONTENT, never to the row it happens to occupy — knowing the
 * meaning is what makes the translation redundant, wherever it sits. Moving
 * content between rows must not change when it disappears.
 *
 * The pinyin and translation rules are the ones this plugin has always used
 * (`showPinyin` / `showGloss`); only their phrasing moved here.
 */
export function isContentVisible(
  content: LineContent,
  isNew: boolean,
  axes: KnownAxes
): boolean {
  switch (content) {
    case "pinyin":
      return isNew || !axes.pinyin || !axes.chars;
    case "english":
      return isNew || !axes.meaning;
    case "mnemonic":
      // No "knows the mnemonic" axis exists, and none is needed: a mnemonic is
      // scaffolding for a word you cannot yet recall, so it retires exactly
      // when the rest of the scaffolding does.
      return isNew || !(axes.chars && axes.pinyin && axes.meaning);
  }
}

/** Row text for a given content, already truncated for inline display. */
function textFor(content: LineContent, input: AnnotationLineInput): string {
  switch (content) {
    case "pinyin":
      return input.pinyin;
    case "english": {
      const raw = input.stripGlossParentheticals
        ? stripParentheticals(input.definition)
        : input.definition;
      return raw ? shortenDefinition(raw, GLOSS_INLINE_MAX_CHARS) : "";
    }
    case "mnemonic": {
      if (!input.mnemonic) return "";
      // A far tighter bound than the 40 graphemes the word card allows. That
      // limit was chosen for a full-width card; as a per-word row an emoji
      // line at 40 would stretch a two-character word to roughly seventeen
      // characters of width and shove its neighbours apart.
      const clamped = clampGraphemes(input.mnemonic, MNEMONIC_INLINE_MAX_GRAPHEMES);
      return clamped.length < input.mnemonic.length ? `${clamped}…` : clamped;
    }
  }
}

/** How many rows this display mode shows above the characters. */
function rowCount(mode: DisplayMode): 0 | 1 | 2 {
  if (mode === "three-line") return 2;
  if (mode === "two-line") return 1;
  return 0;
}

export function resolveAnnotationLines(
  input: AnnotationLineInput
): ResolvedAnnotationLines {
  const rows = rowCount(input.mode);
  if (rows === 0) return { perCharPinyin: false };

  const build = (content: LineContent): ResolvedRow | undefined => {
    if (!isContentVisible(content, input.isNew, input.axes)) return undefined;
    const text = textFor(content, input);
    // An absent mnemonic or a word with no translation drops the row rather
    // than rendering an empty one — the behaviour glosses already had.
    return text ? { content, text } : undefined;
  };

  const line2 = build(input.line2Content);
  const line3 = rows === 2 ? build(input.line3Content) : undefined;

  const perCharPinyin =
    line2?.content === "pinyin" &&
    input.charCount > 0 &&
    line2.text.split(/\s+/).filter(Boolean).length === input.charCount;

  return { line3, line2, perCharPinyin };
}
