import { describe, expect, it } from "vitest";
import { tokenizeLatticeSpan, type LatticeScoringContext } from "../tokenizer/latticeTokenizer";
import { Trie } from "../tokenizer/Trie";

/**
 * The lattice tokenizer on its own: how a span is cut when the dictionary offers choices, what an unknown character costs,
 * and how the learner's own records tip a tie.
 */

const entry = (s: string, hsk?: string[]) => ({ simplified: s, traditional: s, pinyin: s, definitions: [s], ...(hsk ? { hsk: { source: "t", levels: hsk } } : {}) });
const dictOf = (words: Record<string, unknown[]>) => ({ lookup: (s: string) => words[s] ?? [] }) as any;
const trieOf = (...words: string[]) => {
  const t = new Trie();
  for (const w of words) t.insert(w);
  return t;
};
const ctx = (over: Partial<LatticeScoringContext> = {}): LatticeScoringContext => ({ hasRecord: () => false, knownBoost: () => 0, ...over });
const cut = (text: string, d: any, t: Trie, c = ctx()) => tokenizeLatticeSpan(text, 0, d, t, c).map((tok) => tok.surface);

describe("tokenizeLatticeSpan", () => {
  it("an empty span has no tokens", () => {
    expect(tokenizeLatticeSpan("", 0, dictOf({}), trieOf(), ctx())).toEqual([]);
  });

  it("offsets are relative to the span start", () => {
    const toks = tokenizeLatticeSpan("学习", 10, dictOf({ 学习: [entry("学习")] }), trieOf("学习"), ctx());
    expect([toks[0].start, toks[0].end]).toEqual([10, 12]);
  });

  it("prefers a longer dictionary word over its parts", () => {
    const d = dictOf({ 学习: [entry("学习")], 学: [entry("学")], 习: [entry("习")] });
    expect(cut("学习", d, trieOf("学习", "学", "习"))).toEqual(["学习"]);
  });

  it("a character the dictionary does not know is still a token, and a word", () => {
    const toks = tokenizeLatticeSpan("龘", 0, dictOf({}), trieOf(), ctx());
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({ surface: "龘", isWord: true, candidates: [], confidence: 0.3 });
    expect(toks[0].selected).toBeUndefined();
  });

  it("a trie entry the dictionary no longer has (a stale trie) costs more than a known one, whatever its length", () => {
    // Single-character and multi-character surfaces that are in the trie but not in the dictionary.
    expect(cut("丂", dictOf({}), trieOf("丂"))).toEqual(["丂"]);
    const d = dictOf({ 丂: [entry("丂")], 丄: [entry("丄")] });
    expect(cut("丂丄", d, trieOf("丂丄", "丂", "丄"))).toEqual(["丂", "丄"]); // "丂丄" has no entry: the parts win
  });

  it("the learner's own records break a tie between two ways to cut the text", () => {
    const d = dictOf({ ab: [entry("ab")], bc: [entry("bc")] });
    const t = trieOf("ab", "bc");
    expect(cut("abc", d, t, ctx({ hasRecord: (s) => s === "ab" }))).toEqual(["ab", "c"]);
    expect(cut("abc", d, t, ctx({ hasRecord: (s) => s === "bc" }))).toEqual(["a", "bc"]);
  });

  it("known-word boost and HSK level both pull a candidate toward being chosen", () => {
    const d = dictOf({ ab: [entry("ab", ["1"])], bc: [entry("bc", ["5"])] });
    const t = trieOf("ab", "bc");
    // HSK 1 (-0.3) beats HSK 5 (-0.1) with no other signal.
    expect(cut("abc", d, t)).toEqual(["ab", "c"]);
    expect(cut("abc", d, t, ctx({ knownBoost: (s) => (s === "bc" ? 0.5 : 0) }))).toEqual(["a", "bc"]);
  });

  it("many candidates cost a little more (ambiguity), and confidence falls with each extra reading", () => {
    const many = [entry("x"), entry("x"), entry("x"), entry("x"), entry("x")];
    const [tok] = tokenizeLatticeSpan("x", 0, dictOf({ x: many }), trieOf("x"), ctx());
    expect(tok.confidence).toBeCloseTo(0.4, 5);
    const [two] = tokenizeLatticeSpan("y", 0, dictOf({ y: [entry("y"), entry("y")] }), trieOf("y"), ctx());
    expect(two.confidence).toBeCloseTo(0.85, 5);
    const [one] = tokenizeLatticeSpan("z", 0, dictOf({ z: [entry("z")] }), trieOf("z"), ctx());
    expect(one.confidence).toBe(0.95);
  });

  it("picks an HSK-tagged candidate as the selected one when the first has no level", () => {
    const [tok] = tokenizeLatticeSpan("x", 0, dictOf({ x: [entry("x"), entry("x", ["2"])] }), trieOf("x"), ctx());
    expect(tok.selected?.hsk?.levels).toEqual(["2"]);
    const [plain] = tokenizeLatticeSpan("y", 0, dictOf({ y: [entry("y"), entry("y")] }), trieOf("y"), ctx());
    expect(plain.selected).toBe(plain.candidates[0]);
  });
});
