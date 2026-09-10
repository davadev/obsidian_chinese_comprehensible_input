import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { bucketTimestamps, countBeforeWindow, cumulativeCounts, progressEmptyHint } from "../ui/StatsGraph";

/**
 * `bucketTimestamps` had no direct coverage, which is why these tests come
 * first: they pin today's behaviour so the pre-window-balance work can be
 * checked against something rather than hoped at.
 *
 * Time is frozen because every function here is relative to "now".
 */
const NOW = new Date("2026-09-10T12:00:00.000Z");

describe("bucketTimestamps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns exactly windowSize buckets, oldest first", () => {
    const out = bucketTimestamps([], "day", 30);
    expect(out).toHaveLength(30);
    expect(out[0].label).toBe("2026-08-12");
    expect(out[29].label).toBe("2026-09-10");
  });

  it("counts a stamp into its own day bucket", () => {
    const out = bucketTimestamps(
      ["2026-09-10T01:00:00.000Z", "2026-09-10T23:00:00.000Z", "2026-09-01T00:00:00.000Z"],
      "day",
      30
    );
    expect(out.find((b) => b.label === "2026-09-10")!.count).toBe(2);
    expect(out.find((b) => b.label === "2026-09-01")!.count).toBe(1);
  });

  it("renders missing buckets as zero so the chart stays evenly spaced", () => {
    const out = bucketTimestamps(["2026-09-10T01:00:00.000Z"], "day", 5);
    expect(out.map((b) => b.count)).toEqual([0, 0, 0, 0, 1]);
  });

  it("skips undefined stamps", () => {
    const out = bucketTimestamps([undefined, undefined], "day", 3);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });

  it("buckets by month across a year boundary", () => {
    const out = bucketTimestamps(
      ["2025-10-05T00:00:00.000Z", "2026-01-20T00:00:00.000Z", "2026-09-02T00:00:00.000Z"],
      "month",
      12
    );
    expect(out).toHaveLength(12);
    expect(out[0].label).toBe("2025-10");
    expect(out[11].label).toBe("2026-09");
    expect(out.find((b) => b.label === "2025-10")!.count).toBe(1);
    expect(out.find((b) => b.label === "2026-01")!.count).toBe(1);
    expect(out.find((b) => b.label === "2026-09")!.count).toBe(1);
  });

  it("buckets by ISO week", () => {
    const out = bucketTimestamps(["2026-09-10T00:00:00.000Z"], "week", 12);
    expect(out).toHaveLength(12);
    expect(out[11].count).toBe(1);
  });

  /**
   * The behaviour this whole change exists to alter: stamps older than the
   * first bucket are dropped entirely, which is why a cumulative chart that
   * accumulates from zero shows nothing for a learner whose work predates the
   * window. Pinned so the drop stays deliberate and visible.
   */
  it("drops stamps older than the window", () => {
    const out = bucketTimestamps(["2020-01-01T00:00:00.000Z"], "day", 30);
    expect(out.reduce((a, b) => a + b.count, 0)).toBe(0);
  });
});

describe("countBeforeWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts everything older than the window", () => {
    // The case that started this: all the learner's work predates the 30 days.
    const old = ["2026-04-01T00:00:00.000Z", "2026-05-02T00:00:00.000Z", "2026-06-03T00:00:00.000Z"];
    expect(countBeforeWindow(old, "day", 30)).toBe(3);
    expect(bucketTimestamps(old, "day", 30).reduce((a, b) => a + b.count, 0)).toBe(0);
  });

  it("counts nothing when every stamp is inside the window", () => {
    const inside = ["2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z"];
    expect(countBeforeWindow(inside, "day", 30)).toBe(0);
  });

  it("splits a straddling set so prior + windowed is the whole set", () => {
    const stamps = [
      "2026-01-01T00:00:00.000Z", // before
      "2026-08-01T00:00:00.000Z", // before (window opens 2026-08-12)
      "2026-08-20T00:00:00.000Z", // inside
      "2026-09-10T00:00:00.000Z", // inside
    ];
    const prior = countBeforeWindow(stamps, "day", 30);
    const windowed = bucketTimestamps(stamps, "day", 30).reduce((a, b) => a + b.count, 0);
    expect(prior).toBe(2);
    expect(windowed).toBe(2);
    expect(prior + windowed).toBe(stamps.length);
  });

  it("includes the first bucket's own day in the window, not in the balance", () => {
    // Boundary: 2026-08-12 is the oldest bucket of a 30-day window.
    expect(countBeforeWindow(["2026-08-12T00:00:00.000Z"], "day", 30)).toBe(0);
    expect(countBeforeWindow(["2026-08-11T23:59:59.999Z"], "day", 30)).toBe(1);
  });

  it("skips undefined and never counts a future stamp", () => {
    expect(countBeforeWindow([undefined], "day", 30)).toBe(0);
    expect(countBeforeWindow(["2027-01-01T00:00:00.000Z"], "day", 30)).toBe(0);
  });

  it("handles month windows", () => {
    // A 12-month window from 2026-09 opens at 2025-10-01.
    expect(countBeforeWindow(["2025-09-30T23:59:59.999Z"], "month", 12)).toBe(1);
    expect(countBeforeWindow(["2025-10-01T00:00:00.000Z"], "month", 12)).toBe(0);
  });

  it("handles a week window spanning a year boundary", () => {
    // The case a lexical key comparison gets wrong: "2026-W01" sorts BEFORE
    // "2025-W52", so comparing bucket keys would count January stamps as
    // prior. Frozen to a January date so the 12-week window reaches into the
    // previous year.
    vi.setSystemTime(new Date("2026-01-14T12:00:00.000Z"));
    // 12 weeks back from the week of 2026-01-14 opens on 2025-10-27 (Monday).
    expect(countBeforeWindow(["2025-10-27T00:00:00.000Z"], "week", 12)).toBe(0);
    expect(countBeforeWindow(["2025-10-26T23:59:59.999Z"], "week", 12)).toBe(1);
    // A stamp inside the window but in the PREVIOUS year must not be counted.
    expect(countBeforeWindow(["2025-12-20T00:00:00.000Z"], "week", 12)).toBe(0);
    // And one in the current year, inside the window, likewise.
    expect(countBeforeWindow(["2026-01-05T00:00:00.000Z"], "week", 12)).toBe(0);
  });
});

