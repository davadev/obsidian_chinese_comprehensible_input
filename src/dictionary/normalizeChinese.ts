/**
 * Chinese text utilities.
 * Browser-safe only; no Node APIs.
 */

const CJK_RANGE =
  /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u{2ceb0}-\u{2ebef}]/u;

const CJK_RANGE_GLOBAL =
  /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u{2b740}-\u{2b81f}\u{2b820}-\u{2ceaf}\u{2ceb0}-\u{2ebef}]/gu;

export function isCjkChar(ch: string): boolean {
  if (!ch) return false;
  CJK_RANGE.lastIndex = 0;
  return CJK_RANGE.test(ch);
}

export interface CjkSpan {
  start: number;
  end: number; // exclusive
  text: string;
}

export function findCjkSpans(text: string): CjkSpan[] {
  const spans: CjkSpan[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isCjkChar(ch)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      spans.push({ start, end: i, text: text.slice(start, i) });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ start, end: text.length, text: text.slice(start) });
  return spans;
}

/** Stable normalized key. Simplified surface + numbered pinyin if available. */
export function makeKey(simplified: string, pinyin?: string): string {
  if (!pinyin) return simplified;
  return `${simplified}|${toneMarksToNumbers(pinyin).toLowerCase()}`;
}

/** Convert pinyin tone marks to numbered pinyin (very simple impl, good enough for keys). */
export function toneMarksToNumbers(s: string): string {
  const map: Record<string, [string, number]> = {
    ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
    ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
    ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
    ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
    ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
    ǖ: ["ü", 1], ǘ: ["ü", 2], ǚ: ["ü", 3], ǜ: ["ü", 4],
  };
  let out = "";
  let tone: number | null = null;
  let curSyl = "";
  const flush = () => {
    if (curSyl) {
      out += curSyl + (tone ?? 5);
      curSyl = "";
      tone = null;
    }
  };
  for (const ch of s) {
    const m = map[ch];
    if (m) {
      curSyl += m[0];
      tone = m[1];
    } else if (/[a-zA-Zü]/.test(ch)) {
      curSyl += ch.toLowerCase();
    } else if (/[1-5]/.test(ch) && curSyl && tone === null) {
      // Already-numbered input, e.g. a legacy "nü3" that predates the
      // `u:` fix below. Absorb the digit as this syllable's tone instead
      // of emitting a neutral 5 and then the digit ("nü53"). This is what
      // makes `nü3` and `nǚ` hash identically, so repairing the stored
      // pinyin cannot move any makeKey()-derived vocabulary key.
      // Guarded on curSyl so standalone numerals ("11 Qū") pass through.
      tone = parseInt(ch, 10);
      flush();
    } else {
      flush();
      out += ch;
    }
  }
  flush();
  return out;
}

/** Convert numbered pinyin syllables (like "ni3 hao3") to tone-mark pinyin. */
export function numbersToToneMarks(s: string): string {
  const marks: Record<string, string[]> = {
    a: ["ā", "á", "ǎ", "à", "a"],
    e: ["ē", "é", "ě", "è", "e"],
    o: ["ō", "ó", "ǒ", "ò", "o"],
    i: ["ī", "í", "ǐ", "ì", "i"],
    u: ["ū", "ú", "ǔ", "ù", "u"],
    ü: ["ǖ", "ǘ", "ǚ", "ǜ", "ü"],
  };
  // `u:` is CC-CEDICT's ASCII stand-in for ü. It has to become ü BEFORE
  // the syllable regex runs, because the regex's character class has no
  // `:` in it — leaving it until afterwards is what produced the literal
  // "nü3" (女) and "lü4" (绿) in every dictionary built so far.
  return s.replace(/u:/g, "ü").replace(/([a-zA-ZüÜ]+)([1-5])/g, (_m, syl: string, t: string) => {
    const tone = parseInt(t, 10);
    if (tone < 1 || tone > 4) return syl;
    const i = toneMarkIndex(syl);
    if (i < 0) return syl;
    const target = syl[i].toLowerCase();
    return (
      syl.slice(0, i) +
      marks[target][tone - 1] +
      syl.slice(i + 1)
    );
  });
}

/**
 * Which vowel of a pinyin syllable carries the tone mark.
 *
 * Standard rule: an `a`, `o` or `e` always wins; otherwise the mark goes
 * on the LAST vowel, which is what makes `jiǔ` / `liù` / `qiú` correct.
 * The previous implementation ranked `i` above `u` unconditionally and so
 * produced `jǐu` / `lìu` / `qíu` for every -iu final — 六, 九, 牛奶, 休息,
 * 秋天, 丢 and the rest of the HSK 1-3 list.
 *
 * Returns the index into `syl`, or -1 when there is no vowel to mark.
 */
function toneMarkIndex(syl: string): number {
  const low = syl.toLowerCase();
  for (const v of ["a", "o", "e"]) {
    const i = low.indexOf(v);
    if (i >= 0) return i;
  }
  for (let i = low.length - 1; i >= 0; i--) {
    if ("iuü".includes(low[i])) return i;
  }
  return -1;
}

/**
 * Repair pinyin that was tone-marked by an older build of this file.
 *
 * Two defects are fixed, both in place and both case-preserving:
 *   - `u:` left unconverted, stranding the tone digit — "nü3" -> "nǚ"
 *   - the -iu tone mark on the wrong vowel — "jǐu" -> "jiǔ"
 *
 * Deliberately NOT implemented as a round-trip through toneMarksToNumbers,
 * which lowercases and would corrupt proper nouns ("Qū" -> "qū", "3D" -> "3d").
 *
 * Key-safe: toneMarksToNumbers() absorbs a trailing digit as its syllable's
 * tone, so `toneMarksToNumbers(x) === toneMarksToNumbers(repairPinyin(x))`
 * for every affected string, and no vocabulary key moves.
 */
export function repairPinyin(p: string): string {
  // Fast bail-out: the overwhelming majority of entries need no work, and
  // this runs over every dictionary entry at index time.
  if (!/[1-5]|u:|[īíǐì]u/.test(p)) return p;
  const iuFix: Record<string, string> = { "ī": "iū", "í": "iú", "ǐ": "iǔ", "ì": "iù" };
  const shifted = p.replace(/([īíǐì])u/g, (_m, v: string) => iuFix[v]);
  return numbersToToneMarks(shifted);
}

export function shortenDefinition(def: string, max = 40): string {
  if (def.length <= max) return def;
  return def.slice(0, max - 1) + "…";
}

export function hasCjk(text: string): boolean {
  CJK_RANGE_GLOBAL.lastIndex = 0;
  return CJK_RANGE_GLOBAL.test(text);
}
