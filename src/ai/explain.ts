import { sanitizeForFilename } from "./noteFiles";
import { isHanChar } from "./mnemonicFacts";

/**
 * The "Explain" note (#186): a structured, AI-written usage note for one word, kept as data so the plugin can check it
 * and lay it out the same way every time, instead of accepting free-form Markdown.
 *
 * The model returns the fields below; this module validates them, renders them as a Markdown note, and names the file.
 */

/** Bump when the prompt or the schema changes in a way a saved note should record. */
export const EXPLAIN_PROMPT_VERSION = 1;

export interface ExplainSense {
  label: string;
  meaning: string;
  /** A short Chinese sentence using this sense, or "". */
  example: string;
  exampleEnglish: string;
}

export interface ExplainCollocation {
  chinese: string;
  pinyin: string;
  english: string;
}

export interface ExplainExample {
  /** The situation: "Daily life", "Work", "Formal writing"… */
  context: string;
  chinese: string;
  pinyin: string;
  english: string;
}

/** What the pitfall is built from: a rule the note already gave, never a free-floating invented error. */
export type PitfallKind = "similar-word" | "pattern" | "english-habit" | "register";
const PITFALL_KINDS: PitfallKind[] = ["similar-word", "pattern", "english-habit", "register"];

export interface ExplainPitfall {
  kind: PitfallKind;
  /** The pitfall as one short instruction: "Put the time before the place." */
  rule: string;
  /** A short fragment or sentence showing the error, only when the model is sure it is wrong; otherwise "". */
  wrong: string;
  /** The correct fragment or sentence. */
  right: string;
}

export interface ExplainSimilar {
  word: string;
  pinyin: string;
  difference: string;
}

export interface ExplainCharacter {
  character: string;
  pinyin: string;
  meaning: string;
  /** The radical with its meaning, or "". */
  radical: string;
  /** How the character is built from parts, or "". */
  components: string;
  /** Where the character comes from, or "" when there is no well-established account. */
  etymology: string;
  /** "established" when scholars agree, "uncertain" when it is a popular guess or the model is not sure. */
  confidence: "established" | "uncertain";
}

export interface ExplainResult {
  summary: string;
  meaning: string;
  partOfSpeech: string;
  register: string;
  whenYouNeedIt: string[];
  senses: ExplainSense[];
  grammar: { pattern: string; measureWord: string; notes: string[] };
  collocations: ExplainCollocation[];
  examples: ExplainExample[];
  pitfalls: ExplainPitfall[];
  similar: ExplainSimilar[];
  characters: ExplainCharacter[];
  notes: string[];
}

const str = { type: "string" };
const strList = { type: "array", items: str };
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  required: Object.keys(props),
  additionalProperties: false,
  properties: props,
});

/**
 * Every property is required at every level, as `strict: true` json_schema mode demands (OpenAI and the LiteLLM / vLLM
 * proxies enforce it; Ollama does not). "Nothing to say" is an empty string or an empty list.
 */
export const EXPLAIN_SCHEMA = obj({
  summary: str,
  meaning: str,
  partOfSpeech: str,
  register: str,
  whenYouNeedIt: strList,
  senses: { type: "array", items: obj({ label: str, meaning: str, example: str, exampleEnglish: str }) },
  grammar: obj({ pattern: str, measureWord: str, notes: strList }),
  collocations: { type: "array", items: obj({ chinese: str, pinyin: str, english: str }) },
  examples: { type: "array", items: obj({ context: str, chinese: str, pinyin: str, english: str }) },
  pitfalls: {
    type: "array",
    items: obj({ kind: { type: "string", enum: PITFALL_KINDS }, rule: str, wrong: str, right: str }),
  },
  similar: { type: "array", items: obj({ word: str, pinyin: str, difference: str }) },
  characters: {
    type: "array",
    items: obj({
      character: str,
      pinyin: str,
      meaning: str,
      radical: str,
      components: str,
      etymology: str,
      confidence: { type: "string", enum: ["established", "uncertain"] },
    }),
  },
  notes: strList,
});

