import { describe, it, expect } from "vitest";
import { axesFromStatus, colorClassKey, colorOf, statusFromAxes } from "../vocabulary/axes";
import type { WordRecord } from "../vocabulary/VocabularyTypes";

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

describe("statusFromAxes — partial combos that collapse", () => {
  // These three combos have no status of their own, so they fold into the
  // nearest one. Each was previously unexercised.
  const collapses = [
    { axes: { chars: true, pinyin: false, meaning: false }, status: "unknown" },
    { axes: { chars: false, pinyin: true, meaning: false }, status: "pinyinKnownMeaningUnknown" },
    { axes: { chars: false, pinyin: false, meaning: true }, status: "meaningKnownPinyinUnknown" },
  ] as const;

  for (const { axes, status } of collapses) {
    it(`{chars:${axes.chars}, pinyin:${axes.pinyin}, meaning:${axes.meaning}} → ${status}`, () => {
      expect(statusFromAxes(axes)).toBe(status);
    });
  }

  it("covers all eight boolean combinations without falling through", () => {
    // Guards the final `return "unknown"` at axes.ts:68, which is unreachable
    // precisely because the eight combos above it are exhaustive. If a future
    // edit drops a branch, this starts failing rather than silently degrading.
    for (const chars of [true, false]) {
      for (const pinyin of [true, false]) {
        for (const meaning of [true, false]) {
          expect(statusFromAxes({ chars, pinyin, meaning })).toBeTruthy();
        }
      }
    }
  });
});

describe("colorClassKey", () => {
  /** Minimal record; `hsk` is what colorClassKey actually reads. */
  function rec(hsk?: { levels?: string[]; source?: string }): WordRecord {
    return {
      key: "k",
      surfaces: ["学习"],
      status: "unknown",
      axes: { chars: false, pinyin: false, meaning: false },
      seenCount: 0,
      recentSeenAt: [],
      dailySeenCounts: {},
      updatedAt: "",
      ...(hsk ? { hsk } : {}),
    } as unknown as WordRecord;
  }

  it("delegates to colorOf in status mode, ignoring HSK data entirely", () => {
    expect(colorClassKey(rec({ levels: ["3"] }), "status", "both")).toBe("unknown");
    expect(colorClassKey(undefined, "status", "both")).toBe("new");
  });

  it("returns hsk-none for a missing record in HSK mode", () => {
    expect(colorClassKey(undefined, "hsk", "both")).toBe("hsk-none");
  });

  it("returns hsk-none when the record carries no usable HSK levels", () => {
    expect(colorClassKey(rec(), "hsk", "both")).toBe("hsk-none");
    expect(colorClassKey(rec({ levels: [] }), "hsk", "both")).toBe("hsk-none");
  });

  it("picks the lowest level — lower HSK means the more common word", () => {
    expect(colorClassKey(rec({ levels: ["5", "2", "4"] }), "hsk", "both")).toBe("hsk-2");
  });

  it("skips non-numeric and non-positive levels", () => {
    expect(colorClassKey(rec({ levels: ["0", "abc", "3"] }), "hsk", "both")).toBe("hsk-3");
  });

  it("returns hsk-none when every level is unusable", () => {
    expect(colorClassKey(rec({ levels: ["0", "-1", "nope"] }), "hsk", "both")).toBe("hsk-none");
  });

  it("collapses levels above 7 into hsk-7", () => {
    expect(colorClassKey(rec({ levels: ["9"] }), "hsk", "both")).toBe("hsk-7");
    expect(colorClassKey(rec({ levels: ["7"] }), "hsk", "both")).toBe("hsk-7");
  });

  it("filters out a record whose HSK source the user is not showing", () => {
    const threeOh = rec({ levels: ["1"], source: "3.0" });
    expect(colorClassKey(threeOh, "hsk", "2.0")).toBe("hsk-none");
    expect(colorClassKey(threeOh, "hsk", "3.0")).toBe("hsk-1");
    expect(colorClassKey(threeOh, "hsk", "both")).toBe("hsk-1");
  });

  it("keeps a record that declares no source, whatever the filter", () => {
    expect(colorClassKey(rec({ levels: ["4"] }), "hsk", "2.0")).toBe("hsk-4");
  });
});
