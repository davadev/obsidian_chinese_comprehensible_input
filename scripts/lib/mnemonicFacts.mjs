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

/**
 * Furio Petrossi's "Decomposition 7120" (Pleco forum): `char<TAB>pinyin<TAB>parts   names`, e.g.
 * `明<TAB>ming2<TAB>日月     sun/day, moon`. Returns Map char -> { parts: string[], names: string[] }; first entry wins.
 */
export function parsePlecoFlat(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const cols = line.split("\t");
    if (cols.length < 3 || line.startsWith("//") || Array.from(cols[0]).length !== 1 || map.has(cols[0])) continue;
    const [comps, names = ""] = cols[2].split(/\s{3,}/);
    const parts = Array.from(comps.trim());
    if (!parts.length) continue;
    map.set(cols[0], { parts, names: names.split(",").map((n) => n.trim()).filter(Boolean) });
  }
  return map;
}

export function plecoFacts(ch, map) {
  const e = map.get(ch);
  if (!e || (e.parts.length === 1 && e.parts[0] === ch)) return null;
  const named = e.parts.length === e.names.length;
  return `${ch}: parts: ${named ? e.parts.map((p, i) => `${p} (${e.names[i]})`).join(" + ") : `${e.parts.join(" + ")} (${e.names.join(", ")})`}`;
}

/**
 * catusf's "CCD v0.1" (Pleco forum, built from the chin_dict package): `char<TAB>pinyin<TAB>MEANING① … TREE… COMPONENTS»…`.
 * The TREE is a box-drawing outline flattened onto one line; depth comes from the indent in front of each connector.
 * Returns Map char -> { gloss, tree: [{ ch, depth }] }.
 */