const MIN_EXAMPLES = 4;
const MAX_EXAMPLES = 10;

const text = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
const list = <T>(v: unknown, pick: (x: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => pick(x as Record<string, unknown>)) : [];
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/** Coerce whatever the model sent into the shape above; anything missing becomes empty rather than a crash. */
export function normaliseExplain(raw: unknown): ExplainResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const g = (o.grammar && typeof o.grammar === "object" ? o.grammar : {}) as Record<string, unknown>;
  return {
    summary: text(o.summary),
    meaning: text(o.meaning),
    partOfSpeech: text(o.partOfSpeech),
    register: text(o.register),
    whenYouNeedIt: strings(o.whenYouNeedIt),
    senses: list(o.senses, (x) => ({ label: text(x.label), meaning: text(x.meaning), example: text(x.example), exampleEnglish: text(x.exampleEnglish) })),
    grammar: { pattern: text(g.pattern), measureWord: text(g.measureWord), notes: strings(g.notes) },
    collocations: list(o.collocations, (x) => ({ chinese: text(x.chinese), pinyin: text(x.pinyin), english: text(x.english) })),
    examples: list(o.examples, (x) => ({ context: text(x.context), chinese: text(x.chinese), pinyin: text(x.pinyin), english: text(x.english) })),
    pitfalls: list(o.pitfalls, (x) => ({
      kind: PITFALL_KINDS.find((k) => k === x.kind) ?? "pattern",
      rule: text(x.rule),
      wrong: text(x.wrong),
      right: text(x.right),
    })),
    similar: list(o.similar, (x) => ({ word: text(x.word), pinyin: text(x.pinyin), difference: text(x.difference) })),
    characters: list(o.characters, (x) => ({
      character: text(x.character),
      pinyin: text(x.pinyin),
      meaning: text(x.meaning),
      radical: text(x.radical),
      components: text(x.components),
      etymology: text(x.etymology),
      confidence: x.confidence === "established" ? "established" : "uncertain",
    })),
    notes: strings(o.notes),
  };
}

export interface ExplainContext {
  /** Every written form of the word an example may use: as shown, simplified, traditional. */
  forms: string[];
  /** How many Han characters the word has. */
  charCount: number;
}

const HAS_HAN = (s: string): boolean => Array.from(s).some(isHanChar);

/**
 * Defects the plugin can see without knowing Chinese: sections missing, examples that do not contain the word,
 * half-filled mistake or contrast rows. It cannot see whether a stated rule is true; the note says so on its face.
 * Empty means good. Used for the single repair attempt, and for the note shown when that did not clear them.
 */
export function validateExplain(r: ExplainResult, ctx: ExplainContext): string[] {
  const issues: string[] = [];
  if (!r.summary) issues.push('"summary" is empty.');
  if (!r.meaning) issues.push('"meaning" is empty.');
  if (r.whenYouNeedIt.length === 0) issues.push('"whenYouNeedIt" needs at least one situation.');
  if (r.senses.length === 0 || r.senses.some((s) => !s.label || !s.meaning)) {
    issues.push('"senses" needs at least one sense, each with a label and a meaning.');
  }
  if (r.examples.length < MIN_EXAMPLES || r.examples.length > MAX_EXAMPLES) {
    issues.push(`"examples" needs ${MIN_EXAMPLES} to ${MAX_EXAMPLES} sentences; you sent ${r.examples.length}.`);
  }
  r.examples.forEach((e, i) => {
    if (!e.chinese || !HAS_HAN(e.chinese)) issues.push(`Example ${i + 1} has no Chinese sentence.`);
    else if (!ctx.forms.some((f) => e.chinese.includes(f))) {
      issues.push(`Example ${i + 1} does not contain the word ${ctx.forms[0]}; every example sentence must use it.`);
    }
    if (!e.english || HAS_HAN(e.english)) issues.push(`Example ${i + 1} needs an English translation without Chinese characters.`);
    if (!e.pinyin) issues.push(`Example ${i + 1} needs pinyin.`);
  });
  if (r.senses.some((s) => s.example && !ctx.forms.some((f) => s.example.includes(f)))) {
    issues.push(`Each sense example must contain the word ${ctx.forms[0]}; leave the example empty if no short sentence fits.`);
  }
  // An empty list is allowed: an invented pitfall is worse than none. A row needs its rule and the correct form, though;
  // the wrong form is optional because the model is told to leave it out when it is not sure.
  if (r.pitfalls.some((p) => !p.rule || !p.right)) {
    issues.push('Each entry in "pitfalls" needs a rule and the correct form.');
  }
  if (r.similar.some((s) => !s.word || !s.difference)) {
    issues.push('Each entry in "similar" needs the word and how it differs.');
  }
  if (r.collocations.some((c) => !c.chinese || !c.english)) {
    issues.push('Each collocation needs the Chinese and its English.');
  }
  if (r.characters.length !== ctx.charCount || r.characters.some((c) => !c.character || !c.pinyin || !c.meaning)) {
    issues.push(`"characters" needs exactly ${ctx.charCount} entr${ctx.charCount === 1 ? "y" : "ies"}, one per character of the word, each with its pinyin and meaning.`);
  }
  return issues;
}

