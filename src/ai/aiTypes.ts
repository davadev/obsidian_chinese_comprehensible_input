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
  targetWordsUsed: { word: string; used: boolean; sentence?: string }[];
  glossary: { word: string; pinyin: string; definition: string }[];
  notesForLearner?: string;
}

export interface ValidationReport {
  ok: boolean;
  missingWords: string[];
  tooHardWords: string[];
  englishRatio: number;
  lengthOk: boolean;
  score: number;
  notes: string[];
}
