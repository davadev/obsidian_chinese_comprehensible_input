/**
 * Shared length rules for the short "emoji line" half of a mnemonic
 * (`WordRecord.mnemonic.text`).
 *
 * The line is deliberately bounded: it is shown on the word card and is
 * the candidate for rendering as a third line under a word in a future
 * release, where long prose would be a layout problem. Everything that
 * writes the field — the AI parser, the editor modal, and the v3 data
 * migration — measures it through here so the rule has one definition.
 *
 * Length is counted in *graphemes*, not UTF-16 units: "👨‍👩‍👧" is one
 * user-perceived character but 8 code units, and slicing by `.length`
 * would shred it.
 */
export const MNEMONIC_LINE_MAX_GRAPHEMES = 40;

/**
 * Much tighter bound for the mnemonic when it is rendered as a row UNDER a
 * word rather than on the word card (#56).
 *
 * The 40 above was chosen for the card, where a whole line is available. As a
 * per-word row the constraint is horizontal: each word is only as wide as its
 * widest row, so a 40-grapheme emoji line — emoji render near full-width, like
 * Han characters — would stretch a two-character word to roughly seventeen
 * characters of width and push its neighbours apart. 14 keeps the worst case
 * level with today's translation row, so word spacing cannot regress.
 *
 * Applied at RENDER time only. Stored mnemonics are untouched, so there is no
 * migration and the card still shows the full text.
 */
export const MNEMONIC_INLINE_MAX_GRAPHEMES = 14;

/** Zero-width joiner and variation selectors. Legal inside an emoji
 *  sequence, meaningless (and rendered as a stray box by some fonts) when
 *  left dangling at the end after a cut. Written as an alternation rather
 *  than a character class: a class of combining marks trips
 *  `no-misleading-character-class`, which the Obsidian review enforces. */
const TRAILING_JOINERS = /(?:\u200D|\uFE0E|\uFE0F)+$/;

let segmenter: Intl.Segmenter | null | undefined;

/** Split into user-perceived characters. Uses `Intl.Segmenter` where the
 *  runtime has it (Obsidian's Electron and modern iOS/Android WebViews do)
 *  and falls back to code points, which still never splits a surrogate
 *  pair — it just counts a ZWJ emoji as several. */
export function graphemes(s: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  if (!segmenter) return Array.from(s);
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}

/** Number of user-perceived characters in `s`. */
export function graphemeLength(s: string): number {
  return graphemes(s).length;
}

/** True when `s` is too long to be a short mnemonic line — i.e. it is
 *  prose that belongs in the story field. */
export function isOverMnemonicLine(s: string): boolean {
  return graphemeLength(s) > MNEMONIC_LINE_MAX_GRAPHEMES;
}

/** Trim `s` to at most `max` graphemes, never cutting inside an emoji or
 *  a surrogate pair, and never leaving a dangling joiner behind. */
export function clampGraphemes(s: string, max = MNEMONIC_LINE_MAX_GRAPHEMES): string {
  const g = graphemes(s);
  if (g.length <= max) return s;
  return g.slice(0, max).join("").replace(TRAILING_JOINERS, "");
}
