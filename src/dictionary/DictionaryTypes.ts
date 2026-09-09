export interface DictionaryEntry {
  simplified: string;
  traditional: string;
  pinyin: string;
  /** Taiwan reading, when CC-CEDICT records one as a "Taiwan pr. [le4 se4]"
   *  gloss. Derived at index time, so it is present without re-downloading
   *  the dictionary. Absent for the ~99.6% of entries with no Taiwan-specific
   *  reading — fall back to `pinyin`. */
  pinyinTaiwan?: string;
  definitions: string[];
  hsk?: {
    source: string;
    levels: string[];
  };
  frequencyRank?: number;
  pos?: string[];
  /** Optional English grammar note. Only set when populated by an
   *  override (manual or AI-enhanced); never present on raw CC-CEDICT
   *  entries. Rendered below the definitions list in the word popup. */
  grammar?: string;
}

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
  /** Corrected Taiwan reading, when the user disagrees with (or wants to
   *  add) the one derived from CC-CEDICT. */
  pinyinTaiwan?: string;
  traditional?: string;
  definitions?: string[];
  hsk?: { source: string; levels: string[] };
  notes?: string;
  /** Optional English grammar note that the popup renders below the
   *  definitions list when present. Populated by the AI "Enhance" flow
   *  or by a future manual-edit field; absent on legacy overrides. */
  grammar?: string;
  /** How this override was produced. "user" = typed in EditDictionaryModal;
   *  "ai" = produced by EnhanceDictionaryService. Optional for backward
   *  compatibility with overrides written before this field existed. */
  source?: "user" | "ai";
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
