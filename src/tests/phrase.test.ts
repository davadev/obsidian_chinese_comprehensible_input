import { describe, expect, it } from "vitest";
import {
  PHRASE_CHECK_SCHEMA,
  PHRASE_PROMPT_VERSION,
  PHRASE_SCHEMA,
  PhraseMeta,
  PhraseResult,
  normalisePhrase,
  normalisePhraseCheck,
  phraseBlocks,
  phraseFileName,
  prepareSelection,
  renderPhraseMarkdown,
  squash,
  validatePhrase,
} from "../ai/phrase";
import { extractJsonObject } from "../ai/jsonReply";

/**
 * Phrase explanations (#186): what counts as a usable answer (every word of the selection accounted for, in order) and
 * how the same data becomes the saved Markdown.
 */

const TEXT = "我打算明年去北京。";
const FULL: PhraseResult = {
  translation: "I plan to go to Beijing next year.",
  expresses: "States a plan for the coming year.",
  register: "neutral",
  structure: "Subject + 打算 + Time + 去 + Place",
  breakdown: [
    { text: "我", pinyin: "wǒ", role: "subject", meaning: "I" },
    { text: "打算", pinyin: "dǎ suàn", role: "main verb expressing intention", meaning: "plan to" },
    { text: "明年", pinyin: "míng nián", role: "time word before the action", meaning: "next year" },
    { text: "去", pinyin: "qù", role: "verb of motion", meaning: "go" },
    { text: "北京", pinyin: "Běi jīng", role: "place the motion goes to", meaning: "Beijing" },
  ],
  grammarPoints: [{ point: "打算 + Verb", explanation: "Expresses an intention to do something.", example: "我打算学中文。 (I plan to study Chinese.)" }],
  typo: "",
  notes: ["打算 is milder than 决定."],
};
const META: PhraseMeta = { text: TEXT, provider: "openai", model: "gpt-6-luna", date: "2026-10-12", showPinyin: true };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("extractJsonObject", () => {
  it("parses a plain object and one wrapped in prose and fences", () => {
    expect(extractJsonObject('{"a":1}', "x")).toEqual({ a: 1 });
    expect(extractJsonObject('Here:\n```json\n{"a":2}\n```\nDone.', "x")).toEqual({ a: 2 });
  });

  it("names what it was asked for when there is no object or it is malformed", () => {
    expect(() => extractJsonObject("sorry", "explanation")).toThrow("AI did not return a JSON object for the explanation.");
    expect(() => extractJsonObject('{"a": "x}', "x")).toThrow(/Could not parse AI JSON/);
  });
});

describe("schemas and normalisers", () => {
  it("make every property required at every level, as strict json_schema needs", () => {
    const walk = (node: any): void => {
      if (node?.type === "object") {
        expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
        expect(node.additionalProperties).toBe(false);
        Object.values(node.properties).forEach(walk);
      }
      if (node?.type === "array") walk(node.items);
    };
    walk(PHRASE_SCHEMA);
    walk(PHRASE_CHECK_SCHEMA);
  });

  it("keeps a complete answer and turns anything odd into empty values", () => {
    expect(normalisePhrase(clone(FULL))).toEqual(FULL);
    const r = normalisePhrase({ translation: 3, breakdown: [null, "x", { text: " 我 " }], grammarPoints: "no", notes: ["a", 2, ""] });
    expect(r.translation).toBe("");
    expect(r.breakdown).toEqual([{ text: "我", pinyin: "", role: "", meaning: "" }]);
    expect(r.grammarPoints).toEqual([]);
    expect(r.notes).toEqual(["a"]);
    expect(normalisePhrase(null).structure).toBe("");
    expect(normalisePhrase({ grammarPoints: [{ point: "p" }] }).grammarPoints).toEqual([{ point: "p", explanation: "", example: "" }]);
  });

  it("reads the quick check, and treats an unknown verdict as fine", () => {
    expect(normalisePhraseCheck({ verdict: "typo", note: " n ", original: "x", suggestion: "y" })).toEqual({ verdict: "typo", note: "n", original: "x", suggestion: "y" });
    expect(normalisePhraseCheck({ verdict: "wrong", note: "bad" }).verdict).toBe("wrong");
    expect(normalisePhraseCheck({ verdict: "dunno" }).verdict).toBe("ok");
    expect(normalisePhraseCheck(null)).toEqual({ verdict: "ok", note: "", original: "", suggestion: "" });
  });
});

describe("prepareSelection", () => {
  it("leaves plain text alone", () => {
    expect(prepareSelection(TEXT)).toEqual({ text: TEXT, hasMarkup: false });
  });

  it("takes off the note's own markup, keeping the visible text, and says it did", () => {
    expect(prepareSelection("我**打算**==明年==去~~北京~~。")).toEqual({ text: "我打算明年去北京。", hasMarkup: true });
    expect(prepareSelection("去[[北京|首都]]和[[上海]]和[城市](https://x.y)")).toEqual({ text: "去首都和上海和城市", hasMarkup: true });
    expect(prepareSelection('<mark style="background:#ff0">北京</mark>和<span class="a">上海</span>')).toEqual({ text: "北京和上海", hasMarkup: true });
  });

  it("turns line breaks into a single space and trims", () => {
    expect(prepareSelection("  你好。\n\n  再见。 ")).toEqual({ text: "你好。 再见。", hasMarkup: false });
  });
});

describe("squash", () => {
  it("keeps letters and digits (Han characters are letters) and drops spaces and punctuation", () => {
    expect(squash("我 打算，明年 去 2027 年 ABC。")).toBe("我打算明年去2027年ABC");
    expect(squash("")).toBe("");
  });
});