export interface ExplainMeta {
  word: string;
  /** Tone-marked pinyin of the word. */
  pinyin: string;
  /** The vocabulary key (`simplified|pinyin`), so the note can be found again whatever it is renamed. */
  key: string;
  hsk: string;
  provider: string;
  model: string;
  /** YYYY-MM-DD. */
  date: string;
  showPinyin: boolean;
}

const BANNER = "AI-generated. Check anything important against a dictionary or a teacher before relying on it.";

function yamlString(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The file name: the word and its pinyin, so two readings of one surface (行 xíng, 行 háng) never collide. */
export function explainFileName(word: string, pinyin: string): string {
  return `${sanitizeForFilename(`${word} ${pinyin}`.trim()) || "Explanation"}.md`;
}

/** A run of text inside a block: plain, bold or italic. */
export type Inline = string | { b: string } | { i: string };

/**
 * The note as blocks, so the saved Markdown and the preview in the dialog are laid out from one description and cannot
 * drift apart. `depth` is the nesting of a list item.
 */
export type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; inline: Inline[]; callout?: boolean }
  | { kind: "li"; inline: Inline[]; depth: number; number?: number };

/**
 * Chinese example sentences are their own paragraphs so the plugin's reader annotates them like any other note, and
 * nothing relies on tables, which wrap badly on a phone.
 */
