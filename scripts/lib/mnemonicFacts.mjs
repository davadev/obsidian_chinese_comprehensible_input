/**
 * Pure helpers for scripts/mnemonic-compare.mjs: the experiment that asks whether supplying pronunciation and
 * character-composition facts (#185) makes AI mnemonics better than the current prompt. Nothing here ships in the plugin.
 */

const MARKS = { "̄": 1, "́": 2, "̌": 3, "̀": 4 };

/** "xué" -> "xue2", "lüè" -> "lve4", "ma" -> "ma5", "xue2" -> "xue2". Lower-cased; ü becomes v. */
export function normSyllable(s) {
  const t = String(s).trim().toLowerCase().replace(/ü/g, "v").replace(/u:/g, "v");
  const digit = /([1-5])$/.exec(t);
  const nfd = t.replace(/[ǖǘǚǜ]/g, (c) => ({ ǖ: "v̄", ǘ: "v́", ǚ: "v̌", ǜ: "v̀" })[c]).normalize("NFD");
  let tone = 0;
  let base = "";
  for (const ch of nfd) {
    if (MARKS[ch]) tone = MARKS[ch];
    else if (!/[̀-ͯ]/.test(ch)) base += ch;
  }
  base = base.replace(/[1-5]$/, "");
  return `${base}${tone || (digit ? Number(digit[1]) : 5)}`;
}

/** Tone number 1-5 of one syllable. */
export function toneOf(syllable) {
  return Number(normSyllable(syllable).slice(-1));
}

/** The cue legend from the plugin's mnemonic prompt. */
export const TONE_CUES = { 1: "➡️", 2: "↗️", 3: "↘️↗️", 4: "↘️", 5: "〰️" };

export function toneStrip(syllables) {
  return syllables.map((s) => TONE_CUES[toneOf(s)]).join("");
}

/** Cue sequence found in a line, as tone numbers. Longest cue first so 3rd tone is not read as 4th + 2nd. */
export function extractCues(line) {
  const out = [];
  const re = /↘️↗️|↘↗|➡️|➡|↗️|↗|↘️|↘|〰️|〰/g;
  let m;
  while ((m = re.exec(line))) {
    const c = m[0].replace(/\uFE0F/g, "");
    out.push(c === "↘↗" ? 3 : c === "➡" ? 1 : c === "↗" ? 2 : c === "↘" ? 4 : 5);
  }
  return out;
}

const IDS_OPS = /[⿰-⿿]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/u;

/** Leaf components of an IDS string, in reading order, without operators or MMAH's unknown marker. */
export function idsLeaves(ids) {
  if (!ids) return [];
  return Array.from(ids).filter((c) => !IDS_OPS.test(c) && c !== "？" && c !== "?");
}

/** Parse Make Me a Hanzi dictionary.txt (one JSON object per line) into a Map keyed by character. */
export function parseMmah(text) {
  const map = new Map();
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const e = JSON.parse(t);
      if (e && typeof e.character === "string") map.set(e.character, e);
    } catch {
      /* skip a damaged line */
    }
  }
  return map;
}

function shortGloss(def) {
  if (!def) return "";
  const first = String(def).split(/[;,]/)[0].trim();
  return first.length > 30 ? `${first.slice(0, 29)}…` : first;
}

/** One line of reference facts for a character, or null when the dictionary has no useful structure for it. */
export function charFacts(ch, map, opts = {}) {
  const e = map.get(ch);
  if (!e) return null;
  if (opts.gated) {
    // Only structure that means something: a pictographic character is a picture, so its "parts" are drawing strokes and
    // are replaced by the origin hint; a character with no etymology has no reliable story to build on.
    const type = e.etymology?.type;
    if (!type) return null;
    if (type === "pictographic") return e.etymology.hint ? `${ch}: pictographic; origin: ${e.etymology.hint}` : null;
  }
  const parts = idsLeaves(e.decomposition);
  const label = (c) => {
    const g = shortGloss(map.get(c)?.definition);
    return g ? `${c} (${g})` : c;
  };
  const bits = [];
  const ety = e.etymology;
  if (ety?.type) bits.push(ety.type);
  if (parts.length > 1 || (parts.length === 1 && parts[0] !== ch)) bits.push(`parts: ${parts.map(label).join(" + ")}`);
  if (ety?.phonetic) bits.push(`sound hint from ${ety.phonetic}`);
  if (ety?.semantic) bits.push(`meaning hint from ${ety.semantic}`);
  if (e.radical && e.radical !== ch) bits.push(`radical ${label(e.radical)}`);
  if (ety?.hint) bits.push(`origin: ${ety.hint}`);
  if (!bits.length) return null;
  return `${ch}: ${bits.join("; ")}`;
}