describe("validatePhrase", () => {
  it("accepts a complete answer", () => {
    expect(validatePhrase(clone(FULL), TEXT)).toEqual([]);
  });

  it("accepts a selection with punctuation, spaces and several sentences", () => {
    const r = clone(FULL);
    expect(validatePhrase(r, "我 打算，明年去北京！")).toEqual([]);
  });

  it("reports missing core fields", () => {
    const issues = validatePhrase(normalisePhrase({}), TEXT);
    expect(issues).toEqual(['"translation" is empty.', '"structure" is empty.', '"breakdown" needs an entry for every word, each with its text, pinyin, grammatical role and meaning.']);
  });

  it("reports a word left out, a word added, and the wrong order", () => {
    const left = clone(FULL);
    left.breakdown.splice(2, 1);
    expect(validatePhrase(left, TEXT)[0]).toContain('It covers "我打算去北京" but the text is "我打算明年去北京"');
    const added = clone(FULL);
    added.breakdown.push({ text: "吗", pinyin: "ma", role: "particle", meaning: "?" });
    expect(validatePhrase(added, TEXT)).toHaveLength(1);
    const swapped = clone(FULL);
    [swapped.breakdown[3], swapped.breakdown[4]] = [swapped.breakdown[4], swapped.breakdown[3]];
    expect(validatePhrase(swapped, TEXT)).toHaveLength(1);
  });

  it("shortens long text in the message", () => {
    const long = "我".repeat(60);
    const r = clone(FULL);
    const issues = validatePhrase(r, long);
    expect(issues[0]).toContain(`${"我".repeat(40)}…`);
  });

  it("rejects half-filled rows", () => {
    const r = clone(FULL);
    r.breakdown[1].role = "";
    r.grammarPoints[0].explanation = "";
    expect(validatePhrase(r, TEXT)).toEqual([
      '"breakdown" needs an entry for every word, each with its text, pinyin, grammatical role and meaning.',
      'Each entry in "grammarPoints" needs the point and an explanation.',
    ]);
  });
});

describe("phraseFileName", () => {
  it("is the start of the text and the date", () => {
    expect(phraseFileName(TEXT, "2026-10-12")).toBe("我打算明年去北京。 2026-10-12.md");
    expect(phraseFileName("一二三四五六七八九十十一十二十三", "2026-10-12")).toBe("一二三四五六七八九十十一 2026-10-12.md");
  });

  it("strips characters a file name cannot hold and never starts empty", () => {
    expect(phraseFileName("a/b:c", "2026-10-12")).toBe("abc 2026-10-12.md");
    expect(phraseFileName("///", "2026-10-12")).toBe("Phrase 2026-10-12.md");
  });
});

describe("renderPhraseMarkdown", () => {
  const md = renderPhraseMarkdown(FULL, META);

  it("starts with frontmatter that marks it as a phrase explanation", () => {
    expect(md.startsWith("---\ncci-explain-phrase: true\n")).toBe(true);
    expect(md).toContain('cci-phrase: "我打算明年去北京。"');
    expect(md).toContain("generated: 2026-10-12");
    expect(md).toContain('model: "gpt-6-luna"');
    expect(md).toContain(`promptVersion: ${PHRASE_PROMPT_VERSION}`);
    expect(md).not.toContain("cci-explain: true");
  });

  it("warns it is AI-written, then gives the text as its own plain paragraph (so the reader annotates it)", () => {
    expect(md).toContain("> [!warning] AI-generated.");
    expect(md).toContain("# Phrase explained\n\n我打算明年去北京。\n\n## Meaning");
    expect(md).toContain("**I plan to go to Beijing next year.**");
    expect(md).toContain("States a plan for the coming year.");
    expect(md).toContain("*neutral*");
  });

  it("explains every word's job, in order", () => {
    expect(md).toContain("## Word by word\n\n- **我** (wǒ) — *subject* — I\n- **打算** (dǎ suàn) — *main verb expressing intention* — plan to");
    const order = FULL.breakdown.map((w) => md.indexOf(`**${w.text}**`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lists grammar points with their example, and the notes", () => {
    expect(md).toContain("- **打算 + Verb** — Expresses an intention to do something.\n   - 我打算学中文。 (I plan to study Chinese.)");
    expect(md).toContain("## Notes\n\n- 打算 is milder than 决定.");
    expect(md).not.toContain("A typo to note");
  });

  it("mentions a typo briefly, and can leave pinyin out", () => {
    const typo = renderPhraseMarkdown({ ...FULL, typo: "明午 should be 明年." }, META);
    expect(typo).toContain("## A typo to note\n\n明午 should be 明年.");
    expect(renderPhraseMarkdown(FULL, { ...META, showPinyin: false })).toContain("- **我** — *subject* — I");
  });

  it("leaves out empty sections, and has no runs of blank lines", () => {
    const bare = renderPhraseMarkdown({ ...FULL, expresses: "", register: "", grammarPoints: [{ point: "P", explanation: "E", example: "" }], notes: [] }, META);
    expect(bare).not.toContain("## Notes");
    expect(bare).toContain("- **P** — E\n");
    expect(bare).not.toContain("   - ");
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.endsWith("\n")).toBe(true);
    const empty = phraseBlocks(normalisePhrase({ translation: "t", structure: "s" }), META);
    expect(empty.some((b) => b.kind === "h" && b.text === "Word by word")).toBe(false);
    expect(empty.some((b) => b.kind === "h" && b.text === "Grammar points")).toBe(false);
  });
});
