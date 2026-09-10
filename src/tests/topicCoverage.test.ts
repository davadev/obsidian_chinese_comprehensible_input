import { describe, expect, it } from "vitest";
import {
  LOW_DATA_MIN,
  MAX_RADAR_TOPICS,
  MIN_RADAR_TOPICS,
  resolveRadarTopics,
  topicSpokes,
} from "../vocabulary/topicCoverage";
import {
  DEFAULT_RADAR_TOPICS,
  TOPIC_IDS,
  TOPIC_MAP,
  TOPIC_WORD_COUNTS,
} from "../dictionary/topicMap.generated";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";

/**
 * The radar renderer cannot be unit-tested (no jsdom; `activeDocument` and
 * `container.empty()` do not exist here), so these tests are the whole safety
 * net for the maths and the defensive input handling.
 */

function rec(over: Partial<WordRecord> = {}): WordRecord {
  return {
    key: "k",
    surfaces: ["医生"],
    simplified: "医生",
    status: "new",
    seenCount: 0,
    recentSeenAt: [],
    dailySeenCounts: {},
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...over,
  };
}

/** A record for `word` in the given state. */
function word(w: string, status: WordStatus): WordRecord {
  return rec({ key: `${w}|x`, simplified: w, surfaces: [w], status });
}

/** Every word the shipped table assigns to `topic`. */
function wordsIn(topic: string): string[] {
  const wanted = TOPIC_IDS.indexOf(topic);
  const out: string[] = [];
  for (const [w, packed] of Object.entries(TOPIC_MAP)) {
    const codes = packed.slice(0, packed.indexOf("|"));
    for (const ch of codes) {
      if (parseInt(ch, 36) === wanted) {
        out.push(w);
        break;
      }
    }
  }
  return out;
}

const only = (id: string, spokes: ReturnType<typeof topicSpokes>) =>
  spokes.find((s) => s.id === id)!;

describe("topicSpokes — join", () => {
  it("counts a two-topic word toward both denominators", () => {
    // 医生 is health_body + work_career in the shipped table.
    const s = topicSpokes([word("医生", "known")], ["health_body", "work_career"]);
    expect(only("health_body", s).known).toBe(1);
    expect(only("work_career", s).known).toBe(1);
  });

  it("matches on simplified even though key carries a |pinyin suffix", () => {
    const r = rec({ key: "医生|yi1 sheng1", simplified: "医生", status: "known" });
    expect(only("health_body", topicSpokes([r], ["health_body"])).known).toBe(1);
  });

  it("falls back to surfaces[0] when simplified is absent (pre-existing records)", () => {
    const r = rec({ key: "医生|yi1 sheng1", simplified: undefined, surfaces: ["医生"], status: "known" });
    expect(only("health_body", topicSpokes([r], ["health_body"])).known).toBe(1);
  });

  it("matches a traditional-vault record, which still carries simplified", () => {
    const r = rec({ key: "医生|yi1 sheng1", simplified: "医生", surfaces: ["醫生"], status: "known" });
    expect(only("health_body", topicSpokes([r], ["health_body"])).known).toBe(1);
  });

  it("ignores a record that is not in the topic table at all", () => {
    const s = topicSpokes([word("蕲", "unknown"), word("zzz", "known")], ["health_body"]);
    const h = only("health_body", s);
    expect(h.known + h.partial + h.unknown + h.new).toBe(0);
  });

  it("counts a headword once even when two records resolve to it", () => {
    const a = rec({ key: "长|chang2", simplified: "医生", surfaces: ["医生"], status: "known" });
    const b = rec({ key: "长|zhang3", simplified: "医生", surfaces: ["医生"], status: "unknown" });
    const h = only("health_body", topicSpokes([a, b], ["health_body"]));
    expect(h.known + h.unknown).toBe(1);
  });
});

