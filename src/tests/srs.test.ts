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
});
