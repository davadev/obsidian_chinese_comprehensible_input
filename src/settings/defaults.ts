import { CciSettings, CustomColors } from "./types";
import {
  DATA_SCHEMA_VERSION,
  GENERATED_NOTES_FOLDER_DEFAULT,
  VOCAB_MIRROR_PATH_DEFAULT,
} from "../constants";
import { WordStatus } from "../vocabulary/VocabularyTypes";

/**
 * Hex defaults match the RGBA values that used to live in styles.css so the
 * out-of-the-box appearance is unchanged after the var refactor. HSK
 * defaults follow a rainbow gradient so adjacent levels are easy to tell
 * apart at a glance.
 */
export const DEFAULT_CUSTOM_COLORS: CustomColors = {
  known: "#2ea043",
  partial: "#dcb41e",
  unknown: "#dc3c3c",
  new: "#58a6ff",
  hsk: {
    "1": "#dc3c3c",
    "2": "#e08c2a",
    "3": "#dcb41e",
    "4": "#2ea043",
    "5": "#3aa0c0",
    "6": "#586bdc",
    "7": "#9c4dc6",
  },
};

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
  useCedict: true,
  useEcdict: false,
  defaultDisplayMode: "none",
  knownWordPopups: false,
  showKnownColor: false,
  showPartialColor: true,
  showUnknownColor: true,
  showNewColor: true,
  showHskColors: { "1": true, "2": true, "3": true, "4": true, "5": true, "6": true, "7": true },
  colorMode: "status",
  customColors: DEFAULT_CUSTOM_COLORS,
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
    maxRepairIterations: 4,
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
    mirrorPollIntervalMinutes: 5,
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
