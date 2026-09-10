import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADAR_TOPICS,
  TOPIC_IDS,
  TOPIC_LABELS,
  TOPIC_MAP,
  TOPIC_MAP_SIZE,
  TOPIC_WORD_COUNTS,
} from "../dictionary/topicMap.generated";

/**
 * Guards the generated table. `npm run build:topics` regenerates it from
 * `scripts/data/topic-lists.json`, so these assertions are what catch a
 * mis-generated or truncated rebuild before it ships.
 */

/** `"03|4|5"` → topic indices, HSK level, frequency bucket. */
function unpack(packed: string) {
  const a = packed.indexOf("|");
  const b = packed.indexOf("|", a + 1);
  return {
    topics: [...packed.slice(0, a)].map((c) => parseInt(c, 36)),
    level: Number(packed.slice(a + 1, b)),
    bucket: Number(packed.slice(b + 1)),
  };
}

describe("topicMap.generated", () => {
  it("declares a size matching the real entry count", () => {
    expect(Object.keys(TOPIC_MAP)).toHaveLength(TOPIC_MAP_SIZE);
    expect(TOPIC_MAP_SIZE).toBeGreaterThan(3000);
  });

  it("stays inside the base36 single-character topic encoding", () => {
    // The generator packs one base36 digit per topic. Past 36 topics the
    // encoding silently collapses, so this is a hard bound, not a style note.
    expect(TOPIC_IDS.length).toBeLessThanOrEqual(36);
    expect(TOPIC_IDS.length).toBeGreaterThan(0);
    expect(new Set(TOPIC_IDS).size).toBe(TOPIC_IDS.length);
  });

  it("gives every topic a Chinese and an English label", () => {
    for (const id of TOPIC_IDS) {
      expect(TOPIC_LABELS[id]?.zh, id).toBeTruthy();
      expect(TOPIC_LABELS[id]?.en, id).toBeTruthy();
    }
  });

  it("keeps every packed field in range", () => {
    for (const [word, packed] of Object.entries(TOPIC_MAP)) {
      const { topics, level, bucket } = unpack(packed);
      expect(topics.length, word).toBeGreaterThan(0);
      for (const t of topics) {
        expect(t, word).toBeGreaterThanOrEqual(0);
        expect(t, word).toBeLessThan(TOPIC_IDS.length);
      }
      // 1-6 are HSK 2.0 levels; 7 is the HSK 3.0 "7-9" band.
      expect(level, word).toBeGreaterThanOrEqual(1);
      expect(level, word).toBeLessThanOrEqual(7);
      expect(bucket, word).toBeGreaterThanOrEqual(0);
      expect(bucket, word).toBeLessThanOrEqual(9);
    }
  });

  it("has TOPIC_WORD_COUNTS agreeing with the map, and no empty topic", () => {
    const tally = Object.fromEntries(TOPIC_IDS.map((id) => [id, 0]));
    for (const packed of Object.values(TOPIC_MAP)) {
      for (const t of unpack(packed).topics) tally[TOPIC_IDS[t]]++;
    }
    expect(tally).toEqual({ ...TOPIC_WORD_COUNTS });
    for (const id of TOPIC_IDS) expect(TOPIC_WORD_COUNTS[id], id).toBeGreaterThan(0);
  });

  it("places sample words in their hand-assigned topics", () => {
    // Spot checks that must survive a regeneration. These are the words the
    // join was validated against, including the multi-topic cases.
    const topicsOf = (w: string) => unpack(TOPIC_MAP[w]).topics.map((i) => TOPIC_IDS[i]).sort();
    expect(topicsOf("医生")).toEqual(["health_body", "work_career"].sort());
    expect(topicsOf("护照")).toContain("travel_transport");
    expect(topicsOf("铅笔")).toContain("education");
    expect(topicsOf("自行车")).toEqual(["sport", "travel_transport"].sort());
    expect(topicsOf("鸡蛋")).toContain("food_drink");
  });

  it("returns undefined for words with no topic", () => {
    // Function and abstract words were reviewed and deliberately left out.
    expect(TOPIC_MAP["的"]).toBeUndefined();
    expect(TOPIC_MAP["然而"]).toBeUndefined();
    expect(TOPIC_MAP["xxxxx"]).toBeUndefined();
    expect(TOPIC_MAP[""]).toBeUndefined();
  });

  it("ships default radar topics that all exist", () => {
    // A rename that missed the defaults would break the first-run dashboard.
    expect(DEFAULT_RADAR_TOPICS.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_RADAR_TOPICS.length).toBeLessThanOrEqual(10);
    for (const id of DEFAULT_RADAR_TOPICS) expect(TOPIC_IDS).toContain(id);
    expect(new Set(DEFAULT_RADAR_TOPICS).size).toBe(DEFAULT_RADAR_TOPICS.length);
  });
});
