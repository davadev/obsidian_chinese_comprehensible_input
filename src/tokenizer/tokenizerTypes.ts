import { DictionaryEntry } from "../dictionary/DictionaryTypes";

export interface Token {
  start: number; // offset within full text
  end: number; // exclusive
  surface: string;
  /** True if this token is a CJK word the dictionary recognized. */
  isWord: boolean;
  candidates: DictionaryEntry[];
  selected?: DictionaryEntry;
  confidence: number;
}

export interface TokenizerOverride {
  /** Surface text in source, in source order. */
  surface: string;
  /** Split into these tokens instead of treating as one. */
  splitInto?: string[];
  /** Merge sequence as a single word (key/dict entry's surface). */
  mergeAs?: string;
  /** Force-ignore: treat as proper-noun/ignored. */
  ignore?: boolean;
}
