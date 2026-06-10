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
