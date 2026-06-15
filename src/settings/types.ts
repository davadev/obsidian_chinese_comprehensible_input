import { WordStatus } from "../vocabulary/VocabularyTypes";

export type DisplayMode = "two-line" | "three-line" | "none";
export type ColorMode = "status" | "hsk";

export interface CustomColors {
  /** Hex (e.g. "#2ea043"). Used as the source for color-mix() in styles.css. */
  known: string;
  partial: string;
  unknown: string;
  new: string;
  hsk: {
    "1": string;
    "2": string;
    "3": string;
    "4": string;
    "5": string;
    "6": string;
    "7": string;
  };
}
export type ViewMode =
  | "read"
  | "edit"
  | "mark-known"
  | "mark-unknown"
  | "mark-partial"
  /** Tap-to-collect chars/words into a single new custom-word surface. */
  | "select-word";
export type PinyinStyle = "marks" | "numbers" | "none";
export type TokenizerEngine = "lattice" | "intl-segmenter" | "experimental";
export type HskSource = "2.0" | "3.0" | "both";

export interface SyncSettings {
  /**
   * When on, the plugin keeps a vault-side JSON mirror of the vocabulary
   * store at `mirrorPath`. The mirror lives outside `.obsidian/` so the
   * remotely-save plugin syncs it without "sync config dir" enabled. On
   * load and on external `modify` events the mirror is merged back into
   * the in-memory store using `mergeForSync` (idempotent).
   */
  mirrorEnabled: boolean;
  mirrorPath: string;
  /** Opt-in: write a vault-side JSON mirror of display + behavioral
   *  settings (no credentials, no device-local paths). Lets multiple
   *  devices share preferences via remotely-save / Nextcloud the same
   *  way vocabulary syncs. */
  settingsMirrorEnabled: boolean;
  settingsMirrorPath: string;
  /**
   * Belt-and-suspenders for the vault `modify` watcher: every N minutes,
   * re-hash the mirror file on disk and merge if it differs from what we
   * last wrote. Catches updates pulled in by remotely-save while the
   * window was backgrounded, or written outside Obsidian's vault layer.
   * 0 disables the poll; "Force re-sync now" still works.
   */
  mirrorPollIntervalMinutes: number;
  /**
   * User-ordered priority list used by `resolveStatus` when two devices
   * have set different statuses on the same word. Earlier in the list =
   * wins. The hardcoded "new always loses" rule runs first, so `new`'s
   * position here only matters in the (never-actually-reached) case where
   * both sides are `new`.
   */
  statusPriority: WordStatus[];
}

export interface AiSettings {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  endpointMode: "chat" | "responses" | "ollama";
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRepairIterations: number;
  /**
   * How to ask the model for structured output. `json_object` is the
   * broadest-compatibility choice (works for Ollama, OpenAI, vLLM,
   * Anthropic-compat shims). `json_schema` is stricter but only OpenAI
   * + Ollama >= 0.5.7 honour it; some MLX builds return empty when it
   * is set. `none` sends no `response_format` flag — relies on the
   * prompt alone, useful when both flags break the provider.
   */
  responseFormat: "json_object" | "json_schema" | "none";
  /**
   * Append `/no_think` to the system prompt so qwen3-style thinking
   * models skip the long reasoning trace that otherwise eats the
   * completion-token budget. Harmless to non-thinking models.
   */
  suppressThinking: boolean;
  /**
   * Use Server-Sent Events streaming. Tailscale / corporate VPNs and
   * some load balancers close idle HTTP connections after ~30-60 s;
   * streaming keeps bytes flowing as the model generates, defeating
   * that idle-kill. Required for slow local LLMs reached over a VPN.
   */
  stream: boolean;
  /**
   * When true, AiProviderService fires verbose Notices at each milestone
   * of an HTTP request (DNS-resolve, send, first byte, each Nth chunk,
   * finish). Plus richer console.log timing. Off by default — only flip
   * on while diagnosing a stuck request.
   */
  debug: boolean;
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
  sendKnownWords: boolean;
  knownWordsSamplePercent: number;
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
  /** Show the "new" (untracked) word tint in status mode. */
  showNewColor: boolean;
  /** Per-HSK-level visibility. Honoured only when colorMode === "hsk". */
  showHskColors: {
    "1": boolean;
    "2": boolean;
    "3": boolean;
    "4": boolean;
    "5": boolean;
    "6": boolean;
    "7": boolean;
  };
  /** Pick which color scheme the reader and stats use. */
  colorMode: ColorMode;
  /** User-customizable colors per status bucket and HSK level. */
  customColors: CustomColors;
  /**
   * Marker bumped whenever the user explicitly resets HSK colors or on
   * very first install. When unset, the plugin populates the HSK palette
   * from the active Obsidian accent color on next load.
   */
  hskColorsDerivedFromAccent?: boolean;
  pinyinStyle: PinyinStyle;
  hskSource: HskSource;
  tokenizerEngine: TokenizerEngine;
  newWordBehavior: "popup-only" | "subtle" | "annotate";
  unknownWordBehavior: "annotate" | "popup-only";
  exposure: ExposureSettings;
  srs: SrsSettings;
  ai: AiSettings;
  story: StorySettings;
  sync: SyncSettings;
  exactTimestampRetentionLimit: number;
  storeAllExactTimestamps: boolean;
  densityCapPercent: number;
  mnemonicsFirst: boolean;
  /** Base font size for the Chinese Learning view, in pixels. */
  readerFontPx: number;
  /** Have we completed a full vault scan to seed the vocabulary store. */
  vaultIndexed: boolean;
  /** On first onload, silently download the dictionary if missing. */
  autoDownloadDictionary: boolean;
  /**
   * Dashboard percentage denominator excludes status === "new" so the
   * post-vault-index "unclassified" pile does not dominate the cards.
   * Toggled from the dashboard header.
   */
  statsExcludeNew: boolean;
  /** Remembered Flashcards-tab mode. */
  flashcardsMode: "unclassified" | "due" | "smart";
}
