import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES,
  alignEnds,
  Measured,
  UNRATED_LEVEL,
  candidateProblem,
  compareDifficulty,
  describeGain,
  levelLabel,
  normaliseSimplify,
  rankCandidates,
  summarise,
  usableCandidates,
  validateSimplify,
} from "../ai/simplify";
import { PHRASE_ACTIONS, estimatePhraseUsd, phraseActionOf } from "../ai/phraseCost";
import { SIMPLIFY_SYSTEM_PROMPT, buildSimplifyUserPrompt } from "../ai/prompts";

/** Simplify (#238): the AI writes candidates; the plugin validates, measures and ranks them. */

const ORIGINAL = "尽管天气恶劣，我们仍然坚持出发。";
const simplified = () => false;
const w = (surface: string, level: number, known = false) => ({ surface, level, known });

describe("normaliseSimplify", () => {
  it("keeps trimmed text and change, and tolerates anything else", () => {
    expect(normaliseSimplify({ candidates: [{ text: " 天气不好，我们还是走了。 ", change: " Drops 尽管. " }, null, "x", { text: 5 }] })).toEqual({
      candidates: [
        { text: "天气不好，我们还是走了。", change: "Drops 尽管." },
        { text: "", change: "" },
      ],
    });
    expect(normaliseSimplify(null)).toEqual({ candidates: [] });
    expect(normaliseSimplify({ candidates: "no" })).toEqual({ candidates: [] });
  });
});

describe("alignEnds: a rewrite starts and ends like the selection", () => {
  it("drops the closing punctuation the selection did not include, so applying cannot double it", () => {
    expect(alignEnds("天气不好，但我们还是按原来的计划出发。", "尽管天气恶劣，我们仍然坚持按原计划出发")).toBe("天气不好，但我们还是按原来的计划出发");
  });

  it("adds the closing punctuation the selection had, and keeps the selection's own when the rewrite used another", () => {
    expect(alignEnds("我们走了", "我们出发了。")).toBe("我们走了。");
    expect(alignEnds("我们走了！", "我们出发了。")).toBe("我们走了。");
  });

  it("does the same at the start (opening quotes), with surrounding spaces and several marks", () => {
    expect(alignEnds("“我们走了。”", "我们出发了")).toBe("我们走了");
    expect(alignEnds("我们走了", "“我们出发了。”")).toBe("“我们走了。”");
    expect(alignEnds("我们走了。", "我们出发了 \n")).toBe("我们走了 \n");
  });

  it("leaves punctuation inside the rewrite alone, and a rewrite that is only punctuation as it is", () => {
    expect(alignEnds("天气不好，我们走了。", "天气恶劣，我们出发")).toBe("天气不好，我们走了");
    expect(alignEnds("。。", "我们出发了")).toBe("。。");
  });
});

