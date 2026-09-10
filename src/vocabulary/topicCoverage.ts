import {
  DEFAULT_RADAR_TOPICS,
  TOPIC_IDS,
  TOPIC_MAP,
  TOPIC_WORD_COUNTS,
} from "../dictionary/topicMap.generated";
import { colorOf } from "./axes";
import { WordRecord } from "./VocabularyTypes";

/**
 * Topic coverage — "what share of the text I'd actually meet in this topic can
 * I read?" — for the dashboard radar.
 *
 * Two decisions worth stating, because both differ from the HSK coverage
 * section directly above it in the dashboard:
 *
 * 1. **Frequency weighting.** A plain word count collapses every topic into a
 *    narrow band, because the HSK 7-9 band tripled the denominator with words
 *    nobody below HSK 7 knows (measured: every topic landed between 4% and 28%,
 *    a shapeless blob). Weighting by frequency asks the question a reader
 *    actually cares about, and restores a usable spread at every level.
 *
 * 2. **`ignored` is excluded from BOTH sides of the ratio.** A word the learner
 *    deliberately ignored — a name, a variant — must not count against their
 *    coverage. `renderHskCoverageSection` folds `ignored` into `tracked`;
 *    `estimateLearnerHsk` skips it. We skip it.
 */

/** Radar needs at least a triangle; more than ten spokes is unreadable on a phone. */
export const MIN_RADAR_TOPICS = 3;
export const MAX_RADAR_TOPICS = 10;

/** Below this many tracked words a spoke is noise, and is drawn as such. */
export const LOW_DATA_MIN = 10;

/**
 * Representative rank for each frequency bucket, used as `1/sqrt(mid)`.
 * Bucket 9 is "unranked" and is treated as the rarest — never as weight 0,
 * which would silently drop the word from the denominator.
 */
const BUCKET_MID = [250, 750, 1500, 3000, 6000, 12000, 24000, 48000, 90000, 90000];

function weightForBucket(bucket: number): number {
  const mid = BUCKET_MID[bucket] ?? BUCKET_MID[BUCKET_MID.length - 1];
  return 1 / Math.sqrt(mid);
}

export interface TopicSpoke {
  id: string;
  known: number;
  partial: number;
  unknown: number;
  new: number;
  ignored: number;
  /** Words in this topic the learner has never met. Never negative. */
  untracked: number;
  /** Words in this topic, excluding ones the learner ignored. */
  total: number;
  /** 0..1, frequency-weighted. */
  coverage: number;
  /** actual / expected for this learner's level. 1 when there is nothing to expect. */
  relative: number;
  lowData: boolean;
}

interface Decoded {
  topics: string[];
  level: number;
  weight: number;
}

let decodedCache: Map<string, Decoded> | null = null;

/** Decode the packed `"<topicChars>|<level>|<bucket>"` table once, lazily. */
function decodedMap(): Map<string, Decoded> {
  if (decodedCache) return decodedCache;
  const out = new Map<string, Decoded>();
  for (const [word, packed] of Object.entries(TOPIC_MAP)) {
    const bar = packed.indexOf("|");
    const bar2 = packed.indexOf("|", bar + 1);
    if (bar < 0 || bar2 < 0) continue;
    const codes = packed.slice(0, bar);
    const level = Number(packed.slice(bar + 1, bar2));
    const bucket = Number(packed.slice(bar2 + 1));
    const topics: string[] = [];
    for (const ch of codes) {
      const id = TOPIC_IDS[parseInt(ch, 36)];
      if (id) topics.push(id);
    }
    out.set(word, { topics, level, weight: weightForBucket(bucket) });
  }
  decodedCache = out;
  return out;
}

/** The word a record represents in the topic table. */
function lookupKey(rec: WordRecord): string | undefined {
  // Never `rec.key` — it carries a `|pinyin` suffix for any record whose
  // dictionary entry had pinyin, so it would never match a bare headword.
  return rec.simplified ?? rec.surfaces?.[0];
}

/** `known` scores 1, `partial` 0.5, everything else 0. `ignored` never reaches here. */
function scoreOf(rec: WordRecord): number {
  const c = colorOf(rec);
  if (c === "known") return 1;
  if (c === "partial") return 0.5;
  return 0;
}

/**
 * Sanitise a persisted spoke selection.
 *
 * Anything can arrive here: a hand-edited `data.json`, a settings blob synced
 * from a device on an older version, or a selection naming topics that a later
 * taxonomy no longer has. Always returns a usable list.
 */
