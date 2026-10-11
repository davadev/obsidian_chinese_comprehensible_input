/**
 * Objective measurements of a generated Chinese story, for comparing two models on the same job (scripts/model-compare.mjs).
 * Pure functions: the HSK map is passed in, so this runs in tests without the plugin bundle.
 *
 * None of this judges whether a story is *good*. It measures the things a validator would, plus shape (length,
 * paragraphs) and sameness, so the part a person has to read is smaller and the numbers are not an impression.
 */

const CJK = /[一-鿿]/;

/**
 * Greedy longest-match segmentation against the HSK word list. Characters not covered by any HSK word are returned as
 * single-character `{ word, level: 0 }` entries: names, particles and grammar words the lists do not carry end up here,
 * so level 0 means "not on the HSK lists", not "wrong".
 */
export function segment(text, hskMap, maxLen = 6) {
  const out = [];
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    if (!CJK.test(chars[i])) {
      i++;
      continue;
    }
    let hit = null;
    for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
      const w = chars.slice(i, i + len).join("");
      if (Object.prototype.hasOwnProperty.call(hskMap, w)) {
        hit = { word: w, level: hskMap[w] };
        break;
      }
    }
    if (hit) {
      out.push(hit);
      i += Array.from(hit.word).length;
    } else {
      out.push({ word: chars[i], level: 0 });
      i++;
    }
  }
  return out;
}

/** Share (0..1) of the CJK characters that fall in HSK words at each band. */
export function levelProfile(text, hskMap, targetHsk) {
  const segs = segment(text, hskMap);
  const total = segs.reduce((n, s) => n + Array.from(s.word).length, 0);
  if (total === 0) return { chars: 0, atOrBelow: 0, aboveByOne: 0, tooHard: 0, offList: 0, tooHardWords: [] };
  const share = (pred) => segs.filter(pred).reduce((n, s) => n + Array.from(s.word).length, 0) / total;
  const hard = segs.filter((s) => s.level > targetHsk + 1);
  return {
    chars: total,
    atOrBelow: share((s) => s.level > 0 && s.level <= targetHsk),
    aboveByOne: share((s) => s.level === targetHsk + 1),
    // The validator's own definition of "too hard": more than one level above the target.
    tooHard: share((s) => s.level > targetHsk + 1),
    offList: share((s) => s.level === 0),
    tooHardWords: [...new Set(hard.map((s) => s.word))],
  };
}

export function paragraphs(text) {
  return text.split(/\n\s*\n/).filter((p) => p.trim() !== "").length;
}

export function cjkLength(text) {
  return Array.from(text).filter((c) => CJK.test(c)).length;
}

/** How many times each target appears, so "included once" and "worked in naturally several times" differ. */
export function targetCounts(text, targets) {
  return targets.map((t) => ({ word: t, count: t ? text.split(t).length - 1 : 0 }));
}

/** Distinct character bigrams over all bigrams: a cheap measure of repetitiveness. 1 = no repetition. */
export function bigramDiversity(text) {
  const chars = Array.from(text).filter((c) => CJK.test(c));
  if (chars.length < 2) return 0;
  const seen = new Set();
  for (let i = 0; i < chars.length - 1; i++) seen.add(chars[i] + chars[i + 1]);
  return seen.size / (chars.length - 1);
}

/** Characters from a small list of very common simplified-only forms. In a Traditional story any of these is a slip. */
const SIMPLIFIED_ONLY = "们这个来说学会对时国为从过还边东车见说话请问谁";
export function simplifiedSlips(text) {
  return Array.from(text).filter((c) => SIMPLIFIED_ONLY.includes(c)).length;
}

/** How alike two titles or texts are, 0..1, by shared character bigrams. Used to see whether runs repeat themselves. */
export function similarity(a, b) {
  const grams = (s) => {
    const cs = Array.from(s).filter((c) => CJK.test(c));
    const set = new Set();
    for (let i = 0; i < cs.length - 1; i++) set.add(cs[i] + cs[i + 1]);
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared);
}

/** Mean pairwise similarity between texts: high means the model keeps writing the same story. */
export function meanPairwiseSimilarity(texts) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      sum += similarity(texts[i], texts[j]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

export const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
export const pct = (x) => `${(x * 100).toFixed(1)}%`;
