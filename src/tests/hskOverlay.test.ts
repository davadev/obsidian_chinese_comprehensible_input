import { describe, it, expect } from "vitest";
import { maxHskLevel } from "../dictionary/hskOverlay";

describe("maxHskLevel", () => {
  it("returns the highest numeric level", () => {
    expect(maxHskLevel(["1", "3", "2"])).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(maxHskLevel([])).toBe(0);
  });

  it("returns 0 when no level parses as a number", () => {
    expect(maxHskLevel(["foo", "bar"])).toBe(0);
  });

  it("ignores non-numeric entries", () => {
    expect(maxHskLevel(["2", "junk", "5", "x"])).toBe(5);
  });

  it("handles single-element list", () => {
    expect(maxHskLevel(["6"])).toBe(6);
  });
});
