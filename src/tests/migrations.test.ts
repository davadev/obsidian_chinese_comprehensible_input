import { describe, it, expect } from "vitest";
import { migrateVocab } from "../vocabulary/migrations";
import { DATA_SCHEMA_VERSION } from "../constants";
import { migrateOverrideKey, migrateOverrideKeys } from "../settings/migrations";

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
    expect(out.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(out.words.foo).toBeDefined();
  });

  it("passes through a current-version blob unchanged", () => {
    const blob = {
      schemaVersion: DATA_SCHEMA_VERSION,
      words: { bar: { key: "bar", surfaces: ["bar"], status: "new", updatedAt: "x", seenCount: 0, recentSeenAt: [], dailySeenCounts: {} } as any },
    };
    const out = migrateVocab(blob);
    expect(out.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(out.words.bar).toBe(blob.words.bar);
  });

  it("is idempotent — applying twice yields the same result", () => {
    const blob = { schemaVersion: 1, words: { x: { key: "x" } as any } };
    const once = migrateVocab(blob);
    const twice = migrateVocab(once);
    expect(twice).toEqual(once);
  });
});

/** v3 split `mnemonic.text` into a short emoji line + a `story`. The one
 *  hard requirement is that no user text is ever lost. */
describe("migrateVocab — v3 mnemonic split", () => {
  const LONG = "A child under a roof practises the same stroke again and again until it sticks in memory.";
  const SHORT = "📖✏️→🧠 ⬆️⬆️";

  function blobWith(mnemonic: Record<string, unknown>, schemaVersion = 2) {
    return {
      schemaVersion,
      words: {
        x: {
          key: "x",
          surfaces: ["学习"],
          status: "new",
          updatedAt: "2026-01-01T00:00:00.000Z",
          seenCount: 0,
          recentSeenAt: [],
          dailySeenCounts: {},
          mnemonic,
        } as any,
      },
    };
  }

  it("moves a long text into story when story is empty", () => {
    const out = migrateVocab(blobWith({ text: LONG, updatedAt: "2026-01-01T00:00:00.000Z" }));
    expect(out.words.x.mnemonic?.story).toBe(LONG);
    expect(out.words.x.mnemonic?.text).toBe("");
    expect(out.schemaVersion).toBe(3);
  });

  it("never clobbers an existing story — both fields survive verbatim", () => {
    const out = migrateVocab(blobWith({ text: LONG, story: "my own story" }));
    expect(out.words.x.mnemonic?.text).toBe(LONG);
    expect(out.words.x.mnemonic?.story).toBe("my own story");
  });

  it("leaves a short emoji line alone", () => {
    const out = migrateVocab(blobWith({ text: SHORT }));
    expect(out.words.x.mnemonic?.text).toBe(SHORT);
    expect(out.words.x.mnemonic?.story).toBeUndefined();
  });

  it("does not touch mnemonic.updatedAt — a reshape is not a user edit", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const out = migrateVocab(blobWith({ text: LONG, updatedAt: ts }));
    expect(out.words.x.mnemonic?.updatedAt).toBe(ts);
  });

  it("is idempotent — a second pass does not re-move the story", () => {
    const once = migrateVocab(blobWith({ text: LONG }));
    const twice = migrateVocab(JSON.parse(JSON.stringify(once)));
    expect(twice.words.x.mnemonic).toEqual(once.words.x.mnemonic);
  });

  it("still migrates a payload arriving from an older device (v2 in, v3 out)", () => {
    const out = migrateVocab(blobWith({ text: LONG }, 2));
    expect(out.schemaVersion).toBe(3);
    expect(out.words.x.mnemonic?.story).toBe(LONG);
  });

  it("tolerates records with no mnemonic at all", () => {
    const out = migrateVocab({
      schemaVersion: 2,
      words: { y: { key: "y", status: "new", updatedAt: "t" } as any },
    });
    expect(out.words.y.mnemonic).toBeUndefined();
  });
});

describe("migrateOverrideKey", () => {
  it("drops the stranded neutral tone before a real tone digit", () => {
    expect(migrateOverrideKey("女|nü53")).toBe("女|nü3");
    expect(migrateOverrideKey("绿|lü54")).toBe("绿|lü4");
  });

  it("leaves a genuine neutral tone alone", () => {
    // A real neutral tone is always followed by a space or end-of-string.
    expect(migrateOverrideKey("的|de5")).toBe("的|de5");
    expect(migrateOverrideKey("什么|shi2 me5")).toBe("什么|shi2 me5");
    expect(migrateOverrideKey("朋友|peng2 you5")).toBe("朋友|peng2 you5");
  });

  it("leaves ordinary keys untouched", () => {
    expect(migrateOverrideKey("学习|xue2xi2")).toBe("学习|xue2xi2");
    expect(migrateOverrideKey("好")).toBe("好");
  });

  it("is idempotent", () => {
    const once = migrateOverrideKey("女|nü53");
    expect(migrateOverrideKey(once)).toBe(once);
  });
});

describe("migrateOverrideKeys", () => {
  it("moves legacy keys and reports the count", () => {
    const { overrides, moved } = migrateOverrideKeys({
      "女|nü53": { pinyin: "nǚ" },
      "学习|xue2xi2": { pinyin: "xué xí" },
    });
    expect(moved).toBe(1);
    expect(overrides["女|nü3"]).toEqual({ pinyin: "nǚ" });
    expect(overrides["女|nü53"]).toBeUndefined();
    expect(overrides["学习|xue2xi2"]).toEqual({ pinyin: "xué xí" });
  });

  it("returns the original object when nothing needs moving", () => {
    const input = { "学习|xue2xi2": { pinyin: "xué xí" } };
    const { overrides, moved } = migrateOverrideKeys(input);
    expect(moved).toBe(0);
    expect(overrides).toBe(input);
  });

  it("prefers an already-migrated entry over a legacy duplicate", () => {
    const { overrides } = migrateOverrideKeys({
      "女|nü53": { pinyin: "legacy" },
      "女|nü3": { pinyin: "current" },
    });
    expect(overrides["女|nü3"]).toEqual({ pinyin: "current" });
    expect(Object.keys(overrides)).toHaveLength(1);
  });

  it("is idempotent across two runs", () => {
    const first = migrateOverrideKeys({ "女|nü53": { pinyin: "nǚ" } });
    const second = migrateOverrideKeys(first.overrides);
    expect(second.moved).toBe(0);
    expect(second.overrides).toEqual(first.overrides);
  });
});