/**
 * The property that makes the pair correct together, independent of anyone's
 * hand-computed calendar arithmetic: the instant countBeforeWindow() treats as
 * the cutoff must be exactly the start of the FIRST bucket that
 * bucketTimestamps() returns. If those two ever disagree, stamps are either
 * double-counted or lost between the opening balance and the window.
 */
describe("countBeforeWindow and bucketTimestamps agree on the boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: { now: string; bucket: "day" | "week" | "month"; n: number }[] = [
    { now: "2026-09-10T12:00:00.000Z", bucket: "day", n: 30 },
    { now: "2026-09-10T12:00:00.000Z", bucket: "week", n: 12 },
    { now: "2026-09-10T12:00:00.000Z", bucket: "month", n: 12 },
    // Year boundaries, where week keys stop sorting.
    { now: "2026-01-14T12:00:00.000Z", bucket: "week", n: 12 },
    { now: "2026-01-01T00:30:00.000Z", bucket: "week", n: 12 },
    { now: "2026-01-01T00:30:00.000Z", bucket: "month", n: 12 },
    { now: "2026-01-01T00:30:00.000Z", bucket: "day", n: 30 },
    // Leap day.
    { now: "2028-02-29T12:00:00.000Z", bucket: "day", n: 30 },
  ];

  for (const { now, bucket, n } of cases) {
    it(`${bucket}/${n} at ${now}`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));

      // Binary-search the boundary: the earliest instant that still lands in
      // the window rather than in the opening balance.
      let lo = new Date(now).getTime() - 400 * 86400000;
      let hi = new Date(now).getTime();
      const inWindow = (t: number) =>
        bucketTimestamps([new Date(t).toISOString()], bucket, n).some((b) => b.count > 0);
      expect(inWindow(hi)).toBe(true);
      expect(inWindow(lo)).toBe(false);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (inWindow(mid)) hi = mid; else lo = mid;
      }
      // `hi` is the first instant inside the window; `lo` the last outside it.
      const first = new Date(hi).toISOString();
      const last = new Date(lo).toISOString();

      // The balance must claim exactly the stamps the window does not.
      expect(countBeforeWindow([first], bucket, n)).toBe(0);
      expect(countBeforeWindow([last], bucket, n)).toBe(1);
      // And that first in-window instant must land in the OLDEST bucket.
      expect(bucketTimestamps([first], bucket, n)[0].count).toBe(1);
    });
  }
});

describe("cumulativeCounts", () => {
  const buckets = (counts: number[]) => counts.map((count) => ({ count }));

  it("opens at the prior balance so a quiet window stays flat at the total", () => {
    // The reported symptom: 30 days with no activity used to plot zero.
    expect(cumulativeCounts(buckets([0, 0, 0, 0]), 130)).toEqual([130, 130, 130, 130]);
  });

  it("climbs from the prior balance", () => {
    expect(cumulativeCounts(buckets([1, 0, 2]), 10)).toEqual([11, 11, 13]);
  });

  it("is unchanged from the old behaviour when prior is omitted", () => {
    // Guards the optional-parameter contract: existing callers that pass no
    // balance must get exactly what they got before.
    expect(cumulativeCounts(buckets([1, 0, 2]))).toEqual([1, 1, 3]);
    expect(cumulativeCounts(buckets([0, 0]))).toEqual([0, 0]);
  });

  it("never decreases", () => {
    const out = cumulativeCounts(buckets([0, 3, 0, 1, 0]), 5);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});

/**
 * The new-user case: a first vault index inventories thousands of words as a
 * baseline, so the cards say 9829 while this chart is a flat zero. Without a
 * word of explanation that reads as a broken chart.
 */
describe("progressEmptyHint", () => {
  it("explains an empty chart and names the indexed count", () => {
    const hint = progressEmptyHint([0, 0, 0], 9829);
    expect(hint).toContain("Nothing to plot yet");
    expect(hint).toContain("9829");
  });

  it("drops the count when nothing was indexed", () => {
    const hint = progressEmptyHint([0, 0], 0);
    expect(hint).toContain("Nothing to plot yet");
    expect(hint).not.toMatch(/\d/);
  });

  it("says nothing once any series has something to plot", () => {
    expect(progressEmptyHint([0, 0, 1], 9829)).toBeUndefined();
    expect(progressEmptyHint([130], 0)).toBeUndefined();
  });

  it("says nothing when no series is selected — that has its own message", () => {
    expect(progressEmptyHint([], 9829)).toBeUndefined();
  });

  it("never throws on odd input", () => {
    // It renders on every dashboard paint, so it must be incapable of taking
    // the view down.
    expect(() => progressEmptyHint([0], 0)).not.toThrow();
    expect(() => progressEmptyHint([-1], 0)).not.toThrow();
  });
});
