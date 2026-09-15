import { describe, it, expect } from "vitest";
import { SrsScheduler } from "../srs/SrsScheduler";

function makeVocab(records: Record<string, any>) {
  return {
    ensure: (s: string) => records[s] ?? (records[s] = { surfaces: [s], srs: {}, status: "unknown" }),
    bySurface: (s: string) => records[s],
    updateSrs: (s: string, patch: any) => {
      records[s] = records[s] ?? { surfaces: [s], srs: {}, status: "unknown" };
      records[s].srs = { ...records[s].srs, ...patch };
    },
    values: () => Object.values(records),
  } as any;
}

const settings = () => ({
  srs: { scheduleKnownOccasionally: false, popupOnDueIsFailedRecall: true, initialIntervalDays: 1, initialEase: 2.5 },
}) as any;

describe("SRS scheduler", () => {
  it("good grade increases interval geometrically", () => {
    const recs = {};
    const s = new SrsScheduler(makeVocab(recs) as any, settings);
    const r1 = s.applyGrade("学习", "good");
    expect(r1.intervalDays).toBe(1);
    const r2 = s.applyGrade("学习", "good");
    expect(r2.intervalDays).toBeGreaterThanOrEqual(2);
  });

  it("again grade resets to initial interval and bumps lapses", () => {
    const recs = {};
    const s = new SrsScheduler(makeVocab(recs) as any, settings);
    s.applyGrade("学习", "good");
    s.applyGrade("学习", "good");
    const r3 = s.applyGrade("学习", "again");
    expect(r3.intervalDays).toBe(1);
    expect(r3.lapses).toBe(1);
  });

  it("eligibleForReview filters ignored and optionally known words", () => {
    const recs = {
      known: { surfaces: ["知道"], status: "known", srs: {} },
      ignored: { surfaces: ["略过"], status: "ignored", srs: {} },
      unknown: { surfaces: ["学习"], status: "unknown", srs: {} },
    };
    const s1 = new SrsScheduler(makeVocab(recs) as any, settings);
    expect(s1.eligibleForReview().map((r) => r.status)).toEqual(["unknown"]);

    const s2 = new SrsScheduler(makeVocab(recs) as any, () => ({
      srs: { ...settings().srs, scheduleKnownOccasionally: true },
    }) as any);
    expect(s2.eligibleForReview().map((r) => r.status).sort()).toEqual(["known", "unknown"]);
  });

  it("due includes unscheduled words and excludes future dueAt", () => {
    const recs = {
      due: { surfaces: ["到期"], status: "unknown", srs: { dueAt: "2026-01-01T00:00:00.000Z" } },
      future: { surfaces: ["以后"], status: "unknown", srs: { dueAt: "2026-01-03T00:00:00.000Z" } },
      unscheduled: { surfaces: ["新的"], status: "unknown", srs: {} },
    };
    const s = new SrsScheduler(makeVocab(recs) as any, settings);
    const out = s.due(new Date("2026-01-02T00:00:00.000Z")).map((r) => r.surfaces[0]).sort();
    expect(out).toEqual(["到期", "新的"]);
  });

  it("applyExposureSignal nudges ease for non-known, non-ignored words", () => {
    const recs = {
      learn: { surfaces: ["学习"], status: "unknown", srs: { ease: 2.5 } },
      known: { surfaces: ["知道"], status: "known", srs: { ease: 2.5 } },
    };
    const s = new SrsScheduler(makeVocab(recs) as any, settings);
    s.applyExposureSignal("learn");
    s.applyExposureSignal("known");
    expect(recs.learn.srs.ease).toBeCloseTo(2.51, 5);
    expect(recs.known.srs.ease).toBe(2.5);
  });

  it("applyPopupSignal applies 'again' only when enabled", () => {
    const recs = {
      learn: { surfaces: ["学习"], status: "unknown", srs: { intervalDays: 5, ease: 2.5, lapses: 0 } },
    };
    const enabled = new SrsScheduler(makeVocab(recs) as any, settings);
    enabled.applyPopupSignal("learn");
    expect(recs.learn.srs.intervalDays).toBe(1);
    expect(recs.learn.srs.lapses).toBe(1);

    const recs2 = {
      learn: { surfaces: ["学习"], status: "unknown", srs: { intervalDays: 5, ease: 2.5, lapses: 0 } },
    };
    const disabled = new SrsScheduler(makeVocab(recs2) as any, () => ({
      srs: { ...settings().srs, popupOnDueIsFailedRecall: false },
    }) as any);
    disabled.applyPopupSignal("learn");
    expect(recs2.learn.srs.intervalDays).toBe(5);
    expect(recs2.learn.srs.lapses).toBe(0);
  });
});

describe("SRS scheduler — hard and easy grades", () => {
  // Only "good" and "again" were exercised; both arms below were dead in
  // coverage, including the ease floor and ceiling.
  const sched = () => new SrsScheduler(makeVocab({}) as any, settings);

  it("hard holds a fresh card at the initial interval", () => {
    // Math.max(init, round(0 * 1.2)) === init, so a never-reviewed card
    // cannot collapse to a zero-day interval.
    const r = sched().applyGrade("学习", "hard");
    expect(r.intervalDays).toBe(1);
    expect(r.ease).toBeCloseTo(2.35, 5);
    expect(r.lapses).toBe(0);
  });

  it("hard grows an established interval by 1.2 and shaves the ease", () => {
    const s = sched();
    s.applyGrade("学习", "good");
    s.applyGrade("学习", "good");
    const before = s.applyGrade("学习", "good");
    const r = s.applyGrade("学习", "hard");
    expect(r.intervalDays).toBe(Math.round(before.intervalDays * 1.2));
    expect(r.ease).toBeCloseTo(before.ease - 0.15, 5);
  });

  it("easy doubles the initial interval on a fresh card", () => {
    const r = sched().applyGrade("学习", "easy");
    expect(r.intervalDays).toBe(2);
    expect(r.ease).toBeCloseTo(2.65, 5);
  });

  it("easy applies the 1.3 bonus to an established interval", () => {
    const s = sched();
    const first = s.applyGrade("学习", "good");
    const r = s.applyGrade("学习", "easy");
    expect(r.intervalDays).toBe(Math.round(first.intervalDays * first.ease * 1.3));
    expect(r.ease).toBeCloseTo(first.ease + 0.15, 5);
  });

  it("clamps ease at the 3.5 ceiling", () => {
    // Ease rises 0.15 per easy grade from 2.5, so it saturates on the 7th.
    // Deliberately stops there: `intervalDays` grows geometrically and the
    // 14th consecutive easy grade overflows `new Date()` with a RangeError.
    // That is a real defect, tracked separately — not asserted here, because
    // a test that pins the throw would cement the bug instead of flagging it.
    const s = sched();
    for (let i = 0; i < 7; i++) s.applyGrade("学习", "easy");
    expect(s.applyGrade("学习", "easy").ease).toBe(3.5);
  });

  it("clamps ease at the 1.3 floor however often hard is graded", () => {
    const s = sched();
    for (let i = 0; i < 20; i++) s.applyGrade("学习", "hard");
    expect(s.applyGrade("学习", "hard").ease).toBe(1.3);
  });

  it("hard does not count as a lapse, unlike again", () => {
    const s = sched();
    expect(s.applyGrade("学习", "hard").lapses).toBe(0);
    expect(s.applyGrade("学习", "again").lapses).toBe(1);
    expect(s.applyGrade("学习", "hard").lapses).toBe(1);
  });
});
