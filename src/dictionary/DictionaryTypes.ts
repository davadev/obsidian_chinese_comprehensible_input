export type DictionarySource = "seed" | "cedict" | "ecdict" | "custom" | "override";

export interface DictionaryEntry {
  simplified: string;
  traditional: string;
  pinyin: string;
  definitions: string[];
  hsk?: {
    source: string;
    levels: string[];
  };
  frequencyRank?: number;
  pos?: string[];
  /** Where this entry came from. Used by the popup to show source labels.
   *  Optional for backward-compat: missing = "cedict" / "seed". */
  source?: DictionarySource;
  /** ECDICT reverse-lookup hit: the English headword whose translation
   *  contains the queried Chinese surface. Empty for CC-CEDICT entries. */
  englishHeadword?: string;
}

/** One ECDICT row's contribution to the reverse-lookup index. */
export interface EcdictReverseEntry {
  word: string;        // English headword
  phonetic?: string;   // IPA or k.k. phonetic
  translation: string; // The full Chinese translation field
}

/** Map from Chinese substring → array of ECDICT entries whose translation
 *  contains that substring. Pre-computed at download time so runtime
 *  lookup is O(1). Buckets are capped to avoid bloating on hot chars. */
export type EcdictReverseIndex = Record<string, EcdictReverseEntry[]>;

export interface DictionaryManifest {
  source: string;
  version: string;
  downloadedAt: string;
  shardCount: number;
  license: string;
}

export interface HskManifest {
  source: string;
  version: string;
  downloadedAt: string;
  license: string;
}

/**
 * Per-entry override the user has typed into the Edit Dictionary modal.
 * Keyed by the entry's canonical `simplified|original-pinyin` so vocab
 * keys stay stable across edits (re-keying would orphan WordRecords).
 * Survives dictionary redownloads because it lives in the plugin data
 * blob, not in the dictionary file.
 */
export interface DictionaryOverride {
  pinyin?: string;
  traditional?: string;
  definitions?: string[];
  hsk?: { source: string; levels: string[] };
  notes?: string;
  updatedAt: string;
}

export type DictionaryOverrides = Record<string, DictionaryOverride>;

/**
 * A user-added word, typically a proper noun or multi-character compound
 * the dictionary doesn't recognize. Stored as a full DictionaryEntry so
 * the lookup path can return it without merge logic.
 */
export interface DictionaryCustomWord {
  simplified: string;
  traditional?: string;
  pinyin: string;
  definitions: string[];
  hsk?: { source: string; levels: string[] };
  createdAt: string;
  updatedAt: string;
}

export type DictionaryCustomWords = Record<string, DictionaryCustomWord>;
