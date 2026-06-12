import { CciSettings } from "./types";
import {
  DATA_SCHEMA_VERSION,
  GENERATED_NOTES_FOLDER_DEFAULT,
  VOCAB_MIRROR_PATH_DEFAULT,
} from "../constants";
import { WordStatus } from "../vocabulary/VocabularyTypes";

/**
 * Default conflict-resolution priority for two-device sync. Mirrors the
 * existing `pickWinningStatus` rank in VocabularyStore so behaviour stays
 * consistent with `importJson` until the user reorders it.
 */
export const DEFAULT_STATUS_PRIORITY: WordStatus[] = [
  "ignored",
  "known",
  "meaningKnownPinyinUnknown",
  "pinyinKnownMeaningUnknown",
  "charactersUnknown",
  "unknown",
  "new",
];

export const DEFAULT_SETTINGS: CciSettings = {
  schemaVersion: DATA_SCHEMA_VERSION,
  defaultDisplayMode: "popup-only",
  knownWordPopups: false,
  showKnownColor: false,
  showPartialColor: true,
  showUnknownColor: true,
  pinyinStyle: "marks",
  hskSource: "both",
  tokenizerEngine: "lattice",
  newWordBehavior: "subtle",
  unknownWordBehavior: "popup-only",
  exposure: {
    minVisibleMs: 1000,
    maxOncePerNotePerSession: true,
    maxOncePerDay: false,
    popupCountsAsExposure: true,
    generatedReadingCountsAsExposure: true,
  },
  srs: {
    scheduleKnownOccasionally: false,
    popupOnDueIsFailedRecall: true,
    initialIntervalDays: 1,
    initialEase: 2.5,
  },
  ai: {
    enabled: false,
    providerName: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    chatModel: "qwen2.5:7b",
    embeddingModel: "",
    endpointMode: "chat",
    temperature: 0.6,
    maxOutputTokens: 8000,
    timeoutMs: 300000,
    maxRepairIterations: 1,
    responseFormat: "json_object",
    suppressThinking: true,
    stream: true,
    debug: false,
  },
  story: {
    folder: GENERATED_NOTES_FOLDER_DEFAULT,
    defaultDueCount: 12,
    defaultLengthChars: 400,
    defaultStyle: "story",
    knownCoverageThreshold: 0.8,
    includeGlossary: true,
    sendKnownWords: false,
    knownWordsSamplePercent: 30,
  },
  sync: {
    mirrorEnabled: false,
    mirrorPath: VOCAB_MIRROR_PATH_DEFAULT,
    statusPriority: DEFAULT_STATUS_PRIORITY,
  },
  exactTimestampRetentionLimit: 500,
  storeAllExactTimestamps: false,
  densityCapPercent: 35,
  mnemonicsFirst: false,
  readerFontPx: 22,
  vaultIndexed: false,
  autoDownloadDictionary: true,
  statsExcludeNew: true,
  flashcardsMode: "unclassified",
};