export function explainBlocks(r: ExplainResult, m: ExplainMeta): Block[] {
  const out: Block[] = [];
  const h = (level: 1 | 2 | 3, text: string) => out.push({ kind: "h", level, text });
  const p = (...inline: Inline[]) => out.push({ kind: "p", inline });
  const li = (depth: number, ...inline: Inline[]) => out.push({ kind: "li", inline, depth });

  out.push({ kind: "p", inline: [BANNER], callout: true });
  h(1, `${m.word}${m.pinyin ? ` (${m.pinyin})` : ""}`);
  const bits: Inline[] = [];
  if (r.meaning) bits.push({ b: r.meaning });
  if (r.partOfSpeech) bits.push(r.partOfSpeech);
  if (m.hsk) bits.push(`HSK ${m.hsk}`);
  if (r.register) bits.push(r.register);
  const glance: Inline[] = [];
  bits.forEach((b, i) => glance.push(...(i ? [" · ", b] : [b])));
  if (glance.length) out.push({ kind: "p", inline: glance });
  if (r.summary) p(r.summary);

  if (r.whenYouNeedIt.length) {
    h(2, "When you need this word");
    for (const s of r.whenYouNeedIt) li(0, s);
  }

  if (r.senses.length) {
    h(2, "Meanings");
    r.senses.forEach((s, i) => {
      out.push({ kind: "li", depth: 0, number: i + 1, inline: [{ b: s.label }, ` — ${s.meaning}`] });
      if (s.example) li(1, `${s.example}${s.exampleEnglish ? ` — ${s.exampleEnglish}` : ""}`);
    });
  }

  const g = r.grammar;
  if (g.pattern || g.measureWord || g.notes.length) {
    h(2, "How it behaves in a sentence");
    if (g.pattern) p({ b: "Pattern:" }, ` ${g.pattern}`);
    if (g.measureWord) p({ b: "Measure word:" }, ` ${g.measureWord}`);
    for (const n of g.notes) li(0, n);
  }

  if (r.collocations.length) {
    h(2, "Common combinations");
    for (const c of r.collocations) li(0, `${c.chinese}${m.showPinyin && c.pinyin ? ` (${c.pinyin})` : ""} — ${c.english}`);
  }

  if (r.examples.length) {
    h(2, "Examples");
    for (const e of r.examples) {
      if (e.context) h(3, e.context);
      p(e.chinese);
      if (m.showPinyin && e.pinyin) out.push({ kind: "p", inline: [{ i: e.pinyin }] });
      p(e.english);
    }
  }

  if (r.pitfalls.length) {
    h(2, "Watch out");
    for (const x of r.pitfalls) {
      out.push({ kind: "li", depth: 0, inline: [{ b: x.rule }] });
      if (x.wrong) li(1, `❌ ${x.wrong}`);
      li(1, `✅ ${x.right}`);
    }
  }

  if (r.similar.length) {
    h(2, "Similar words");
    for (const s of r.similar) out.push({ kind: "li", depth: 0, inline: [{ b: `${s.word}${s.pinyin ? ` (${s.pinyin})` : ""}` }, ` — ${s.difference}`] });
  }

  if (r.characters.length) {
    h(2, "The characters");
    for (const c of r.characters) {
      h(3, `${c.character}${c.pinyin ? ` (${c.pinyin})` : ""} — ${c.meaning}`);
      if (c.radical) out.push({ kind: "li", depth: 0, inline: [{ b: "Radical:" }, ` ${c.radical}`] });
      // The doubt covers the breakdown as well as the origin, so it is said on the last of the two lines.
      const doubt: Inline[] = c.confidence === "uncertain" ? [" ", { i: "(not settled; a popular or uncertain account)" }] : [];
      if (c.components) out.push({ kind: "li", depth: 0, inline: [{ b: "Built from:" }, ` ${c.components}`, ...(c.etymology ? [] : doubt)] });
      if (c.etymology) out.push({ kind: "li", depth: 0, inline: [{ b: "Origin:" }, ` ${c.etymology}`, ...doubt] });
    }
  }

  if (r.notes.length) {
    h(2, "Notes");
    for (const n of r.notes) li(0, n);
  }
  return out;
}

const inlineMd = (parts: Inline[]): string =>
  parts.map((x) => (typeof x === "string" ? x : "b" in x ? `**${x.b}**` : `*${x.i}*`)).join("");

/** The saved note: frontmatter so it can be found again whatever it is renamed to, then the blocks as Markdown. */
export function renderExplainMarkdown(r: ExplainResult, m: ExplainMeta): string {
  const lines = [
    "---",
    "cci-explain: true",
    `cci-word: ${yamlString(m.key)}`,
    `word: ${yamlString(m.word)}`,
    `pinyin: ${yamlString(m.pinyin)}`,
    `generated: ${m.date}`,
    `provider: ${yamlString(m.provider)}`,
    `model: ${yamlString(m.model)}`,
    `promptVersion: ${EXPLAIN_PROMPT_VERSION}`,
    "---",
    "",
  ];
  let prev: Block | null = null;
  for (const b of explainBlocks(r, m)) {
    const listContinues = prev?.kind === "li" && b.kind === "li";
    if (prev && !listContinues) lines.push("");
    if (b.kind === "h") lines.push(`${"#".repeat(b.level)} ${b.text}`);
    else if (b.kind === "p") lines.push(`${b.callout ? "> [!warning] " : ""}${inlineMd(b.inline)}`);
    else lines.push(`${"   ".repeat(b.depth)}${b.number ? `${b.number}.` : "-"} ${inlineMd(b.inline)}`);
    prev = b;
  }
  return `${lines.join("\n")}\n`;
}
