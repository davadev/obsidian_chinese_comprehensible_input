import { describe, it, expect } from "vitest";
import { deepEqual, flatten, unflatten } from "../settings/settingsMerge";

describe("flatten", () => {
  it("produces dot-joined leaf paths for nested objects", () => {
    const f = flatten({ a: { b: 1, c: { d: 2 } } });
    expect(f).toEqual({ "a.b": 1, "a.c.d": 2 });
  });

  it("returns empty object for empty input", () => {
    expect(flatten({})).toEqual({});
  });

  it("treats arrays as leaves (no per-index flattening)", () => {
    const f = flatten({ statusPriority: ["known", "unknown"], n: 7 });
    expect(f).toEqual({ statusPriority: ["known", "unknown"], n: 7 });
  });

  it("drops top-level primitives when no prefix is given", () => {
    expect(flatten(42)).toEqual({});
  });

  it("keeps top-level primitives when a prefix is provided", () => {
    expect(flatten(42, "root")).toEqual({ root: 42 });
  });
});

describe("unflatten", () => {
  it("rebuilds a two-level nested object from dot-joined keys", () => {
    expect(unflatten({ "a.b": 1, "a.c": 2 })).toEqual({ a: { b: 1, c: 2 } });
  });

  it("round-trips flatten for a typical settings-shaped input", () => {
    const original = {
      ai: { chatModel: "qwen2.5", endpointMode: "ollama" },
      defaultDisplayMode: "two-line",
    };
    expect(unflatten(flatten(original))).toEqual(original);
  });

  it("returns empty object for empty input", () => {
    expect(unflatten({})).toEqual({});
  });
});

describe("deepEqual", () => {
  it("primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("arrays — order matters", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("nested objects", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("null vs undefined are not equal", () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it("array vs object — not equal even when keys/indices align", () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it("object vs primitive — not equal", () => {
    expect(deepEqual({ a: 1 }, 1)).toBe(false);
  });
});
