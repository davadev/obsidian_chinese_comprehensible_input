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
    const m = map[ch as keyof typeof map];
    if (m) {
      curSyl += m[0];
      tone = m[1];
    } else if (/[a-zA-Zü]/.test(ch)) {
      curSyl += ch.toLowerCase();
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
  const vowelOrder = ["a", "o", "e", "i", "u", "ü"];
  const marks: Record<string, string[]> = {
    a: ["ā", "á", "ǎ", "à", "a"],
    e: ["ē", "é", "ě", "è", "e"],
    o: ["ō", "ó", "ǒ", "ò", "o"],
    i: ["ī", "í", "ǐ", "ì", "i"],
    u: ["ū", "ú", "ǔ", "ù", "u"],
    ü: ["ǖ", "ǘ", "ǚ", "ǜ", "ü"],
  };
  return s.replace(/([a-zA-ZüÜ]+)([1-5])/g, (_m, syl: string, t: string) => {
    const tone = parseInt(t, 10);
    if (tone < 1 || tone > 4) return syl;
    let target = "";
    for (const v of vowelOrder) {
      if (syl.toLowerCase().includes(v)) {
        target = v;
        break;
      }
    }
    if (!target) return syl;
    const i = syl.toLowerCase().indexOf(target);
    return (
      syl.slice(0, i) +
      marks[target][tone - 1] +
      syl.slice(i + 1)
    );
  });
}

export function shortenDefinition(def: string, max = 40): string {
  if (def.length <= max) return def;
  return def.slice(0, max - 1) + "…";
}

export function hasCjk(text: string): boolean {
  CJK_RANGE_GLOBAL.lastIndex = 0;
  return CJK_RANGE_GLOBAL.test(text);
}