/** Every character that may legitimately be named in a story about `word`: its own, plus all reference components. */
export function allowedHanzi(word, map) {
  const out = new Set(Array.from(word).filter((c) => HAN.test(c)));
  const walk = (c, depth) => {
    const e = map.get(c);
    if (!e || depth > 3) return;
    for (const p of idsLeaves(e.decomposition)) {
      if (!out.has(p)) {
        out.add(p);
        walk(p, depth + 1);
      }
    }
    if (e.radical) out.add(e.radical);
  };
  for (const c of Array.from(word)) walk(c, 0);
  return out;
}

/** "学 (xué)" pairs and bare hanzi runs in a story. */
export function storyPairs(story) {
  const pairs = [];
  const bare = [];
  const re = /([㐀-䶿一-鿿豈-﫿]+)(\s*[(（]([^)）]*)[)）])?/gu;
  let m;
  while ((m = re.exec(story))) {
    if (m[3] !== undefined) pairs.push({ hanzi: m[1], pinyin: m[3] });
    else bare.push(m[1]);
  }
  return { pairs, bare };
}

export function normPinyinRun(p) {
  return String(p).split(/[\s'’·-]+/).filter(Boolean).map(normSyllable).join("");
}

export function wordSyllables(pinyin) {
  return String(pinyin).trim().split(/\s+/).filter(Boolean);
}

/**
 * Is the pinyin written after `hanzi` right? true / false, "gloss" when the parenthesis holds a gloss instead of pinyin, or null when there is no truth for that run.
 * Truth = the word's own pinyin (whole word, or a single character of it by position) or the reference reading of a
 * component character.
 */
export function pairCorrect(hanzi, pinyin, word, syllables, map) {
  const got = normPinyinRun(pinyin);
  const marked = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ1-4]/.test(pinyin);
  const wordChars = Array.from(word);
  // "watched" tolerance: a reference reading with no tone (neutral) is matched by its base syllable at any tone
  const same = (a, b) => a === b || (b.endsWith("5") && a.slice(0, -1) === b.slice(0, -1));
  const verdict = (ok) => (ok || marked ? ok : "gloss");
  if (hanzi === word) return verdict(got === normPinyinRun(syllables.join(" ")));
  const accepted = [];
  wordChars.forEach((c, i) => {
    if (c === hanzi && syllables[i]) accepted.push(normSyllable(syllables[i]));
  });
  const e = map.get(hanzi);
  if (e && Array.isArray(e.pinyin)) for (const p of e.pinyin) accepted.push(normSyllable(p));
  if (Array.from(hanzi).length > 1) {
    // a run of several characters: only verifiable when every character is
    const per = Array.from(hanzi).map((c) => {
      const idx = wordChars.indexOf(c);
      return idx >= 0 && syllables[idx] ? normSyllable(syllables[idx]) : map.get(c)?.pinyin?.[0] ? normSyllable(map.get(c).pinyin[0]) : null;
    });
    return per.every(Boolean) ? verdict(got === per.join("")) : null;
  }
  if (accepted.length) return verdict(accepted.some((a) => same(got, a)));
  return marked ? null : "gloss";
}

/** Line checks shared by every arm. */
export function lineChecks(line, graphemeCount) {
  return { graphemes: graphemeCount, hanFree: !HAN.test(line) };
}
