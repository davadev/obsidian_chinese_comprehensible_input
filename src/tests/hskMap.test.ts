import { describe, it, expect } from "vitest";
import { HSK_LEVEL_COUNTS, HSK_MAP, HSK_MAP_SIZE, HSK_SOURCE } from "../dictionary/hskMap.generated";

describe("hskMap.generated", () => {
  it("declares HSK 2.0 as the source", () => {
    expect(HSK_SOURCE).toBe("2.0");
  });

  it("covers all six HSK levels with non-trivial term counts", () => {
    for (let level = 1; level <= 6; level++) {
      expect(HSK_LEVEL_COUNTS[level]).toBeGreaterThan(100);
    }
    expect(HSK_MAP_SIZE).toBeGreaterThanOrEqual(4000);
  });

  it("places sample terms at their official HSK 2.0 levels", () => {
    // Spot checks. Levels are whatever the hskhsk.com lists assign — we
    // do not assert against the values in the user's original prompt
    // (which were illustrative, not authoritative).
    expect(HSK_MAP["爱"]).toBe(1);       // L1 high-frequency
    expect(HSK_MAP["一下"]).toBe(2);     // L2
    expect(HSK_MAP["提高"]).toBe(3);     // L3
    expect(HSK_MAP["一切"]).toBe(4);     // L4
    expect(HSK_MAP["辩论"]).toBe(5);     // L5
    expect(HSK_MAP["一丝不苟"]).toBe(6); // L6
  });

  it("returns undefined for non-HSK terms", () => {
    expect(HSK_MAP["xxxxx"]).toBeUndefined();
    expect(HSK_MAP[""]).toBeUndefined();
  });

  it("never assigns a level outside 1-6", () => {
    for (const lvl of Object.values(HSK_MAP)) {
      expect(lvl).toBeGreaterThanOrEqual(1);
      expect(lvl).toBeLessThanOrEqual(6);
    }
  });
});
