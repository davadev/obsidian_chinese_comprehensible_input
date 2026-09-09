export interface StoryRequest {
  dueCount: number;
  lengthChars: number;
  style: "story" | "article" | "dialogue";
  targetHsk: string; // "auto" or "1".."6"
  includeGlossary: boolean;
}

export interface GeneratedStory {
  title: string;
  targetLevel: string;
  textChinese: string;
  // Optional — the LLM is no longer asked for these. Kept so older
  // providers that ignore the trimmed schema and still emit them don't
  // break parsing.
  targetWordsUsed?: { word: string; used: boolean; sentence?: string }[];
  glossary?: { word: string; pinyin: string; definition: string }[];
  notesForLearner?: string;
}

export interface ValidationReport {
  ok: boolean;
  missingWords: string[];
  /** Traditional was requested but the text contains no traditional-only
   *  character. Fails the report and triggers a repair — see StoryValidator. */
  wrongScript: boolean;
  tooHardWords: string[];
  englishRatio: number;
  lengthOk: boolean;
  score: number;
  notes: string[];
}
