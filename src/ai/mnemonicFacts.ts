import type { DictionaryEntry } from "../dictionary/DictionaryTypes";
import { shortenDefinition, toneMarksToNumbers } from "../dictionary/normalizeChinese";
import {
  MNEMONIC_LINE_MAX_GRAPHEMES,
  clampGraphemes,
  graphemeLength,
} from "../vocabulary/mnemonicText";

/**
 * Everything about a mnemonic that the app can work out for itself, so the model is not asked to (#185).
 *
 * Measured on a 53-word gold set against the previous prompt: when the model was asked to write the tone cues it got
 * them wrong in up to half of the answers (`gpt-5.4-mini`) and sometimes wrote Chinese characters into the emoji
 * line. Tones are a pure function of the pinyin, so the app attaches them. The model draws; the app counts.
 */

const HAN = /[㐀-䶿一-鿿豈-﫿]/u;
/** Emoji keycaps (1️⃣) carry a digit; strip them before looking for stray digits. */
const KEYCAP = /[0-9#*]️?⃣/gu;
const LETTERS_OR_DIGITS = /[A-Za-z0-9¹²³⁰⁴]/u;

export const MNEMONIC_MEANING_MAX_GRAPHEMES = 14;

const TONE_SUPERSCRIPT: Record<number, string> = { 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁰" };

export function isHanChar(ch: string): boolean {
  return HAN.test(ch);
}

/** Tone 1-4, or 5 for the neutral tone (a syllable with no mark and no digit). */
export function toneOfSyllable(syllable: string): number {
  const digit = /([1-5])$/.exec(toneMarksToNumbers(syllable));
  return digit ? Number(digit[1]) : 5;
}

/** The small raised digit written after a character's picture group; ⁰ is the neutral tone. */
export function toneMark(tone: number): string {
  return TONE_SUPERSCRIPT[tone] ?? "";
}

export interface WordShape {
  /** The Han characters of the word, in order (punctuation and Latin letters are not characters here). */
  chars: string[];
  /** One tone-marked pinyin syllable per character, or null when the pinyin does not split one-to-one. */
  syllables: string[] | null;
  /** Tone of every pinyin token, even when they do not line up with the characters. */
  tones: number[];
}

/**
 * Align the pinyin to the characters. Entries whose pinyin does not split into exactly one syllable per character
 * (erhua written as one syllable, names with a middle dot, a hand-typed custom word) come back with `syllables: null`
 * rather than a guess; the prompt then asks for one picture group for the whole word and the tones are appended in
 * order.
 */
export function wordShape(surface: string, pinyin: string | undefined): WordShape {
  const chars = Array.from(surface).filter(isHanChar);
  const tokens = (pinyin ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    chars,
    syllables: chars.length > 0 && tokens.length === chars.length ? tokens : null,
    tones: tokens.map(toneOfSyllable),
  };
}

/** How many picture groups the model must return. */
export function expectedGroups(shape: WordShape): number {
  return shape.syllables ? shape.chars.length : 1;
}

/** Only a single group leaves room for a separate "meaning" strip; several groups carry the meaning between them. */
export function wantsMeaning(shape: WordShape): boolean {
  return expectedGroups(shape) === 1;
}

/** Graphemes left for the model's own emoji once the tone numbers are in. */
export function pictureBudget(shape: WordShape): number {
  return MNEMONIC_LINE_MAX_GRAPHEMES - shape.tones.length;
}

export interface MnemonicParts {
  characters: string[];
  meaning: string;
}

/** Remove what must never reach the line: Chinese characters, Latin letters and digits, the app's own tone digits. */
export function cleanGroup(group: string): string {
  return Array.from(group.matchAll(/[0-9#*]\uFE0F?\u20E3|[\s\S]/gu), (m) => m[0])
    .filter((t) => t.length > 1 && t.endsWith("\u20E3") ? true : !HAN.test(t) && !LETTERS_OR_DIGITS.test(t))
    .join("")
    .trim();
}

/**
 * The line the app writes: each character's picture group followed by that character's tone number, so the tone
 * stays attached to the right character. A single group (one character, or a word whose pinyin did not split) is
 * followed by every tone in order, then the meaning strip.
 */
export function assembleLine(parts: MnemonicParts, shape: WordShape): string {
  return clampGraphemes(assembleLineUnclamped(parts, shape));
}

/**
 * Defects in the model's answer that the app cannot fix itself. Empty means good. Used for the single repair
 * attempt, and for the note shown when the repair did not clear them.
 */
export function validateParts(parts: MnemonicParts, shape: WordShape): string[] {
  const issues: string[] = [];
  const want = expectedGroups(shape);
  if (parts.characters.length !== want) {
    issues.push(`"characters" must hold exactly ${want} picture group(s), one per character; you sent ${parts.characters.length}.`);
  }
  parts.characters.slice(0, want).forEach((raw, i) => {
    const g = raw.replace(KEYCAP, "");
    if (!raw.trim()) issues.push(`Picture group ${i + 1} is empty.`);
    else if (HAN.test(g)) issues.push(`Picture group ${i + 1} contains Chinese characters; use emoji only.`);
    else if (Array.from(g).some((c) => LETTERS_OR_DIGITS.test(c))) {
      issues.push(`Picture group ${i + 1} contains letters or digits; use emoji only (the app adds the tone numbers).`);
    }
  });
  if (wantsMeaning(shape)) {
    const m = parts.meaning.trim();
    if (!m) issues.push(`"meaning" is empty.`);
    else if (HAN.test(m)) issues.push(`"meaning" contains Chinese characters.`);
    else if (graphemeLength(m) > MNEMONIC_MEANING_MAX_GRAPHEMES || /[\n/]/.test(m)) {
      issues.push(`"meaning" must be one short emoji strip (at most ${MNEMONIC_MEANING_MAX_GRAPHEMES} characters), not a sentence or a list.`);
    }
  }
  if (graphemeLength(assembleLineUnclamped(parts, shape)) > MNEMONIC_LINE_MAX_GRAPHEMES) {
    issues.push(`The finished line is over the ${MNEMONIC_LINE_MAX_GRAPHEMES}-character limit; use fewer emoji.`);
  }
  return issues;
}

function assembleLineUnclamped(parts: MnemonicParts, shape: WordShape): string {
  const groups = parts.characters.map(cleanGroup);
  if (shape.syllables && shape.chars.length > 1) {
    return shape.chars.map((_, i) => `${groups[i] ?? ""}${toneMark(shape.tones[i])}`).join("");
  }
  return `${groups[0] ?? ""}${shape.tones.map(toneMark).join("")}${parts.meaning.trim()}`;
}

function normPinyin(p: string): string {
  return p
    .split(/[\s'’·-]+/)
    .filter(Boolean)
    .map((s) => toneMarksToNumbers(s).toLowerCase())
    .join("");
}

/**
 * The app knows the word's own pinyin, so it writes it into the story instead of trusting the model: every run of
 * the word's own characters gets the right pinyin after it (added when missing, replaced when wrong or when the
 * model put a gloss there). Parts and other characters are left alone. Does nothing unless the pinyin split one
 * syllable per character.
 */
export function repairStoryPinyin(story: string, shape: WordShape): string {
  const syllables = shape.syllables;
  if (!syllables) return story;
  const chars = shape.chars;
  const own = new Set(chars);
  return story.replace(
    /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+)(\s*[(（]([^)）]*)[)）])?/gu,
    (whole: string, run: string, _paren: string | undefined, inner: string | undefined) => {
      const runChars = Array.from(run);
      if (!runChars.every((c) => own.has(c))) return whole;
      // Every place the run occurs in the word: 谢谢 has 谢 twice, with a different tone each time.
      const readings: string[] = [];
      for (let at = 0; at + runChars.length <= chars.length; at++) {
        if (runChars.every((c, k) => chars[at + k] === c)) readings.push(syllables.slice(at, at + runChars.length).join(" "));
      }
      if (readings.length === 0) return whole;
      if (inner !== undefined && readings.some((r) => normPinyin(inner) === normPinyin(r))) return whole;
      return `${run} (${readings[0]})`;
    }
  );
}

/**
 * For a word of several characters: one short dictionary gloss per Han character, in order, so the model can draw what
 * each character means. A single character gets none (its picture is its parts, not a gloss), and a character the
 * dictionary does not know gets an empty gloss.
 */
export function charGlossesFor(
  surface: string,
  lookup: (s: string) => DictionaryEntry[]
): string[] | undefined {
  const han = Array.from(surface).filter(isHanChar);
  if (han.length < 2) return undefined;
  return han.map((c) => shortenDefinition(lookup(c)[0]?.definitions[0] ?? "", 40));
}
