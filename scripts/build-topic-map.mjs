#!/usr/bin/env node
/**
 * Build script: turns the hand-authored topic list in
 * `scripts/data/topic-lists.json` into `src/dictionary/topicMap.generated.ts`,
 * the compact table the plugin imports at runtime.
 *
 * Sources
 * -------
 * - Topic assignments: original work for this project (MIT). Every one of the
 *   4,806 entries was assigned by hand; the ~4,200 HSK words that carry no
 *   topic were reviewed and deliberately left out (idioms, generic verbs,
 *   function words, abstract nouns with no subject).
 * - HSK 1-6 headwords: https://github.com/glxxyz/hskhsk.com (MIT, (c) 2020 Alan Davies)
 * - HSK 7-9 headwords + frequency ranks:
 *   https://github.com/drkameleon/complete-hsk-vocabulary (MIT)
 *   <- https://github.com/elkmovie/hsk30 (MIT)
 *
 * Only the simplified headword, its HSK level and a coarse frequency bucket are
 * imported. No definitions, pinyin, examples, audio or gloss text.
 *
 * Unlike `build-hsk-map.mjs`, this script does NOT fetch anything: the input is
 * a frozen authored artifact committed to the repo, so a network round-trip
 * would only make the build nondeterministic.
 *
 * Run: `npm run build:topics`
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IN_PATH = join(ROOT, "scripts", "data", "topic-lists.json");
const OUT_PATH = join(ROOT, "src", "dictionary", "topicMap.generated.ts");

/** Base36 digits — one char per topic index, so `TOPIC_IDS` may not exceed 36. */
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Frequency rank -> coarse bucket 0..9 (0 = most common, 9 = unranked).
 *
 * Explicit rank edges rather than a log curve: a log10-based bucketing put
 * 4,534 of the 4,806 words into just three buckets, which made the weighting
 * almost uniform and defeated the point.
 */
const FREQ_EDGES = [500, 1000, 2000, 4000, 8000, 16000, 32000, 64000];
function freqBucket(rank) {
  if (!rank || rank <= 0) return 9;
  for (let i = 0; i < FREQ_EDGES.length; i++) {
    if (rank < FREQ_EDGES[i]) return i;
  }
  return 8;
}

function die(msg) {
  console.error(`build-topic-map: ${msg}`);
  process.exit(1);
}

const raw = JSON.parse(await readFile(IN_PATH, "utf8"));
const topics = raw.topics;
const words = raw.words;

// --- loud failure guards: a malformed input must break the build, not emit a
// --- silently truncated table (the build-hsk-map.mjs convention).
if (!Array.isArray(topics) || topics.length === 0) die("no topics in input");
if (topics.length > B36.length) {
  die(`${topics.length} topics exceeds the ${B36.length}-topic base36 encoding limit`);
}
for (const t of topics) {
  if (!t?.id || !t?.zh || !t?.en || !t?.short) die(`topic entry missing id/zh/en/short: ${JSON.stringify(t)}`);
}
const ids = topics.map((t) => t.id);
if (new Set(ids).size !== ids.length) die("duplicate topic id");
const idx = new Map(ids.map((id, i) => [id, i]));

const entries = Object.entries(words);
if (entries.length < 3000) die(`only ${entries.length} words — input file may be truncated`);

const counts = Object.fromEntries(ids.map((id) => [id, 0]));
const packed = [];
for (const [word, rec] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  if (!Array.isArray(rec.t) || rec.t.length === 0) die(`"${word}" has no topics`);
  if (!Number.isInteger(rec.l) || rec.l < 1 || rec.l > 7) die(`"${word}" has bad level ${rec.l}`);
  let code = "";
  for (const t of rec.t) {
    if (!idx.has(t)) die(`"${word}" references unknown topic "${t}"`);
    code += B36[idx.get(t)];
    counts[t]++;
  }
  packed.push(`${JSON.stringify(word)}:"${code}|${rec.l}|${freqBucket(rec.f)}"`);
}
for (const [id, n] of Object.entries(counts)) {
  if (n === 0) die(`topic "${id}" has no words`);
}

const out = `// GENERATED FILE — do not edit by hand. Run \`npm run build:topics\` to regenerate.
// Source: scripts/data/topic-lists.json
//
// Topic assignments: original work for this project (MIT). Headwords and levels:
//   HSK 1-6  — https://github.com/glxxyz/hskhsk.com (MIT, (c) 2020 Alan Davies)
//   HSK 7-9  — https://github.com/drkameleon/complete-hsk-vocabulary (MIT)
//              <- https://github.com/elkmovie/hsk30 (MIT)
// Only the simplified headword, HSK level and a coarse frequency bucket are
// imported. No definitions, pinyin, examples or audio.
//
// TOPIC_MAP value format: "<topicChars>|<hskLevel>|<freqBucket>"
//   topicChars  one base36 digit per topic, indexing TOPIC_IDS
//   hskLevel    1-6 for HSK 2.0 levels, 7 for the HSK 3.0 "7-9" band
//   freqBucket  0 = most common .. 8 = rarest ranked, 9 = unranked

export const TOPIC_IDS: readonly string[] = [
${ids.map((id) => `  ${JSON.stringify(id)},`).join("\n")}
];

export const TOPIC_LABELS: Readonly<
  Record<string, { zh: string; en: string; short: string }>
> = {
${topics.map((t) => `  ${JSON.stringify(t.id)}: { zh: ${JSON.stringify(t.zh)}, en: ${JSON.stringify(t.en)}, short: ${JSON.stringify(t.short)} },`).join("\n")}
};

/** Spokes shown on first open — the eight topics richest in HSK 1-4 vocabulary,
 *  so a beginner sees populated axes instead of empty ones. */
export const DEFAULT_RADAR_TOPICS: readonly string[] = [
  "language_comm",
  "food_drink",
  "emotion_feeling",
  "health_body",
  "nature_environment",
  "education",
  "travel_transport",
  "family_social",
];

export const TOPIC_MAP_SIZE = ${entries.length};

/** Words carrying each topic — the denominator for coverage tooltips. */
export const TOPIC_WORD_COUNTS: Readonly<Record<string, number>> = {
${ids.map((id) => `  ${JSON.stringify(id)}: ${counts[id]},`).join("\n")}
};

export const TOPIC_MAP: Readonly<Record<string, string>> = {${packed.join(",")}};
`;

await writeFile(OUT_PATH, out, "utf8");
console.log(
  `build-topic-map: wrote ${OUT_PATH.replace(ROOT + "/", "")} — ` +
    `${entries.length} words, ${ids.length} topics, ${(out.length / 1024).toFixed(1)} KB`
);
