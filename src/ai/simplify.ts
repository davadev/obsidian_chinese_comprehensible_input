import { obj, str } from "./explain";
import { isHanChar } from "./mnemonicFacts";

/**
 * Simplify a selection (#238): the AI proposes several ways to say the same thing, the plugin measures every one against
 * the HSK word lists and the learner's own vocabulary and picks the simplest. The AI never judges difficulty and never
 * picks: it only writes candidates. What is shown as "simpler" is a number the plugin computed from the words.
 */

/** More than this is not asked for and not used: the prompt asks for 4 to 6. */
export const MAX_CANDIDATES = 6;

/** A word with no HSK level (a name, a rare word, a term beyond the lists) counts as harder than any HSK level. */
export const UNRATED_LEVEL = 8;

export interface Candidate {
  /** The whole selection, rewritten. */
  text: string;
  /** One short sentence in English: what differs in meaning, tone or detail. Empty when nothing does. */
  change: string;
}

export interface SimplifyResult {
  candidates: Candidate[];
}

export const SIMPLIFY_SCHEMA = obj({
  candidates: { type: "array", items: obj({ text: str, change: str }) },
});

const text = (s: unknown): string => (typeof s === "string" ? s.trim() : "");

export function normaliseSimplify(raw: unknown): SimplifyResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.candidates) ? o.candidates : [];
  return {
    candidates: list
      .filter((c) => c && typeof c === "object")
      .map((c) => {
        const x = c as Record<string, unknown>;
        return { text: text(x.text), change: text(x.change) };
      }),
  };
}

/** What is wrong with one candidate, in words the model can act on; null when it is usable. */
export function candidateProblem(c: Candidate, original: string, isTraditional: (s: string) => boolean): string | null {
  if (!c.text || !Array.from(c.text).some(isHanChar)) return `"${c.text}" is not Chinese text.`;
  if (c.text === original.trim()) return `"${c.text}" is the same as the original; every candidate must be a different way to say it.`;
  if (isTraditional(c.text) && !isTraditional(original)) return `"${c.text}" is in Traditional characters but the text is Simplified; keep the script of the text.`;
  return null;
}

/** Defects the plugin can see: unusable candidates and too many of them. An empty list is a valid answer ("already simple"). */
export function validateSimplify(r: SimplifyResult, original: string, isTraditional: (s: string) => boolean): string[] {
  const issues: string[] = [];
  if (r.candidates.length > MAX_CANDIDATES) issues.push(`Give at most ${MAX_CANDIDATES} candidates; you sent ${r.candidates.length}.`);
  for (const c of r.candidates) {
    const problem = candidateProblem(c, original, isTraditional);
    if (problem) issues.push(problem);
  }
  return issues;
}

/** The candidates worth measuring: usable, different from the original, no duplicates, at most MAX_CANDIDATES. */
export function usableCandidates(r: SimplifyResult, original: string, isTraditional: (s: string) => boolean): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of r.candidates) {
    if (candidateProblem(c, original, isTraditional) || seen.has(c.text)) continue;
    seen.add(c.text);
    out.push(c);
    if (out.length === MAX_CANDIDATES) break;
  }
  return out;
}

// ── measuring ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** One dictionary word of a sentence. */
export interface WordMeasure {
  surface: string;
  /** HSK level 1 to 7 (7 = the 7 to 9 band), or UNRATED_LEVEL. */
  level: number;
  /** The learner marked it known (or ignored it, as for a name). */
  known: boolean;
}

/** A sentence and what is hard about it for this learner. */
export interface Measured {
  text: string;
  words: WordMeasure[];
  /** Sum of the levels of the words the learner does not know yet: the main measure of difficulty. */
  cost: number;
  /** The highest level among the words the learner does not know yet; 0 when they know them all. */
  hardest: number;
  /** How many words the learner does not know yet. */
  unknown: number;
  /** Characters, to break ties in favour of the shorter. */
  chars: number;
}

export function summarise(sentence: string, words: WordMeasure[]): Measured {
  const hard = words.filter((w) => !w.known);
  return {
    text: sentence,
    words,
    cost: hard.reduce((n, w) => n + w.level, 0),
    hardest: hard.reduce((n, w) => Math.max(n, w.level), 0),
    unknown: hard.length,
    chars: Array.from(sentence).length,
  };
}

/** Negative when `a` is simpler than `b`: lower cost, then lower hardest word, then fewer unknown words, then shorter. */
export function compareDifficulty(a: Measured, b: Measured): number {
  return a.cost - b.cost || a.hardest - b.hardest || a.unknown - b.unknown || a.chars - b.chars;
}

export interface Ranking<T extends Measured> {
  /** Every candidate, simplest first. */
  ranked: T[];
  /** The simplest, only if it is strictly simpler than the original; null means "the original is about as simple as it gets". */
  best: T | null;
}

export function rankCandidates<T extends Measured>(original: Measured, candidates: T[]): Ranking<T> {
  const ranked = [...candidates].sort(compareDifficulty);
  const best = ranked.length > 0 && compareDifficulty(ranked[0], original) < 0 ? ranked[0] : null;
  return { ranked, best };
}

export function levelLabel(level: number): string {
  if (level <= 0) return "none";
  return level >= UNRATED_LEVEL ? "not in HSK" : level === 7 ? "HSK 7-9" : `HSK ${level}`;
}

/** "Words you don't know yet 4 → 1 · hardest HSK 5 → HSK 2": what changed, measured, for the dialog. */
export function describeGain(from: Measured, to: Measured): string {
  return `Words you don't know yet: ${from.unknown} → ${to.unknown} · Hardest of them: ${levelLabel(from.hardest)} → ${levelLabel(to.hardest)}`;
}
