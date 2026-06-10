export type WordStatus =
  | "new"
  | "known"
  | "unknown"
  | "meaningKnownPinyinUnknown"
  | "pinyinKnownMeaningUnknown"
  | "charactersUnknown"
  | "ignored";

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
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount: number;

  recentSeenAt: string[];
  dailySeenCounts: Record<string, number>;

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
