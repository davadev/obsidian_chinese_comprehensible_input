export type DisplayMode = "two-line" | "three-line" | "popup-only" | "color-only";
export type ViewMode = "read" | "edit" | "mark-known" | "mark-unknown" | "mark-partial";
export type PinyinStyle = "marks" | "numbers" | "none";
export type TokenizerEngine = "lattice" | "intl-segmenter" | "experimental";
export type HskSource = "2.0" | "3.0" | "both";

export interface AiSettings {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  endpointMode: "chat" | "responses";
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRepairIterations: number;
}

export interface ExposureSettings {
  minVisibleMs: number;
  maxOncePerNotePerSession: boolean;
  maxOncePerDay: boolean;
  popupCountsAsExposure: boolean;
  generatedReadingCountsAsExposure: boolean;
}

export interface SrsSettings {
  scheduleKnownOccasionally: boolean;
  popupOnDueIsFailedRecall: boolean;
  initialIntervalDays: number;
  initialEase: number;
}

export interface StorySettings {
  folder: string;
  defaultDueCount: number;
  defaultLengthChars: number;
  defaultStyle: "story" | "article" | "dialogue";
  knownCoverageThreshold: number;
  includeGlossary: boolean;
}

export interface DictionarySourceMeta {
  source: string;
  versionLine: string;
  downloadedAt: string;
  entryCount: number;
  outputPath: string;
}

export interface CciSettings {
  schemaVersion: number;
  dictionarySource?: DictionarySourceMeta;
  defaultDisplayMode: DisplayMode;
  knownWordPopups: boolean;
  showKnownColor: boolean;
  showPartialColor: boolean;
  showUnknownColor: boolean;
  pinyinStyle: PinyinStyle;
  hskSource: HskSource;
  tokenizerEngine: TokenizerEngine;
  newWordBehavior: "popup-only" | "subtle" | "annotate";
  unknownWordBehavior: "annotate" | "popup-only";
  exposure: ExposureSettings;
  srs: SrsSettings;
  ai: AiSettings;
  story: StorySettings;
  exactTimestampRetentionLimit: number;
  storeAllExactTimestamps: boolean;
  densityCapPercent: number;
  mnemonicsFirst: boolean;
  /** Base font size for the Chinese Learning view, in pixels. */
  readerFontPx: number;
}