export function resolveRadarTopics(saved: unknown): string[] {
  const valid = new Set(TOPIC_IDS);
  const out: string[] = [];
  if (Array.isArray(saved)) {
    for (const raw of saved) {
      if (typeof raw !== "string") continue;
      if (!valid.has(raw)) continue;
      if (out.includes(raw)) continue;
      out.push(raw);
      if (out.length === MAX_RADAR_TOPICS) break;
    }
  }
  // Too few to draw a polygon — top up from the defaults, then from the rest.
  for (const id of [...DEFAULT_RADAR_TOPICS, ...TOPIC_IDS]) {
    if (out.length >= MIN_RADAR_TOPICS) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Per-topic coverage for the given spokes.
 *
 * `records` is the whole vocabulary store — the radar describes the learner,
 * not the note currently in scope, matching `renderHskCoverageSection`.
 */
export function topicSpokes(records: WordRecord[], topicIds: string[]): TopicSpoke[] {
  const table = decodedMap();

  // Per-topic accumulators.
  const known = new Map<string, number>();
  const partial = new Map<string, number>();
  const unknown = new Map<string, number>();
  const fresh = new Map<string, number>();
  const ignored = new Map<string, number>();
  const gotWeight = new Map<string, number>();
  const ignoredWeight = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

  // Learner's own weighted known-rate per HSK level, for the relative metric.
  const levelGot = new Map<number, number>();
  const levelAll = new Map<number, number>();
  for (const { level, weight } of table.values()) {
    levelAll.set(level, (levelAll.get(level) ?? 0) + weight);
  }

  const seen = new Set<string>();
  for (const rec of records) {
    const key = lookupKey(rec);
    if (!key) continue;
    const entry = table.get(key);
    if (!entry) continue;
    // Two records can resolve to the same headword (homographs differing only
    // by pinyin). Count the word once so counts can never exceed the table.
    if (seen.has(key)) continue;
    seen.add(key);

    const state = colorOf(rec);
    if (state === "ignored") {
      for (const t of entry.topics) {
        bump(ignored, t);
        bump(ignoredWeight, t, entry.weight);
      }
      continue;
    }

    const score = scoreOf(rec);
    levelGot.set(entry.level, (levelGot.get(entry.level) ?? 0) + entry.weight * score);

    for (const t of entry.topics) {
      if (state === "known") bump(known, t);
      else if (state === "partial") bump(partial, t);
      else if (state === "unknown") bump(unknown, t);
      else bump(fresh, t);
      if (score > 0) bump(gotWeight, t, entry.weight * score);
    }
  }

  // Total weight per topic, and expected weight given this learner's per-level rate.
  const totalWeight = new Map<string, number>();
  const expectedWeight = new Map<string, number>();
  for (const { topics, level, weight } of table.values()) {
    const all = levelAll.get(level) ?? 0;
    const p = all > 0 ? (levelGot.get(level) ?? 0) / all : 0;
    for (const t of topics) {
      totalWeight.set(t, (totalWeight.get(t) ?? 0) + weight);
      expectedWeight.set(t, (expectedWeight.get(t) ?? 0) + weight * p);
    }
  }

  return topicIds.map((id) => {
    const ign = ignored.get(id) ?? 0;
    const k = known.get(id) ?? 0;
    const p = partial.get(id) ?? 0;
    const u = unknown.get(id) ?? 0;
    const n = fresh.get(id) ?? 0;
    const tracked = k + p + u + n;
    const listed = TOPIC_WORD_COUNTS[id] ?? 0;
    const total = Math.max(0, listed - ign);

    // Ignored words leave the denominator entirely, on both metrics.
    const denom = (totalWeight.get(id) ?? 0) - (ignoredWeight.get(id) ?? 0);
    const got = gotWeight.get(id) ?? 0;
    const expected = Math.max(0, (expectedWeight.get(id) ?? 0) - (ignoredWeight.get(id) ?? 0));

    return {
      id,
      known: k,
      partial: p,
      unknown: u,
      new: n,
      ignored: ign,
      untracked: Math.max(0, total - tracked),
      total,
      coverage: denom > 0 ? got / denom : 0,
      relative: expected > 0 ? got / expected : 1,
      lowData: tracked < LOW_DATA_MIN,
    };
  });
}
