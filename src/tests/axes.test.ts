import { describe, it, expect } from "vitest";
import { axesFromStatus, colorOf, statusFromAxes } from "../vocabulary/axes";

describe("axes ↔ status round-trip", () => {
  const cases = [
    { c: true, p: true, m: true, status: "known", color: "known" },
    { c: false, p: false, m: false, status: "unknown", color: "unknown" },
    { c: false, p: true, m: true, status: "charactersUnknown", color: "partial" },
    { c: true, p: true, m: false, status: "pinyinKnownMeaningUnknown", color: "partial" },
    { c: true, p: false, m: true, status: "meaningKnownPinyinUnknown", color: "partial" },
  ] as const;

  for (const { c, p, m, status, color } of cases) {
    it(`{chars:${c}, pinyin:${p}, meaning:${m}} → ${status} / color ${color}`, () => {
      const axes = { chars: c, pinyin: p, meaning: m };
      expect(statusFromAxes(axes)).toBe(status);
      const reverse = axesFromStatus(status);
      expect(reverse).toEqual(axes);
      const rec = {
        key: "k",
        surfaces: ["x"],
        status,
        axes,
        seenCount: 0,
        recentSeenAt: [],
        dailySeenCounts: {},
        updatedAt: "",
      } as any;
      expect(colorOf(rec)).toBe(color);
    });
  }

  it("colorOf returns 'new' for missing record", () => {
    expect(colorOf(undefined)).toBe("new");
  });

  it("colorOf returns 'ignored' for ignored status", () => {
    expect(colorOf({ status: "ignored" } as any)).toBe("ignored");
  });
});
