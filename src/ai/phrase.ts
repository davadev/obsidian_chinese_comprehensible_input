import { BANNER, Block, Inline, blocksToMarkdown, obj, str, strList, yamlString } from "./explain";
import { sanitizeForFilename } from "./noteFiles";

/**
 * Explain a phrase or a few sentences the learner selected (#186, phrase mode). The word note explains one word as a
 * dictionary-plus entry; this explains how a stretch of text works: what it says, its skeleton, and what each word is doing
 * in it grammatically. The plugin checks what it can see (every word of the selection is accounted for, in order) and the
 * result renders through the same `Block` model as the word note, so the preview and the saved Markdown share one layout.
 */

/** Bump when the prompt or the schema changes in a way a saved note should record. */
export const PHRASE_PROMPT_VERSION = 1;

export type PhraseVerdict = "ok" | "typo" | "wrong";
const VERDICTS: PhraseVerdict[] = ["ok", "typo", "wrong"];

/** The quick check made before explaining: is the text generally correct? */
export interface PhraseCheck {
  verdict: PhraseVerdict;
  /** For "wrong": what is wrong, in a sentence or two. For "typo": a few words. */
  note: string;
  /** For "typo": the wrong fragment and the fix. */
  original: string;
  suggestion: string;
}

export const PHRASE_CHECK_SCHEMA = obj({
  verdict: { type: "string", enum: VERDICTS },
  note: str,
  original: str,
  suggestion: str,
});

export interface PhraseWord {
  text: string;
  pinyin: string;
  /** The word's grammatical job in this sentence ("time word before the verb"), not a dictionary class. */
  role: string;
  /** Its sense here, in a few words. */
  meaning: string;
}

export interface PhraseGrammar {
  point: string;
  explanation: string;
  example: string;
}

export interface PhraseResult {
  translation: string;
  expresses: string;
  register: string;
  structure: string;
  breakdown: PhraseWord[];
  grammarPoints: PhraseGrammar[];
  /** One short line, only when the quick check found a typo. */
  typo: string;
  notes: string[];
}

export const PHRASE_SCHEMA = obj({
  translation: str,
  expresses: str,
  register: str,
  structure: str,
  breakdown: { type: "array", items: obj({ text: str, pinyin: str, role: str, meaning: str }) },
  grammarPoints: { type: "array", items: obj({ point: str, explanation: str, example: str }) },
  typo: str,
  notes: strList,
});

const text = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
const rows = <T>(v: unknown, pick: (x: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => pick(x as Record<string, unknown>)) : [];

export function normalisePhraseCheck(raw: unknown): PhraseCheck {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    verdict: VERDICTS.find((v) => v === o.verdict) ?? "ok",
    note: text(o.note),
    original: text(o.original),
    suggestion: text(o.suggestion),
  };
}

export function normalisePhrase(raw: unknown): PhraseResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    translation: text(o.translation),
    expresses: text(o.expresses),
    register: text(o.register),
    structure: text(o.structure),
    breakdown: rows(o.breakdown, (x) => ({ text: text(x.text), pinyin: text(x.pinyin), role: text(x.role), meaning: text(x.meaning) })),
    grammarPoints: rows(o.grammarPoints, (x) => ({ point: text(x.point), explanation: text(x.explanation), example: text(x.example) })),
    typo: text(o.typo),
    notes: Array.isArray(o.notes) ? o.notes.map(text).filter(Boolean) : [],
  };
}

/**
 * What the selection looks like once the note's own markup is taken off it, so the model sees the sentence and not the
 * formatting: bold, highlight and strike markers, HTML highlight/span tags, wiki links and Markdown links (their visible
 * text stays), and line breaks. `hasMarkup` says something was removed: the text is then no longer a character-for-character
 * copy of the note, so a correction cannot be applied back to it automatically.
 */
export function prepareSelection(raw: string): { text: string; hasMarkup: boolean } {
  let out = raw;
  let hasMarkup = false;
  const strip = (re: RegExp, to: string | ((...m: string[]) => string)): void => {
    out = out.replace(re, (...m: unknown[]) => {
      hasMarkup = true;
      return typeof to === "string" ? to : to(...(m as string[]));
    });
  };
  strip(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (_w, _target, alias) => alias);
  strip(/\[\[([^\]]*)\]\]/g, (_w, target) => target);
  strip(/\[([^\]]*)\]\([^)]*\)/g, (_w, label) => label);
  strip(/<\/?(?:mark|span)[^>]*>/g, "");
  strip(/\*\*|__|==|~~/g, "");
  return { text: out.replace(/\s*\n\s*/g, " ").trim(), hasMarkup };
}