describe("candidateProblem / validateSimplify / usableCandidates", () => {
  const ok = { text: "天气不好，我们还是走了。", change: "" };

  it("accepts a different Chinese sentence", () => {
    expect(candidateProblem(ok, ORIGINAL, simplified)).toBeNull();
    expect(validateSimplify({ candidates: [ok] }, ORIGINAL, simplified)).toEqual([]);
  });

  it("accepts an empty list: the text may already be as simple as it gets", () => {
    expect(validateSimplify({ candidates: [] }, ORIGINAL, simplified)).toEqual([]);
  });

  it("rejects empty or non-Chinese text, a copy of the original and a script switch", () => {
    expect(candidateProblem({ text: "", change: "" }, ORIGINAL, simplified)).toMatch(/not Chinese/);
    expect(candidateProblem({ text: "It was bad weather.", change: "" }, ORIGINAL, simplified)).toMatch(/not Chinese/);
    expect(candidateProblem({ text: ` ${ORIGINAL} `.trim(), change: "" }, ORIGINAL, simplified)).toMatch(/same as the original/);
    const trad = (s: string) => s.includes("氣");
    expect(candidateProblem({ text: "天氣不好。", change: "" }, ORIGINAL, trad)).toMatch(/Traditional/);
    expect(candidateProblem({ text: "天氣不好。", change: "" }, "天氣很好。", trad)).toBeNull();
  });

  it("counts a rewrite that differs from the selection only in its end punctuation as the same", () => {
    expect(candidateProblem({ text: "我们出发了。", change: "" }, "我们出发了", simplified)).toMatch(/same as the original/);
    expect(candidateProblem({ text: "我们出发了", change: "" }, "我们出发了。", simplified)).toMatch(/same as the original/);
  });

  it("gives usable candidates the selection's own end punctuation, and drops one that becomes a duplicate", () => {
    const got = usableCandidates(
      { candidates: [{ text: "天气不好，我们走了。", change: "a" }, { text: "天气不好，我们走了", change: "b" }, { text: "天气不好。", change: "c" }] },
      ORIGINAL.replace(/。$/, ""),
      simplified
    );
    expect(got).toEqual([
      { text: "天气不好，我们走了", change: "a" },
      { text: "天气不好", change: "c" },
    ]);
  });

  it("flags too many candidates", () => {
    const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({ text: `第${i}个`, change: "" }));
    expect(validateSimplify({ candidates: many }, ORIGINAL, simplified)).toEqual([`Give at most ${MAX_CANDIDATES} candidates; you sent ${MAX_CANDIDATES + 1}.`]);
  });

  it("uses only usable, distinct candidates, at most MAX_CANDIDATES", () => {
    const list = [ok, ok, { text: "", change: "" }, { text: ORIGINAL, change: "" }, ...Array.from({ length: 9 }, (_, i) => ({ text: `我们走了${i}`, change: "" }))];
    const got = usableCandidates({ candidates: list }, ORIGINAL, simplified);
    expect(got).toHaveLength(MAX_CANDIDATES);
    expect(got[0]).toEqual(ok);
    expect(new Set(got.map((c) => c.text)).size).toBe(MAX_CANDIDATES);
  });
});

describe("measuring", () => {
  it("sums the levels of the words the learner does not know, and records the hardest one", () => {
    const m = summarise("我喜欢尽管", [w("我", 1, true), w("喜欢", 2), w("尽管", 6)]);
    expect(m).toMatchObject({ cost: 8, hardest: 6, unknown: 2, chars: 5 });
  });

  it("a sentence of known words costs nothing", () => {
    expect(summarise("我", [w("我", 1, true)])).toMatchObject({ cost: 0, hardest: 0, unknown: 0 });
    expect(summarise("", [])).toMatchObject({ cost: 0, hardest: 0, unknown: 0, chars: 0 });
  });

  it("orders by cost, then hardest word, then unknown words, then length", () => {
    const base = summarise("aaaa", [w("a", 3), w("b", 3)]);
    const cheaper = summarise("aaaa", [w("a", 2), w("b", 2)]);
    expect(compareDifficulty(cheaper, base)).toBeLessThan(0);
    const flatter = summarise("aaaa", [w("a", 3), w("b", 3)]); // same cost 6
    const spiky = summarise("aaaa", [w("a", 5), w("b", 1)]); // cost 6, hardest 5
    expect(compareDifficulty(flatter, spiky)).toBeLessThan(0);
    const fewer = summarise("aaaa", [w("a", 4), w("b", 2, true)]); // cost 4
    const more = summarise("aaaa", [w("a", 2), w("b", 1), w("c", 1)]); // cost 4, hardest 2... compare unknown after hardest
    expect(compareDifficulty(more, fewer)).toBeLessThan(0);
    const longer = summarise("aaaaa", [w("a", 3)]);
    const shorter = summarise("aaaa", [w("a", 3)]);
    expect(compareDifficulty(shorter, longer)).toBeLessThan(0);
    expect(compareDifficulty(shorter, shorter)).toBe(0);
  });

  it("unknown words weigh more than known ones: a known HSK 6 word is free, an unknown name is not", () => {
    const knowsIt = summarise("x", [w("尽管", 6, true)]);
    const name = summarise("x", [w("某某", UNRATED_LEVEL)]);
    expect(compareDifficulty(knowsIt, name)).toBeLessThan(0);
  });
});

