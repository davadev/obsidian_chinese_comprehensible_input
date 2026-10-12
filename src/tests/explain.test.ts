import { describe, expect, it } from "vitest";
import {
  EXPLAIN_PROMPT_VERSION,
  EXPLAIN_SCHEMA,
  explainBlocks,
  explainFileName,
  normaliseExplain,
  renderExplainMarkdown,
  validateExplain,
} from "../ai/explain";
import { FULL, META, clone } from "./explainFixture";

/**
 * The Explain note (#186): what counts as a usable answer, and how the same data becomes the saved Markdown. The plugin
 * cannot tell whether a stated rule is true, so these checks are about form: sections present, every example uses the
 * word, no half-filled rows.
 */

const CTX = { forms: ["方便"], charCount: 2 };

describe("normaliseExplain", () => {
  it("keeps a complete answer as it is", () => {
    expect(normaliseExplain(clone(FULL))).toEqual(FULL);
  });

  it("turns anything missing, mistyped or odd into empty values instead of crashing", () => {
    const r = normaliseExplain({
      summary: 3,
      whenYouNeedIt: ["a", 2, ""],
      senses: [null, "x", { label: " L " }],
      grammar: "no",
      characters: [{ character: "方", confidence: "maybe" }],
      examples: "none",
    });
    expect(r.summary).toBe("");
    expect(r.whenYouNeedIt).toEqual(["a"]);
    expect(r.senses).toEqual([{ label: "L", meaning: "", example: "", exampleEnglish: "" }]);
    expect(r.grammar).toEqual({ pattern: "", measureWord: "", notes: [] });
    expect(r.characters[0]).toMatchObject({ character: "方", confidence: "uncertain" });
    expect(r.examples).toEqual([]);
    expect(normaliseExplain(null).summary).toBe("");
    expect(normaliseExplain("text").notes).toEqual([]);
    expect(normaliseExplain({ characters: [{ confidence: "established" }] }).characters[0].confidence).toBe("established");
  });
});

describe("EXPLAIN_SCHEMA", () => {
  it("makes every property required at every level, as strict json_schema needs", () => {
    const walk = (node: any): void => {
      if (node?.type === "object") {
        expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
        expect(node.additionalProperties).toBe(false);
        Object.values(node.properties).forEach(walk);
      }
      if (node?.type === "array") walk(node.items);
    };
    walk(EXPLAIN_SCHEMA);
    expect(Object.keys(EXPLAIN_SCHEMA.properties)).toContain("characters");
  });
});

describe("validateExplain", () => {
  it("accepts a complete explanation", () => {
    expect(validateExplain(clone(FULL), CTX)).toEqual([]);
  });

  it("reports missing core fields and sections", () => {
    const r = normaliseExplain({});
    const issues = validateExplain(r, CTX);
    expect(issues).toEqual(
      expect.arrayContaining([
        '"summary" is empty.',
        '"meaning" is empty.',
        '"whenYouNeedIt" needs at least one situation.',
        '"senses" needs at least one sense, each with a label and a meaning.',
        '"examples" needs 4 to 10 sentences; you sent 0.',
        '"characters" needs exactly 2 entries, one per character of the word, each with its pinyin and meaning.',
      ])
    );
  });

  it("says 'entry' for a single character", () => {
    const r = clone(FULL);
    r.characters = [];
    expect(validateExplain(r, { forms: ["方便"], charCount: 1 })).toEqual([
      '"characters" needs exactly 1 entry, one per character of the word, each with its pinyin and meaning.',
    ]);
  });

  it("checks every example: Chinese present, the word used, English without Chinese, pinyin given", () => {
    const r = clone(FULL);
    r.examples[0].chinese = "";
    r.examples[1].chinese = "你明天有空吗？";
    r.examples[2].english = "不方便";
    r.examples[3].pinyin = "";
    expect(validateExplain(r, CTX)).toEqual([
      "Example 1 has no Chinese sentence.",
      "Example 2 does not contain the word 方便; every example sentence must use it.",
      "Example 3 needs an English translation without Chinese characters.",
      "Example 4 needs pinyin.",
    ]);
  });

  it("accepts an example that uses the Traditional form, and rejects too many examples", () => {
    const r = clone(FULL);
    r.examples[0].chinese = "這裡買東西很方便。";
    expect(validateExplain(r, { forms: ["便利", "方便"], charCount: 2 })).toEqual([]);
    r.examples = Array.from({ length: 11 }, () => FULL.examples[0]);
    expect(validateExplain(r, CTX)).toEqual(['"examples" needs 4 to 10 sentences; you sent 11.']);
  });

  it("needs a sense example, when there is one, to use the word", () => {
    const r = clone(FULL);
    r.senses[0].example = "这是一个权宜之计。";
    expect(validateExplain(r, CTX)).toEqual(['Each sense example must contain the word 方便; leave the example empty if no short sentence fits.']);
    r.senses[0].example = "";
    expect(validateExplain(r, CTX)).toEqual([]);
  });

  it("allows no pitfalls at all, since an invented one is worse than none, but needs a pinyin for every character", () => {
    const r = clone(FULL);
    r.pitfalls = [];
    expect(validateExplain(r, CTX)).toEqual([]);
    r.characters[1].pinyin = "";
    expect(validateExplain(r, CTX)).toEqual([
      '"characters" needs exactly 2 entries, one per character of the word, each with its pinyin and meaning.',
    ]);
  });

  it("rejects half-filled rows", () => {
    const r = clone(FULL);
    r.pitfalls[0].rule = "";
    r.similar[0].difference = "";
    r.collocations[0].english = "";
    r.senses[0].meaning = "";
    expect(validateExplain(r, CTX)).toEqual([
      '"senses" needs at least one sense, each with a label and a meaning.',
      'Each entry in "pitfalls" needs a rule and the correct form.',
      'Each entry in "similar" needs the word and how it differs.',
      "Each collocation needs the Chinese and its English.",
    ]);
  });
});