/** The letters and digits of a text (Han characters are letters): what "every word is covered" is measured on. */
export function squash(t: string): string {
  return Array.from(t)
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .join("");
}

const brief = (t: string): string => (Array.from(t).length > 40 ? `${Array.from(t).slice(0, 40).join("")}…` : t);

/**
 * Defects the plugin can see without knowing Chinese: the word-by-word list must account for the whole selection, in
 * order, each word once (nothing added, nothing left out), and every row must be filled in. Empty means good.
 */
export function validatePhrase(r: PhraseResult, selection: string): string[] {
  const issues: string[] = [];
  if (!r.translation) issues.push('"translation" is empty.');
  if (!r.structure) issues.push('"structure" is empty.');
  if (r.breakdown.length === 0 || r.breakdown.some((w) => !w.text || !w.pinyin || !w.role || !w.meaning)) {
    issues.push('"breakdown" needs an entry for every word, each with its text, pinyin, grammatical role and meaning.');
  }
  const expected = squash(selection);
  const got = squash(r.breakdown.map((w) => w.text).join(""));
  if (r.breakdown.length > 0 && got !== expected) {
    issues.push(
      `The word-by-word list must cover the whole text exactly, in order, every word once; keep a mistyped character as written. It covers "${brief(got)}" but the text is "${brief(expected)}".`
    );
  }
  if (r.grammarPoints.some((g) => !g.point || !g.explanation)) {
    issues.push('Each entry in "grammarPoints" needs the point and an explanation.');
  }
  return issues;
}

export interface PhraseMeta {
  /** The selected text as the model saw it. */
  text: string;
  provider: string;
  model: string;
  /** YYYY-MM-DD. */
  date: string;
  showPinyin: boolean;
}

/** The note as blocks, shared by the dialog preview and the saved Markdown. */
export function phraseBlocks(r: PhraseResult, m: PhraseMeta): Block[] {
  const out: Block[] = [];
  const h = (level: 1 | 2 | 3, t: string) => out.push({ kind: "h", level, text: t });
  const p = (...inline: Inline[]) => out.push({ kind: "p", inline });
  const li = (depth: number, ...inline: Inline[]) => out.push({ kind: "li", inline, depth });

  out.push({ kind: "p", inline: [BANNER], callout: true });
  h(1, "Phrase explained");
  // Plain, so the reader annotates the Chinese like any other note.
  p(m.text);
  h(2, "Meaning");
  p({ b: r.translation });
  if (r.expresses) p(r.expresses);
  if (r.register) p({ i: r.register });
  h(2, "Structure");
  p(r.structure);
  if (r.breakdown.length) {
    h(2, "Word by word");
    for (const w of r.breakdown) {
      out.push({
        kind: "li",
        depth: 0,
        inline: [{ b: w.text }, m.showPinyin && w.pinyin ? ` (${w.pinyin})` : "", " — ", { i: w.role }, ` — ${w.meaning}`],
      });
    }
  }
  if (r.grammarPoints.length) {
    h(2, "Grammar points");
    for (const g of r.grammarPoints) {
      out.push({ kind: "li", depth: 0, inline: [{ b: g.point }, ` — ${g.explanation}`] });
      if (g.example) li(1, g.example);
    }
  }
  if (r.typo) {
    h(2, "A typo to note");
    p(r.typo);
  }
  if (r.notes.length) {
    h(2, "Notes");
    for (const n of r.notes) li(0, n);
  }
  return out;
}

/** The file name: the start of the text and the date, so two explanations of different passages never collide. */
export function phraseFileName(selection: string, date: string): string {
  const start = sanitizeForFilename(Array.from(selection).slice(0, 12).join(""));
  return `${start || "Phrase"} ${date}.md`;
}

export function renderPhraseMarkdown(r: PhraseResult, m: PhraseMeta): string {
  const lines = [
    "---",
    "cci-explain-phrase: true",
    `cci-phrase: ${yamlString(m.text)}`,
    `generated: ${m.date}`,
    `provider: ${yamlString(m.provider)}`,
    `model: ${yamlString(m.model)}`,
    `promptVersion: ${PHRASE_PROMPT_VERSION}`,
    "---",
    "",
    ...blocksToMarkdown(phraseBlocks(r, m)),
  ];
  return `${lines.join("\n")}\n`;
}
