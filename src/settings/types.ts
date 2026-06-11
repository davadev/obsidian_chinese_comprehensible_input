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
