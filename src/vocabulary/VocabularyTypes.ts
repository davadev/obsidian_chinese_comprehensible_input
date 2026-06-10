export type WordStatus =
  | "new"
  | "known"
  | "unknown"
  | "meaningKnownPinyinUnknown"
  | "pinyinKnownMeaningUnknown"
  | "charactersUnknown"
  | "ignored";

/** What the user has confirmed they know about a word, broken into 3 axes. */
export interface KnownAxes {
  chars: boolean;
  pinyin: boolean;
  meaning: boolean;
}

/** Coarse color/state derived from axes for rendering. */
export type ColorState = "known" | "unknown" | "partial" | "ignored" | "new";

export interface WordRecord {
  key: string;
  surfaces: string[];
  simplified?: string;
  traditional?: string;
  pinyin?: string;
  definitions?: string[];
  hsk?: {
    source: string;
    levels: string[];
  };
  status: WordStatus;
  axes?: KnownAxes;
  firstSeenAt?: string;
  lastSeenAt?: string;
  /**
   * ISO timestamp the first time this word reached `known` status. Used by
   * the dashboard "learned per day/week/month" progress graph. Optional so
   * pre-existing records can be filled in lazily.
   */
  knownAt?: string;
  seenCount: number;

  recentSeenAt: string[];
  dailySeenCounts: Record<string, number>;
  /**
   * Per-note exposure counters keyed by note path. Lets the stats view
   * show per-note vocabulary stats in addition to global ones.
   */
  notesSeenCounts?: Record<string, number>;

  mnemonic?: {
    text?: string;
    emoji?: string;
    imagePath?: string;
    story?: string;
    updatedAt?: string;
  };

  srs?: {
    dueAt?: string;
    intervalDays?: number;
    ease?: number;
    stability?: number;
    difficulty?: number;
    lapses?: number;
    lastReviewedAt?: string;
  };

  notes?: string;
  ignoredReason?: string;
  updatedAt: string;
}

export interface PersistedVocabData {
  schemaVersion: number;
  words: Record<string, WordRecord>;
}
