import { describe, it, expect } from "vitest";
import { migrateVocab } from "../vocabulary/migrations";
import { DATA_SCHEMA_VERSION } from "../constants";

describe("migrateVocab", () => {
  it("returns empty PersistedVocabData for undefined input", () => {
    const out = migrateVocab(undefined);
    expect(out.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(out.words).toEqual({});
  });

  it("returns empty PersistedVocabData for null input", () => {
    const out = migrateVocab(null);
    expect(out.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(out.words).toEqual({});
  });

  it("returns empty PersistedVocabData for non-object input", () => {
    const out = migrateVocab(42);
    expect(out.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(out.words).toEqual({});
  });

  it("backfills schemaVersion when missing", () => {
    const out = migrateVocab({ words: { foo: { key: "foo" } as any } });
    expect(out.schemaVersion).toBe(1);
    expect(out.words.foo).toBeDefined();
  });

  it("passes through a current-version blob unchanged", () => {
    const blob = {
      schemaVersion: 1,
      words: { bar: { key: "bar", surfaces: ["bar"], status: "new", updatedAt: "x", seenCount: 0, recentSeenAt: [], dailySeenCounts: {} } as any },
    };
    const out = migrateVocab(blob);
    expect(out.schemaVersion).toBe(1);
    expect(out.words.bar).toBe(blob.words.bar);
  });

  it("is idempotent — applying twice yields the same result", () => {
    const blob = { schemaVersion: 1, words: { x: { key: "x" } as any } };
    const once = migrateVocab(blob);
    const twice = migrateVocab(once);
    expect(twice).toEqual(once);
  });
});
