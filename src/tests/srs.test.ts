import { describe, it, expect, vi } from "vitest";
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
    const s = sched();
    for (let i = 0; i < 7; i++) s.applyGrade("学习", "easy");
    expect(s.applyGrade("学习", "easy").ease).toBe(3.5);
  });

  it("caps the interval instead of overflowing the date range", () => {
    // Regression guard. intervalDays compounds by interval * ease * 1.3 with
    // ease saturating at 3.5, so before the MAX_INTERVAL_DAYS clamp the 14th
    // consecutive easy grade pushed now + interval * 86400000 past the
    // ECMAScript date range and toISOString() threw "RangeError: Invalid time
    // value". 40 grades is well past that point.
    const s = sched();
    let last = s.applyGrade("学习", "easy");
    for (let i = 0; i < 40; i++) {
      last = s.applyGrade("学习", "easy");
      expect(Number.isFinite(last.intervalDays)).toBe(true);
      expect(Number.isNaN(Date.parse(last.dueAt))).toBe(false);
    }
    expect(last.intervalDays).toBe(36500);
    expect(new Date(last.dueAt).getFullYear()).toBeGreaterThan(new Date().getFullYear());
  });

  it("leaves realistic intervals untouched by the cap", () => {
    const s = sched();
    const r = s.applyGrade("学习", "good");
    expect(r.intervalDays).toBe(1);
    expect(s.applyGrade("学习", "good").intervalDays).toBeLessThan(36500);
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

describe("SRS scheduler: which words are eligible, and re-grading", () => {
  const rec = (status: string, extra: Record<string, unknown> = {}) => ({ surfaces: ["x"], status, srs: {}, ...extra });

  it.each([
    ["new", true],
    ["unknown", true],
    ["meaningKnownPinyinUnknown", true],
    ["pinyinKnownMeaningUnknown", true],
    ["charactersUnknown", true],
    ["ignored", false],
    ["known", false],
    ["aStatusFromAFutureVersion", false],
  ])("status %s eligible: %s (known words off)", (status, want) => {
    const s = new SrsScheduler(makeVocab({ a: rec(status) }) as any, settings);
    expect(s.eligibleForReview().length === 1).toBe(want);
  });

  it("known words are eligible only when the setting asks for them", () => {
    const on = () => ({ srs: { ...settings().srs, scheduleKnownOccasionally: true } }) as any;
    expect(new SrsScheduler(makeVocab({ a: rec("known") }) as any, on).eligibleForReview()).toHaveLength(1);
  });

  it("a word that already has a schedule keeps its ease and lapses on the next grade", () => {
    const recs: Record<string, any> = { a: rec("unknown", { srs: { intervalDays: 6, ease: 2.0, lapses: 2 } }) };
    const s = new SrsScheduler(makeVocab(recs) as any, settings);
    const r = s.applyGrade("a", "good");
    expect(r.intervalDays).toBeGreaterThanOrEqual(6);
    const bad = s.applyGrade("a", "again");
    expect(bad.lapses).toBe(3);
  });

  it("a popup on a word the vocabulary has never seen schedules nothing", () => {
    const recs: Record<string, any> = {};
    const vocab = makeVocab(recs);
    const s = new SrsScheduler({ ...vocab, bySurface: () => undefined } as any, settings);
    const spy = vi.spyOn(s, "applyGrade");
    s.applyPopupSignal("never-seen");
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["ignored", "known"])("a popup on a %s word is not a failed recall", (status) => {
    const s = new SrsScheduler(makeVocab({ a: rec(status) }) as any, settings);
    const spy = vi.spyOn(s, "applyGrade");
    s.applyPopupSignal("a");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SRS scheduler: first review of a record that has no schedule yet", () => {
  it("starts from the configured initial ease and a zero interval", () => {
    const recs: Record<string, any> = { a: { surfaces: ["a"], status: "unknown" } }; // no `srs` field at all
    const vocab = {
      ensure: (s: string) => recs[s],
      bySurface: (s: string) => recs[s],
      updateSrs: (s: string, patch: any) => void (recs[s].srs = patch),
      values: () => Object.values(recs),
    } as any;
    const r = new SrsScheduler(vocab, settings).applyGrade("a", "good");
    expect(r.ease).toBe(2.5);
    expect(r.lapses).toBe(0);
  });
});