describe("rankCandidates", () => {
  const original = summarise(ORIGINAL, [w("尽管", 6), w("恶劣", 7), w("坚持", 5)]);
  const plain = { ...summarise("天气不好，我们还是走了。", [w("天气", 1, true), w("不好", 1, true), w("走", 1)]), change: "" };
  const middle = { ...summarise("虽然天气不好，我们还是走了。", [w("虽然", 2), w("天气", 1, true), w("还是", 2), w("走", 1)]), change: "" };

  it("puts the simplest first and proposes it when it beats the original", () => {
    const { ranked, best } = rankCandidates(original, [middle, plain]);
    expect(ranked).toEqual([plain, middle]);
    expect(best).toBe(plain);
  });

  it("proposes nothing when no candidate is strictly simpler than the original", () => {
    const harder = { ...summarise("x", [w("恶劣", 7), w("尽管", 6), w("坚持", 5), w("别的", 5)]), change: "" };
    expect(rankCandidates(original, [harder]).best).toBeNull();
    expect(rankCandidates(original, [{ ...original, change: "" }]).best).toBeNull();
    expect(rankCandidates(original, [])).toEqual({ ranked: [], best: null });
  });

  it("does not change the order of the list it was given", () => {
    const given = [middle, plain];
    rankCandidates(original, given);
    expect(given).toEqual([middle, plain]);
  });
});

describe("how it is shown", () => {
  it("names levels", () => {
    expect(levelLabel(0)).toBe("none");
    expect(levelLabel(3)).toBe("HSK 3");
    expect(levelLabel(7)).toBe("HSK 7-9");
    expect(levelLabel(UNRATED_LEVEL)).toBe("not in HSK");
  });

  it("states the gain in numbers", () => {
    const a: Measured = summarise("a", [w("a", 6), w("b", 5)]);
    const b: Measured = summarise("b", [w("c", 2)]);
    expect(describeGain(a, b)).toBe("Words you don't know yet: 2 → 1 · Hardest of them: HSK 6 → HSK 2");
    expect(describeGain(a, summarise("c", []))).toContain("→ none");
  });
});

describe("the prompt", () => {
  it("asks for 4 to 6 same-meaning rewrites in the same script, an empty list when already simple, and no judging", () => {
    expect(SIMPLIFY_SYSTEM_PROMPT).toMatch(/4 to 6 different ways to say the SAME thing/);
    expect(SIMPLIFY_SYSTEM_PROMPT).toMatch(/same script/);
    expect(SIMPLIFY_SYSTEM_PROMPT).toMatch(/return an empty list/);
    expect(SIMPLIFY_SYSTEM_PROMPT).toMatch(/strict JSON only/);
    expect(buildSimplifyUserPrompt("你好")).toBe("Text to simplify:\n你好\n\nReply with JSON only.");
  });
});

describe("the lightbulb actions", () => {
  it("knows its three actions and falls back to Explain for anything else", () => {
    expect(Object.keys(PHRASE_ACTIONS)).toEqual(["explain", "proofread", "simplify"]);
    expect(phraseActionOf("simplify")).toBe("simplify");
    for (const odd of ["toString", "", null, 3, undefined]) expect(phraseActionOf(odd)).toBe("explain");
  });

  it("estimates Simplify as one call that costs more than proof reading and less than explaining", () => {
    const simplify = estimatePhraseUsd("simplify", 150, "gpt-6-luna");
    expect(simplify).toBeGreaterThan(estimatePhraseUsd("proofread", 150, "gpt-6-luna"));
    expect(simplify).toBeLessThan(estimatePhraseUsd("explain", 150, "gpt-6-luna"));
  });
});
