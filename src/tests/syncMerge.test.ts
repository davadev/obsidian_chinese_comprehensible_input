import { describe, it, expect } from "vitest";
import { mergeForSync, mergeStoresForSync, resolveStatus } from "../vocabulary/syncMerge";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { DEFAULT_STATUS_PRIORITY } from "../settings/defaults";

function rec(over: Partial<WordRecord> = {}): WordRecord {
  return {
    key: "k",
    surfaces: ["你好"],
    simplified: "你好",
    pinyin: "nǐ hǎo",
    status: "new",
    seenCount: 0,
    recentSeenAt: [],
    dailySeenCounts: {},
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...over,
  };
}

describe("resolveStatus", () => {
  it("new always loses to any classified status", () => {
    const a = rec({ status: "new", updatedAt: "2026-06-12T10:00:00.000Z" });
    const b = rec({ status: "unknown", updatedAt: "2026-06-12T01:00:00.000Z" });
    expect(resolveStatus(a, b, DEFAULT_STATUS_PRIORITY).status).toBe("unknown");
    expect(resolveStatus(b, a, DEFAULT_STATUS_PRIORITY).status).toBe("unknown");
  });

  it("priority list beats timestamp", () => {
    const knownOlder = rec({ status: "known", updatedAt: "2026-06-10T00:00:00.000Z" });
    const ignoredNewer = rec({ status: "ignored", updatedAt: "2026-06-12T00:00:00.000Z" });
    // Default order has ignored first → ignored wins despite being equally specific.
    expect(resolveStatus(knownOlder, ignoredNewer, DEFAULT_STATUS_PRIORITY).status).toBe(
      "ignored"
    );
    // User-reordered list with known first → known wins.
    const knownFirst: WordStatus[] = [
      "known",
      "ignored",
      "meaningKnownPinyinUnknown",
      "pinyinKnownMeaningUnknown",
      "charactersUnknown",
      "unknown",
      "new",
    ];
    expect(resolveStatus(knownOlder, ignoredNewer, knownFirst).status).toBe("known");
  });

  it("timestamp breaks ties when statuses match", () => {
    const older = rec({ status: "known", updatedAt: "2026-06-10T00:00:00.000Z" });
    const newer = rec({ status: "known", updatedAt: "2026-06-12T00:00:00.000Z" });
    expect(resolveStatus(older, newer, DEFAULT_STATUS_PRIORITY)).toBe(newer);
  });
});

describe("mergeForSync field rules", () => {
  it("dailySeenCounts takes the max per day, not the sum", () => {
    const a = rec({ dailySeenCounts: { "2026-06-10": 3, "2026-06-11": 1 } });
    const b = rec({ dailySeenCounts: { "2026-06-10": 5, "2026-06-12": 2 } });
    const m = mergeForSync(a, b, { statusPriority: DEFAULT_STATUS_PRIORITY });
    expect(m.dailySeenCounts).toEqual({
      "2026-06-10": 5,
      "2026-06-11": 1,
      "2026-06-12": 2,
    });
    expect(m.seenCount).toBe(8);
  });

  it("recentSeenAt is union + sorted + capped", () => {
    const a = rec({
      recentSeenAt: ["2026-06-10T00:00:00Z", "2026-06-12T00:00:00Z"],
    });
    const b = rec({
      recentSeenAt: ["2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"],
    });
    const m = mergeForSync(a, b, {
      statusPriority: DEFAULT_STATUS_PRIORITY,
      recentSeenAtCap: 2,
    });
    expect(m.recentSeenAt).toEqual([
      "2026-06-11T00:00:00Z",
      "2026-06-12T00:00:00Z",
    ]);
  });

  it("earliest firstSeenAt / knownAt; latest lastSeenAt / updatedAt", () => {
    const a = rec({
      firstSeenAt: "2026-05-01T00:00:00Z",
      knownAt: "2026-05-10T00:00:00Z",
      lastSeenAt: "2026-06-10T00:00:00Z",
      updatedAt: "2026-06-10T00:00:00Z",
    });
    const b = rec({
      firstSeenAt: "2026-04-01T00:00:00Z",
      knownAt: "2026-05-20T00:00:00Z",
      lastSeenAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T00:00:00Z",
    });
    const m = mergeForSync(a, b, { statusPriority: DEFAULT_STATUS_PRIORITY });
    expect(m.firstSeenAt).toBe("2026-04-01T00:00:00Z");
    expect(m.knownAt).toBe("2026-05-10T00:00:00Z");
    expect(m.lastSeenAt).toBe("2026-06-12T00:00:00Z");
    expect(m.updatedAt).toBe("2026-06-12T00:00:00Z");
  });
});

describe("mergeForSync idempotency", () => {
  it("merging the same remote twice yields the same result as once", () => {
    const local = rec({
      status: "known",
      dailySeenCounts: { "2026-06-10": 3 },
      recentSeenAt: ["2026-06-10T00:00:00Z"],
      updatedAt: "2026-06-10T00:00:00Z",
      knownAt: "2026-06-10T00:00:00Z",
      firstSeenAt: "2026-06-01T00:00:00Z",
    });
    const remote = rec({
      status: "known",
      dailySeenCounts: { "2026-06-10": 3, "2026-06-11": 2 },
      recentSeenAt: ["2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"],
      updatedAt: "2026-06-11T00:00:00Z",
      knownAt: "2026-06-10T00:00:00Z",
      firstSeenAt: "2026-06-01T00:00:00Z",
    });
    const opts = { statusPriority: DEFAULT_STATUS_PRIORITY };
    const once = mergeForSync(local, remote, opts);
    const twice = mergeForSync(once, remote, opts);
    expect(twice).toEqual(once);
    // Specifically the count must not have been re-added.
    expect(twice.seenCount).toBe(5);
    expect(twice.dailySeenCounts["2026-06-10"]).toBe(3);
  });
});

describe("mergeStoresForSync", () => {
  it("keeps records that only exist on one side and merges shared keys", () => {
    const localOnly = rec({ key: "a", surfaces: ["甲"] });
    const remoteOnly = rec({ key: "b", surfaces: ["乙"] });
    const shared = rec({
      key: "c",
      status: "known",
      dailySeenCounts: { "2026-06-10": 2 },
    });
    const sharedRemote = rec({
      key: "c",
      status: "known",
      dailySeenCounts: { "2026-06-10": 5 },
    });
    const local = { schemaVersion: 1, words: { a: localOnly, c: shared } };
    const remote = { schemaVersion: 1, words: { b: remoteOnly, c: sharedRemote } };
    const merged = mergeStoresForSync(local, remote, {
      statusPriority: DEFAULT_STATUS_PRIORITY,
    });
    expect(Object.keys(merged.words).sort()).toEqual(["a", "b", "c"]);
    expect(merged.words.c.dailySeenCounts["2026-06-10"]).toBe(5);
  });
});
