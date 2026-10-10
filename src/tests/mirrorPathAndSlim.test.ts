import { describe, expect, it } from "vitest";
import { mirrorPathProblem } from "../settings/mirrorPath";
import { MIRROR_RECENT_SEEN_KEEP, isMirrorWorthy, slimRecordForMirror, slimVocabForMirror } from "../vocabulary/mirrorSlim";
import type { PersistedVocabData, WordRecord } from "../vocabulary/VocabularyTypes";

describe("mirrorPathProblem", () => {
  it.each([
    "Chinese Learning/vocabulary.json",
    "Knowledgebase/Languages/vocabulary.json",
    "vocabulary.json",
    "A/B C/x.JSON",
    "a b/c.d/e.json",
  ])("accepts %s", (p) => expect(mirrorPathProblem(p)).toBeNull());

  it.each([
    // Real leftovers a half-typed path created in a user's vault:
    ["Knowledgebase/Languages/vocabulary.", "file name"],
    ["Knowledgebase/Languages/vocabulary.json nowledgebase", "file name"],
    ["Knowledgebase/Languages/vocabulary./Languages/vocabulary.json", "dot or a space"],
    ["", "empty"],
    ["   ", "empty"],
    ["/abs/vocab.json", "inside the vault"],
    ["a\\b.json", "inside the vault"],
    ["a//b.json", "empty folder"],
    ["a/b.json/", "empty folder"],
    ["a/../b.json", '".."'],
    ["./b.json", '"."'],
    ["a/b:c.json", "cannot contain"],
    ["a/vocabulary", "file name"],
    ["a/.json", "file name"],
    ["a/ b/c.json", null],
  ])("rejects %s", (p, why) => {
    const problem = mirrorPathProblem(p);
    if (why === null) expect(problem).toBeNull(); // a leading space inside a folder name is allowed
    else expect(problem, p).toContain(why);
  });

  it("every prefix of a path being typed is rejected until the .json is complete", () => {
    const full = "Chinese Learning/vocabulary.json";
    for (let i = 1; i < full.length; i++) {
      const prefix = full.slice(0, i);
      // Only the finished path may be used; no intermediate string becomes a file.
      expect(mirrorPathProblem(prefix), prefix).not.toBeNull();
    }
    expect(mirrorPathProblem(full)).toBeNull();
  });
});

let n = 0;
const rec = (over: Partial<WordRecord> = {}): WordRecord => ({
  key: `k${++n}`,
  surfaces: ["字"],
  simplified: "字",
  status: "new",
  seenCount: 3,
  recentSeenAt: [],
  dailySeenCounts: { "2026-01-01": 3 },
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("isMirrorWorthy", () => {
  it("a word somebody classified is worth moving, whatever the status", () => {
    for (const s of ["known", "unknown", "ignored", "charactersUnknown", "pinyinKnownMeaningUnknown", "meaningKnownPinyinUnknown"] as const) {
      expect(isMirrorWorthy(rec({ status: s })), s).toBe(true);
    }
  });

  it("an untouched 'new' word is not", () => {
    expect(isMirrorWorthy(rec())).toBe(false);
  });

  it("a 'new' word somebody wrote something about is", () => {
    expect(isMirrorWorthy(rec({ mnemonic: { text: "x" } }))).toBe(true);
    expect(isMirrorWorthy(rec({ srs: { intervalDays: 1 } }))).toBe(true);
    expect(isMirrorWorthy(rec({ notes: "n" }))).toBe(true);
    expect(isMirrorWorthy(rec({ ignoredReason: "name" }))).toBe(true);
  });
});

describe("slimRecordForMirror", () => {
  it("drops the per-note counters and all but the newest exposure timestamps, keeping everything else", () => {
    const stamps = Array.from({ length: 40 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`).sort();
    const r = rec({ status: "known", notesSeenCounts: { "a.md": 5, "b.md": 2 }, recentSeenAt: stamps, mnemonic: { text: "m" }, axes: { chars: true, pinyin: true, meaning: true } });
    const out = slimRecordForMirror(r);
    expect(out).not.toHaveProperty("notesSeenCounts");
    expect(out.recentSeenAt).toEqual(stamps.slice(-MIRROR_RECENT_SEEN_KEEP));
    expect(out).toMatchObject({ status: "known", mnemonic: { text: "m" }, axes: { chars: true, pinyin: true, meaning: true }, dailySeenCounts: { "2026-01-01": 3 }, seenCount: 3 });
  });

  it("never touches the record it was given", () => {
    const r = rec({ status: "known", notesSeenCounts: { "a.md": 5 }, recentSeenAt: ["a", "b", "c", "d", "e", "f", "g"] });
    const before = JSON.stringify(r);
    slimRecordForMirror(r);
    expect(JSON.stringify(r)).toBe(before);
  });

  it("a record with fewer timestamps than the limit keeps them all", () => {
    expect(slimRecordForMirror(rec({ status: "known", recentSeenAt: ["a", "b"] })).recentSeenAt).toEqual(["a", "b"]);
  });
});

describe("slimVocabForMirror", () => {
  it("keeps classified words, omits untouched new ones, and leaves the schema version and the input alone", () => {
    const data: PersistedVocabData = {
      schemaVersion: 3,
      words: { a: rec({ key: "a", status: "known" }), b: rec({ key: "b" }), c: rec({ key: "c", mnemonic: { text: "m" } }) },
    };
    const before = JSON.stringify(data);
    const out = slimVocabForMirror(data);
    expect(Object.keys(out.words)).toEqual(["a", "c"]);
    expect(out.schemaVersion).toBe(3);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("shrinks a store shaped like a real one (mostly untouched words, heavy exposure data) by over 95%", () => {
    const words: Record<string, WordRecord> = {};
    for (let i = 0; i < 2000; i++) {
      const notes: Record<string, number> = {};
      for (let j = 0; j < 60; j++) notes[`Notes/some/folder/note-${j}.md`] = 1 + (j % 5);
      const stamps = Array.from({ length: 40 }, (_, j) => `2026-02-${String((j % 28) + 1).padStart(2, "0")}T10:00:00.000Z`);
      words[`w${i}`] = rec({ key: `w${i}`, status: i % 20 === 0 ? "known" : "new", notesSeenCounts: notes, recentSeenAt: stamps });
    }
    const data: PersistedVocabData = { schemaVersion: 3, words };
    const full = JSON.stringify(data, null, 2).length;
    const slim = JSON.stringify(slimVocabForMirror(data), null, 2).length;
    expect(slim / full).toBeLessThan(0.05);
  });
});
