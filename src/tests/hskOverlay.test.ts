import { describe, it, expect } from "vitest";
import { hskLevelsFor, maxHskLevel } from "../dictionary/hskOverlay";
import { DictionaryEntry } from "../dictionary/DictionaryTypes";

function entry(source: string, levels: string[]): DictionaryEntry {
  return {
    simplified: "x",
    traditional: "x",
    pinyin: "x",
    definitions: [],
    hsk: { source, levels },
  };
}

describe("hskLevelsFor", () => {
  it("returns [] when the entry is undefined", () => {
    expect(hskLevelsFor(undefined, "both")).toEqual([]);
  });

  it("returns [] when the entry has no hsk field", () => {
    const e: DictionaryEntry = {
      simplified: "x",
      traditional: "x",
      pinyin: "x",
      definitions: [],
    };
    expect(hskLevelsFor(e, "both")).toEqual([]);
  });

  it("returns the levels when source is 'both' regardless of entry source", () => {
    expect(hskLevelsFor(entry("2.0", ["3"]), "both")).toEqual(["3"]);
    expect(hskLevelsFor(entry("3.0", ["4"]), "both")).toEqual(["4"]);
    expect(hskLevelsFor(entry("user", ["2"]), "both")).toEqual(["2"]);
  });

  it("returns the levels only when entry's source starts with the requested source", () => {
    expect(hskLevelsFor(entry("2.0", ["3"]), "2.0")).toEqual(["3"]);
    expect(hskLevelsFor(entry("2.0.1", ["3"]), "2.0")).toEqual(["3"]);
    expect(hskLevelsFor(entry("3.0", ["4"]), "2.0")).toEqual([]);
  });
});

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