export function parseCcd(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const cols = line.split("\t");
    if (cols.length < 3 || line.startsWith("//") || Array.from(cols[0]).length !== 1 || map.has(cols[0])) continue;
    const body = cols.slice(2).join("\t");
    const head = body.slice(0, [body.indexOf("TREE"), body.indexOf("COMPONENTS»"), body.indexOf("CONTAINS"), body.length].filter((i) => i >= 0).sort((x, y) => x - y)[0]);
    const meanings = head.split(/[①-⑩]/).slice(1).map((x) => x.replace(/Alternative.*/s, "").replace(/\([^)]*\)?/g, "").replace(/\[[^\]]*\]?/g, "").replace(/["“”]/g, "").trim());
    const gloss = meanings.find((x) => x.length > 1 && /[a-z]/i.test(x) && !/^(surname|variant of|abbr|archaic|old variant|\(no meaning|no meaning|.*radical in)/i.test(x)) ?? "";
    const treeStart = body.indexOf("TREE");
    const treeEnd = body.indexOf("COMPONENTS»");
    const tree = [];
    if (treeStart >= 0) {
      const seg = body.slice(treeStart, treeEnd > treeStart ? treeEnd : undefined);
      const re = /((?:│   |    )*)(?:├──|└──) (\S+) \((\d+)\)/gu;
      let m;
      while ((m = re.exec(seg))) tree.push({ ch: m[2].replace(/[\uE000-\uF8FF]/g, ""), depth: m[1].length / 4 });
    }
    map.set(cols[0], { gloss: gloss.slice(0, 30), tree });
  }
  return map;
}

export function ccdFacts(ch, map) {
  const e = map.get(ch);
  if (!e || !e.tree.length) return null;
  const label = (c) => {
    const g = map.get(c)?.gloss;
    return g ? `${c} (${g})` : c;
  };
  // top level parts in order, each followed by its own parts in brackets
  const out = [];
  e.tree.forEach((n, i) => {
    if (n.depth !== 0) return;
    const kids = [];
    for (let j = i + 1; j < e.tree.length && e.tree[j].depth > 0; j++) if (e.tree[j].depth === 1) kids.push(label(e.tree[j].ch));
    out.push(kids.length ? `${label(n.ch)} [= ${kids.join(" + ")}]` : label(n.ch));
  });
  return `${ch}: parts: ${out.join(" + ")}`;
}

export function ccdLeaves(ch, map) {
  return (map.get(ch)?.tree ?? []).map((n) => n.ch);
}

/** First clause of a reference definition, short enough to sit in a prompt line. */
export function shortDef(ch, map) {
  const d = map.get(ch)?.definition;
  if (!d) return "";
  const first = String(d).split(/[;]/)[0].trim();
  return first.length > 40 ? `${first.slice(0, 39)}…` : first;
}

/**
 * Facts for a SINGLE-character word: its parts with the role each plays. `labelRoles` marks the sound part "(sound only)"
 * and the meaning part "(meaning)" so the model does not build a story that makes a phonetic part explain the meaning.
 * Pictographic characters get the origin hint instead of drawing strokes; characters without etymology get nothing.
 */
export function singleCharFacts(ch, map, labelRoles) {
  const e = map.get(ch);
  const type = e?.etymology?.type;
  if (!e || !type) return null;
  const hint = e.etymology.hint ? `; origin: ${e.etymology.hint}` : "";
  if (type === "pictographic") return e.etymology.hint ? `${ch}: pictographic${hint}` : null;
  const parts = idsLeaves(e.decomposition);
  if (parts.length < 2) return hint ? `${ch}: ${type}${hint}` : null;
  const phon = e.etymology.phonetic;
  const sem = e.etymology.semantic;
  const tag = (p) => (!labelRoles ? "" : p === phon && p !== sem ? " [sound only]" : p === sem ? " [meaning]" : "");
  const gloss = (p) => {
    const g = shortDef(p, map);
    return g ? ` (${g})` : "";
  };
  return `${ch}: ${type}; parts: ${parts.map((p) => `${p}${gloss(p)}${tag(p)}`).join(" + ")}${hint}`;
}

/** The line the app assembles: each character's picture group followed by its own tone cue, then the meaning. */
export function assembleLine(groups, syllables, meaning, style = "arrow") {
  const cues = syllables.map((s) => toneMark(toneOf(s), style));
  return syllables.map((_, i) => `${(groups[i] ?? "").trim()}${cues[i]}`).join("") + String(meaning ?? "").trim();
}

// ── round 5: tone numbers instead of arrows, deterministic story repair, role-gated facts ──

export const TONE_SUP = { 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁰" };
export const TONE_SUB = { 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₀" };

/** The tone mark the app attaches after a picture group, by style: arrow (legend), sup, sub or plain digits. */
export function toneMark(tone, style = "arrow") {
  if (style === "sup") return TONE_SUP[tone];
  if (style === "sub") return TONE_SUB[tone];
  if (style === "digit") return String(tone === 5 ? 0 : tone);
  return TONE_CUES[tone];
}

/** Tone numbers found as superscripts in a line. */
export function extractSup(line) {
  const rev = { "¹": 1, "²": 2, "³": 3, "⁴": 4, "⁰": 5 };
  return Array.from(String(line).matchAll(/[¹²³⁴⁰]/g), (m) => rev[m[0]]);
}

/** Facts for a single character that keep only what a learner can use: the meaning part, never the sound part. */
export function semanticFacts(ch, map) {
  const e = map.get(ch);
  const type = e?.etymology?.type;
  if (!e || !type) return null;
  const hint = e.etymology.hint ? `; origin: ${e.etymology.hint}` : "";
  if (type === "pictographic") return e.etymology.hint ? `${ch}: pictographic${hint}` : null;
  const gloss = (p) => shortDef(p, map);
  if (type === "pictophonetic") {
    const sem = e.etymology.semantic;
    if (!sem || !gloss(sem)) return null;
    return `${ch}: pictophonetic; meaning part: ${sem} (${gloss(sem)}); the other part only hints at the sound, so do not picture it${hint}`;
  }
  const parts = idsLeaves(e.decomposition);
  if (parts.length < 2 || !parts.every((p) => gloss(p))) return e.etymology.hint ? `${ch}: ${type}${hint}` : null;
  return `${ch}: ${type}; parts: ${parts.map((p) => `${p} (${gloss(p)})`).join(" + ")}${hint}`;
}

/**
 * The app can write the word's own pinyin itself, so it does not have to trust the model with it: every run of the
 * word's own characters in the story gets the right pinyin after it (added if missing, replaced if wrong or a gloss).
 * Parts and other characters are left alone. Returns the repaired story and how many runs were touched.
 */
export function repairStoryPinyin(story, word, syllables) {
  const chars = Array.from(word);
  if (chars.length !== syllables.length) return { story, changes: 0 };
  const own = new Set(chars);
  let changes = 0;
  const out = String(story).replace(/([㐀-䶿一-鿿豈-﫿]+)(\s*[(（]([^)）]*)[)）])?/gu, (whole, run, _p, inner) => {
    const rc = Array.from(run);
    if (!rc.every((c) => own.has(c))) return whole;
    const idx = word.indexOf(run);
    if (idx < 0) return whole;
    const start = Array.from(word.slice(0, idx)).length;
    const expected = syllables.slice(start, start + rc.length).join(" ");
    if (inner !== undefined && normPinyinRun(inner) === normPinyinRun(expected)) return whole;
    changes++;
    return `${run} (${expected})`;
  });
  return { story: out, changes };
}