describe("explainFileName", () => {
  it("names the file after the word and its pinyin", () => {
    expect(explainFileName("方便", "fāng biàn")).toBe("方便 fāng biàn.md");
    expect(explainFileName("行", "xíng")).toBe("行 xíng.md");
  });

  it("strips characters a file name cannot hold and never produces an empty name", () => {
    expect(explainFileName("a/b", "c:d")).toBe("ab cd.md");
    expect(explainFileName("", "")).toBe("Explanation.md");
  });
});

describe("renderExplainMarkdown", () => {
  const md = renderExplainMarkdown(FULL, META);

  it("starts with frontmatter that lets the note be found again", () => {
    expect(md.startsWith("---\ncci-explain: true\n")).toBe(true);
    expect(md).toContain('cci-word: "方便|fang1bian4"');
    expect(md).toContain('word: "方便"');
    expect(md).toContain('pinyin: "fāng biàn"');
    expect(md).toContain("generated: 2026-10-12");
    expect(md).toContain('provider: "openai"');
    expect(md).toContain('model: "gpt-6-luna"');
    expect(md).toContain(`promptVersion: ${EXPLAIN_PROMPT_VERSION}`);
  });

  it("escapes quotes and backslashes in frontmatter values", () => {
    const out = renderExplainMarkdown(FULL, { ...META, word: 'a"b\\c' });
    expect(out).toContain('word: "a\\"b\\\\c"');
  });

  it("warns that it is AI-written, then gives the title and an at-a-glance line", () => {
    expect(md).toContain("> [!warning] AI-generated. Check anything important");
    expect(md).toContain("# 方便 (fāng biàn)");
    expect(md).toContain("**convenient; easy; to make things easy** · adjective, also a verb · HSK 3 · neutral");
    expect(md).toContain("A very common word for things that are easy");
  });

  it("lays out the sections in a fixed, readable order", () => {
    const headings = md.split("\n").filter((l) => /^#{1,3} /.test(l));
    expect(headings.slice(0, 7)).toEqual([
      "# 方便 (fāng biàn)",
      "## When you need this word",
      "## Meanings",
      "## How it behaves in a sentence",
      "## Common combinations",
      "## Examples",
      "### Daily life",
    ]);
    expect(headings).toEqual(expect.arrayContaining(["## Watch out", "## Similar words", "## The characters", "### 方 (fāng) — square; direction", "## Notes"]));
  });

  it("numbers the meanings and nests their example under them", () => {
    expect(md).toContain("1. **Convenient** — easy and handy\n   - 住在这里很方便。 — Living here is convenient.");
    expect(md).toContain("2. **Suitable** — at a good time for someone");
  });

  it("keeps each example as its own paragraph so the reader annotates it, with pinyin in italics", () => {
    expect(md).toContain("### Daily life\n\n这里买东西很方便。\n\n*Zhèlǐ mǎi dōngxi hěn fāngbiàn.*\n\nShopping here is convenient.");
  });

  it("shows a pitfall as a rule, then the wrong form (when the model was sure of one) and the right form", () => {
    expect(md).toContain("- **Put the time before 方便, then the activity.**\n   - ❌ 你方便明天见面吗？\n   - ✅ 你明天方便见面吗？");
    // no wrong form given: only the rule and the correct form
    expect(md).toContain("- **Use 便利 for facilities, 方便 for people and times.**\n   - ✅ 交通便利 / 你方便吗？\n");
    expect(md).not.toContain("❌ \n");
  });

  it("accepts a pitfall without a wrong form and reads an unknown kind as a pattern", () => {
    const r = normaliseExplain({ pitfalls: [{ kind: "nonsense", rule: "R", right: "Y" }, { kind: "register", rule: "R2", wrong: "X", right: "Y2" }] });
    expect(r.pitfalls).toEqual([
      { kind: "pattern", rule: "R", wrong: "", right: "Y" },
      { kind: "register", rule: "R2", wrong: "X", right: "Y2" },
    ]);
    expect(validateExplain({ ...clone(FULL), pitfalls: r.pitfalls }, CTX)).toEqual([]);
  });

  it("describes each character, and marks an uncertain origin", () => {
    expect(md).toContain("- **Radical:** 亻 (person)");
    expect(md).toContain("- **Built from:** 亻 (person) beside 更 (change)");
    expect(md).toContain("- **Origin:** A person adjusting things.\n");
    const uncertain = renderExplainMarkdown(
      { ...FULL, characters: [{ ...FULL.characters[0], etymology: "A folk story.", confidence: "uncertain" }] },
      META
    );
    expect(uncertain).toContain("- **Origin:** A folk story. *(not settled; a popular or uncertain account)*");
    // the doubt covers the breakdown too: with no origin it goes on the "Built from" line
    const split = renderExplainMarkdown(
      { ...FULL, characters: [{ ...FULL.characters[0], components: "A and B", etymology: "", confidence: "uncertain" }] },
      META
    );
    expect(split).toContain("- **Built from:** A and B *(not settled; a popular or uncertain account)*");
    expect(split).not.toContain("**Origin:**");
  });

  it("can leave the pinyin lines out", () => {
    const out = renderExplainMarkdown(FULL, { ...META, showPinyin: false });
    expect(out).not.toContain("*Zhèlǐ");
    expect(out).toContain("- 很方便 — very convenient");
    expect(md).toContain("- 很方便 (hěn fāngbiàn) — very convenient");
  });

  it("leaves out sections that have nothing in them, and the pinyin and level that are not known", () => {
    const bare = renderExplainMarkdown(
      normaliseExplain({ summary: "S", meaning: "M", examples: [{ context: "", chinese: "你好", pinyin: "", english: "Hi" }] }),
      { ...META, pinyin: "", hsk: "" }
    );
    expect(bare).toContain("# 方便\n");
    expect(bare).toContain("**M**\n");
    expect(bare).not.toContain("HSK");
    for (const h of ["## When you need", "## Meanings", "## How it behaves", "## Watch out", "## Similar", "## The characters", "## Notes", "## Common"]) {
      expect(bare).not.toContain(h);
    }
    expect(bare).toContain("## Examples\n\n你好\n\nHi\n");
  });

  it("builds the at-a-glance line from whatever is known and omits it when nothing is", () => {
    const only = (over: object) => renderExplainMarkdown(normaliseExplain({ examples: [], ...over }), { ...META, hsk: "" });
    expect(only({ partOfSpeech: "verb" })).toContain("\n\nverb\n");
    expect(only({ register: "spoken" })).toContain("\n\nspoken\n");
    expect(only({ meaning: "m", register: "spoken" })).toContain("**m** · spoken");
    const none = only({});
    expect(none).toBe(renderExplainMarkdown(normaliseExplain({}), { ...META, hsk: "" }));
    expect(none).not.toContain("·");
    expect(none).not.toContain("A very common");
  });

  it("copes with rows that have no pinyin, no example or no translation", () => {
    const r = clone(FULL);
    r.similar = [{ word: "便利", pinyin: "", difference: "More formal." }];
    r.characters = [{ ...FULL.characters[0], pinyin: "", etymology: "", components: "", radical: "" }];
    r.collocations = [{ chinese: "很方便", pinyin: "", english: "very convenient" }];
    r.senses = [{ label: "Only", meaning: "m", example: "例子", exampleEnglish: "" }];
    r.examples = [{ context: "", chinese: "很方便。", pinyin: "", english: "Handy." }];
    const out = renderExplainMarkdown(r, META);
    expect(out).toContain("- **便利** — More formal.");
    expect(out).toContain("### 方 — square; direction\n");
    expect(out).not.toContain("**Radical:**");
    expect(out).toContain("- 很方便 — very convenient");
    expect(out).toContain("   - 例子\n");
    expect(out).toContain("## Examples\n\n很方便。\n\nHandy.");
  });

  it("has no runs of blank lines and ends with one newline", () => {
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("explainBlocks", () => {
  it("describes the note once for both the file and the preview", () => {
    const blocks = explainBlocks(FULL, META);
    expect(blocks[0]).toMatchObject({ kind: "p", callout: true });
    expect(blocks[1]).toEqual({ kind: "h", level: 1, text: "方便 (fāng biàn)" });
    expect(blocks.some((b) => b.kind === "li" && b.number === 2)).toBe(true);
  });

  it("writes only the pattern, only the measure word, or only notes when that is all there is", () => {
    const g = (grammar: object) => explainBlocks({ ...FULL, grammar: { pattern: "", measureWord: "", notes: [], ...grammar } }, META);
    expect(g({ pattern: "P" }).some((b) => b.kind === "p" && b.inline.includes(" P"))).toBe(true);
    expect(g({ measureWord: "个" }).some((b) => b.kind === "p" && b.inline.includes(" 个"))).toBe(true);
    expect(g({ notes: ["n"] }).some((b) => b.kind === "li" && b.inline[0] === "n")).toBe(true);
  });
});