describe("topicSpokes — bucketing", () => {
  it("scores known 1.0 and partial 0.5", () => {
    const all = wordsIn("food_drink");
    const allKnown = topicSpokes(all.map((w) => word(w, "known")), ["food_drink"])[0];
    const allPartial = topicSpokes(
      all.map((w) => word(w, "meaningKnownPinyinUnknown")),
      ["food_drink"]
    )[0];
    expect(allKnown.coverage).toBeCloseTo(1, 6);
    expect(allPartial.coverage).toBeCloseTo(0.5, 6);
  });

  it("scores unknown and new as zero", () => {
    const all = wordsIn("food_drink");
    for (const st of ["unknown", "new"] as const) {
      expect(topicSpokes(all.map((w) => word(w, st)), ["food_drink"])[0].coverage).toBe(0);
    }
  });

  it("excludes ignored words from BOTH numerator and denominator", () => {
    const all = wordsIn("sport");
    // Ignore everything but one word, and know that word: coverage is 1.0
    // because the ignored words left the denominator entirely.
    const records = all.map((w, i) => word(w, i === 0 ? "known" : "ignored"));
    const s = topicSpokes(records, ["sport"])[0];
    expect(s.known).toBe(1);
    expect(s.ignored).toBe(all.length - 1);
    expect(s.total).toBe(TOPIC_WORD_COUNTS["sport"] - s.ignored);
    expect(s.coverage).toBeCloseTo(1, 6);
  });

  it("does not divide by zero when every word in a topic is ignored", () => {
    const all = wordsIn("sport");
    const s = topicSpokes(all.map((w) => word(w, "ignored")), ["sport"])[0];
    expect(s.total).toBe(0);
    expect(s.coverage).toBe(0);
    expect(Number.isFinite(s.coverage)).toBe(true);
  });

  it("keeps buckets consistent: known+partial+unknown+new+untracked === total", () => {
    const all = wordsIn("clothing_appearance");
    const states: WordStatus[] = ["known", "unknown", "new", "meaningKnownPinyinUnknown"];
    const records = all.slice(0, 12).map((w, i) => word(w, states[i % states.length]));
    const s = topicSpokes(records, ["clothing_appearance"])[0];
    expect(s.known + s.partial + s.unknown + s.new + s.untracked).toBe(s.total);
    for (const n of [s.known, s.partial, s.unknown, s.new, s.ignored, s.untracked, s.total]) {
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it("floors untracked at zero", () => {
    const all = wordsIn("sport");
    const s = topicSpokes(all.map((w) => word(w, "known")), ["sport"])[0];
    expect(s.untracked).toBe(0);
  });
});

describe("topicSpokes — frequency weighting", () => {
  it("rewards common words over the same COUNT of rare ones", () => {
    // Sort a topic's words by the shipped frequency bucket, then compare
    // knowing the N most common against the N rarest.
    const all = wordsIn("nature_environment");
    const bucket = (w: string) => Number(TOPIC_MAP[w].slice(TOPIC_MAP[w].lastIndexOf("|") + 1));
    const sorted = [...all].sort((a, b) => bucket(a) - bucket(b));
    const n = 20;
    const common = topicSpokes(sorted.slice(0, n).map((w) => word(w, "known")), [
      "nature_environment",
    ])[0];
    const rare = topicSpokes(sorted.slice(-n).map((w) => word(w, "known")), [
      "nature_environment",
    ])[0];
    expect(common.known).toBe(rare.known);
    expect(common.coverage).toBeGreaterThan(rare.coverage);
  });

  it("gives unranked words a real weight, never 0 or NaN", () => {
    // Every word must contribute to the denominator, so a topic where the
    // learner knows everything is exactly 1.0 regardless of ranking.
    const all = wordsIn("religion_belief");
    const s = topicSpokes(all.map((w) => word(w, "known")), ["religion_belief"])[0];
    expect(Number.isFinite(s.coverage)).toBe(true);
    expect(s.coverage).toBeCloseTo(1, 6);
  });
});

describe("topicSpokes — relative mode", () => {
  it("scores ~1.0 everywhere for a learner who is uniform across levels", () => {
    // Knowing every topical word means every level rate is 1, so actual ===
    // expected on every spoke.
    const records = Object.keys(TOPIC_MAP).map((w) => word(w, "known"));
    const s = topicSpokes(records, [...DEFAULT_RADAR_TOPICS]);
    for (const spoke of s) expect(spoke.relative).toBeCloseTo(1, 6);
  });

  it("scores above 1 on a topic the learner is over-weighted in", () => {
    const food = wordsIn("food_drink");
    const other = wordsIn("society_politics").slice(0, 40);
    const records = [
      ...food.map((w) => word(w, "known")),
      ...other.map((w) => word(w, "unknown")),
    ];
    const s = topicSpokes(records, ["food_drink", "society_politics"]);
    expect(only("food_drink", s).relative).toBeGreaterThan(1.15);
    expect(only("society_politics", s).relative).toBeLessThan(1);
  });

  it("returns exactly 1 — not Infinity or NaN — when nothing is expected", () => {
    const s = topicSpokes([], ["food_drink"])[0];
    expect(s.relative).toBe(1);
  });
});

describe("resolveRadarTopics — defensive input", () => {
  it("returns the default for anything that is not a usable array", () => {
    for (const bad of [undefined, null, "", 42, {}, [1, 2], ["nope"], [{}]]) {
      const out = resolveRadarTopics(bad);
      expect(out.length).toBeGreaterThanOrEqual(MIN_RADAR_TOPICS);
      for (const id of out) expect(TOPIC_IDS).toContain(id);
    }
  });

  it("drops ids the current taxonomy no longer has", () => {
    expect(resolveRadarTopics(["food_drink", "retired_topic", "sport"])).toEqual([
      "food_drink",
      "sport",
      DEFAULT_RADAR_TOPICS[0],
    ]);
  });

  it("dedupes repeats", () => {
    expect(resolveRadarTopics(["sport", "sport", "sport", "food_drink"])).toEqual([
      "sport",
      "food_drink",
      DEFAULT_RADAR_TOPICS[0],
    ]);
  });

  it("clamps above the maximum", () => {
    expect(resolveRadarTopics([...TOPIC_IDS])).toHaveLength(MAX_RADAR_TOPICS);
  });

  it("pads below the minimum", () => {
    expect(resolveRadarTopics(["sport"]).length).toBe(MIN_RADAR_TOPICS);
  });

  it("leaves a valid selection untouched", () => {
    const picked = [...DEFAULT_RADAR_TOPICS];
    expect(resolveRadarTopics(picked)).toEqual(picked);
  });
});

describe("topicSpokes — boundaries and invariants", () => {
  it("handles an empty vault without throwing", () => {
    const s = topicSpokes([], [...DEFAULT_RADAR_TOPICS]);
    expect(s).toHaveLength(DEFAULT_RADAR_TOPICS.length);
    for (const spoke of s) {
      expect(spoke.coverage).toBe(0);
      expect(spoke.untracked).toBe(spoke.total);
      expect(spoke.lowData).toBe(true);
    }
  });

  it("returns a zero spoke for an unknown topic id rather than crashing", () => {
    const s = topicSpokes([word("医生", "known")], ["not_a_topic"])[0];
    expect(s.total).toBe(0);
    expect(s.coverage).toBe(0);
  });

  it("flips lowData at the tracked threshold", () => {
    const all = wordsIn("nature_environment");
    const under = topicSpokes(
      all.slice(0, LOW_DATA_MIN - 1).map((w) => word(w, "unknown")),
      ["nature_environment"]
    )[0];
    const over = topicSpokes(
      all.slice(0, LOW_DATA_MIN).map((w) => word(w, "unknown")),
      ["nature_environment"]
    )[0];
    expect(under.lowData).toBe(true);
    expect(over.lowData).toBe(false);
  });

  it("keeps every value finite and in range for a randomised record set", () => {
    const words = Object.keys(TOPIC_MAP);
    const states: WordStatus[] = ["known", "unknown", "new", "ignored", "meaningKnownPinyinUnknown"];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const records = words.filter(() => rand() < 0.4).map((w) => word(w, states[Math.floor(rand() * states.length)]));
    for (const s of topicSpokes(records, [...TOPIC_IDS])) {
      expect(Number.isFinite(s.coverage)).toBe(true);
      expect(s.coverage).toBeGreaterThanOrEqual(0);
      expect(s.coverage).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.relative)).toBe(true);
      expect(s.relative).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic", () => {
    const records = [word("医生", "known"), word("苹果", "unknown")];
    const a = topicSpokes(records, [...DEFAULT_RADAR_TOPICS]);
    const b = topicSpokes(records, [...DEFAULT_RADAR_TOPICS]);
    expect(a).toEqual(b);
  });

  it("handles 10k records well under a second", () => {
    const words = Object.keys(TOPIC_MAP);
    const records: WordRecord[] = [];
    for (let i = 0; i < 10000; i++) records.push(word(words[i % words.length], "known"));
    const t0 = Date.now();
    topicSpokes(records, [...TOPIC_IDS]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
