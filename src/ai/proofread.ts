import { obj, str } from "./explain";

/**
 * Proof read a selection (#186, proof-read mode): find the real mistakes, say why each is wrong, give the smallest fix.
 *
 * The model returns only the corrections. The corrected text is worked out here, never taken from the model, so what the
 * learner is shown and what is written into the note can only differ from the original by the listed spans.
 */

/** More than this in a short selection means the text is not close to correct; the model is told to stop at the worst. */
export const MAX_CORRECTIONS = 5;

export interface Correction {
  /** Copied exactly from the selection: the shortest span that contains the mistake. */
  original: string;
  /** The corrected span; empty when the fix is to delete. */
  replacement: string;
  /** One short sentence in English. */
  why: string;
}

export interface ProofreadResult {
  corrections: Correction[];
}

export const PROOFREAD_SCHEMA = obj({
  corrections: { type: "array", items: obj({ original: str, replacement: str, why: str }) },
});

const text = (s: unknown): string => (typeof s === "string" ? s.trim() : "");

export function normaliseProofread(raw: unknown): ProofreadResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.corrections) ? o.corrections : [];
  return {
    corrections: list
      .filter((c) => c && typeof c === "object")
      .map((c) => {
        const x = c as Record<string, unknown>;
        // `original` is not trimmed: a span such as "了 " must match the text exactly.
        return {
          original: typeof x.original === "string" ? x.original : "",
          replacement: typeof x.replacement === "string" ? x.replacement : "",
          why: text(x.why),
        };
      }),
  };
}

export interface LocatedCorrection extends Correction {
  start: number;
  end: number;
}

/**
 * Where each correction sits in `selection`, in text order. A span that occurs twice is placed at its first free
 * occurrence, so two corrections with the same original land on two different places. A span that is not in the text is
 * left out (validation reports it).
 */
export function locateCorrections(selection: string, corrections: Correction[]): LocatedCorrection[] {
  const nextFrom = new Map<string, number>();
  const out: LocatedCorrection[] = [];
  for (const c of corrections) {
    if (!c.original) continue;
    const start = selection.indexOf(c.original, nextFrom.get(c.original) ?? 0);
    if (start < 0) continue;
    nextFrom.set(c.original, start + c.original.length);
    out.push({ ...c, start, end: start + c.original.length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Defects the plugin can see: spans that are not in the text, no-op or overlapping fixes, missing reasons, too many. */
export function validateProofread(r: ProofreadResult, selection: string): string[] {
  const issues: string[] = [];
  if (r.corrections.length > MAX_CORRECTIONS) {
    issues.push(`Give at most ${MAX_CORRECTIONS} corrections, the most important ones; you sent ${r.corrections.length}.`);
  }
  r.corrections.forEach((c, i) => {
    if (!c.original || !selection.includes(c.original)) {
      issues.push(`Correction ${i + 1}: "original" must be copied exactly from the text, and "${c.original}" is not in it.`);
    } else if (c.replacement === c.original) {
      issues.push(`Correction ${i + 1}: the replacement is the same as the original; leave it out if the text is correct.`);
    }
    if (!c.why) issues.push(`Correction ${i + 1} needs a reason.`);
  });
  const placed = locateCorrections(selection, r.corrections);
  if (placed.some((c, i) => i > 0 && c.start < placed[i - 1].end)) {
    issues.push("Corrections must not overlap; merge overlapping ones into a single correction.");
  }
  return issues;
}

/** The selection with every correction applied (right to left, so earlier spans keep their positions). */
export function applyCorrections(selection: string, corrections: Correction[]): string {
  let out = selection;
  for (const c of [...locateCorrections(selection, corrections)].reverse()) {
    out = out.slice(0, c.start) + c.replacement + out.slice(c.end);
  }
  return out;
}
