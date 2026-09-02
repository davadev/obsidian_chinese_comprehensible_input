import { describe, it, expect } from "vitest";
import { Trie } from "../tokenizer/Trie";
import { tokenizeLatticeSpan } from "../tokenizer/latticeTokenizer";
import { SEED_ENTRIES } from "../dictionary/seedDictionary";
import { DictionaryEntry } from "../dictionary/DictionaryTypes";

// Minimal in-memory dictionary mock that mirrors DictionaryService.lookup.
function mockDict() {
  const map = new Map<string, DictionaryEntry[]>();
  for (const e of SEED_ENTRIES) {
    const arr = map.get(e.simplified) ?? [];
    arr.push(e);
    map.set(e.simplified, arr);
  }
  return {
    lookup: (s: string) => map.get(s) ?? [],
    has: (s: string) => map.has(s),
    surfaces: () => map.keys(),
  } as any;
}

function buildTrie() {
  const t = new Trie();
  for (const e of SEED_ENTRIES) t.insert(e.simplified);
  return t;
}

describe("lattice tokenizer", () => {
  const ctx = { hasRecord: () => false, knownBoost: () => 0 };
  const dict = mockDict();
  const trie = buildTrie();

  it("splits 研究生 as one word when present in dictionary", () => {
    const tokens = tokenizeLatticeSpan("研究生今天去学习", 0, dict, trie, ctx);
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces[0]).toBe("研究生");
    expect(surfaces).toContain("今天");
    expect(surfaces).toContain("学习");
  });

  it("prefers 马上 over 马 + 上", () => {
    const tokens = tokenizeLatticeSpan("我马上去", 0, dict, trie, ctx);
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces).toContain("马上");
    expect(surfaces).not.toContain("马");
  });

  it("returns offsets pointing into original span", () => {
    const tokens = tokenizeLatticeSpan("我吃饭", 10, dict, trie, ctx);
    expect(tokens[0].start).toBe(10);
    expect(tokens[0].end).toBe(11);
    expect(tokens[0].surface).toBe("我");
  });
});

describe("Trie — UTF-16 handling", () => {
  it("matches a word containing a character outside the BMP", () => {
    // insert() used to walk code points while matchesFrom() walks code
    // units, so astral words were stored under an unreachable key. 268
    // simplified headwords and 10 traditional-only forms are affected.
    const t = new Trie();
    t.insert("𪢌");
    expect(t.matchesFrom("𪢌", 0)).toEqual(["𪢌".length]);
  });

  it("matches an astral character embedded in ordinary text", () => {
    const t = new Trie();
    t.insert("𪢌哰");
    const text = "我𪢌哰好";
    expect(t.matchesFrom(text, 1)).toEqual([1 + "𪢌哰".length]);
  });

  it("still matches ordinary BMP words unchanged", () => {
    const t = new Trie();
    t.insert("中文");
    t.insert("中");
    expect(t.matchesFrom("中文", 0)).toEqual([1, 2]);
  });

  it("reports prefixes consistently for astral words", () => {
    const t = new Trie();
    t.insert("𪢌哰");
    expect(t.hasPrefix("𪢌")).toBe(true);
    expect(t.hasPrefix("𪢌哰")).toBe(true);
    expect(t.hasPrefix("好")).toBe(false);
  });
});
