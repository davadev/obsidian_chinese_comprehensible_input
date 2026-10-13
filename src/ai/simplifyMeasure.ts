import type { Token } from "../tokenizer/tokenizerTypes";
import type { WordStatus } from "../vocabulary/VocabularyTypes";
import { maxHskLevel } from "../dictionary/hskOverlay";
import { Measured, UNRATED_LEVEL, WordMeasure, summarise } from "./simplify";

/** What measuring a sentence needs from the plugin. */
export interface MeasureDeps {
  tokenize(text: string): Promise<Token[]>;
  /** The learner's status for a word as written, or undefined when they have never met it. */
  statusOf(surface: string): WordStatus | undefined;
}

/**
 * Tokenize `sentence` and look every dictionary word up in the HSK lists and the learner's vocabulary (#238). Punctuation,
 * Latin text and anything the dictionary does not know are not words here, so they neither help nor hurt a candidate.
 */
export async function measureText(sentence: string, deps: MeasureDeps): Promise<Measured> {
  const words: WordMeasure[] = [];
  for (const t of await deps.tokenize(sentence)) {
    if (!t.isWord || t.candidates.length === 0) continue;
    const entry = t.selected ?? t.candidates[0];
    const level = maxHskLevel(entry.hsk?.levels ?? []) || UNRATED_LEVEL;
    const status = deps.statusOf(t.surface);
    words.push({ surface: t.surface, level, known: status === "known" || status === "ignored" });
  }
  return summarise(sentence, words);
}
