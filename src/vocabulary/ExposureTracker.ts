import { CciSettings } from "../settings/types";
import { VocabularyStore } from "./VocabularyStore";

/**
 * Dedup rules for counting a word as "seen".
 *
 * An exposure is recorded when the user OPENS A WORD POPUP (gated on
 * `exposure.popupCountsAsExposure`). Generated stories also record exposures,
 * but they call `VocabularyStore.recordExposure` directly and so bypass the
 * dedup below; the vault indexer has its own idempotent path
 * (`recordNoteScan`). Simply reading a note records nothing.
 *
 * Rules applied here:
 *  - Not counted twice in the same session per note (if enabled).
 *  - Not counted twice in the same day (if enabled).
 *
 * This class used to advertise viewport-duration tracking — `onVisible` /
 * `onHidden` and a `minVisibleMs` setting — but nothing ever called them, in
 * any released version. The unit tests passed because they called the methods
 * directly, so the gap survived for as long as the feature did. Removed in
 * 0.7.8 (#126) rather than left as a promise the plugin does not keep; see
 * docs/exposure.md. Doing it properly is tracked separately, and has to answer
 * for the write amplification and the indexer's per-note high-water mark first.
 */
export class ExposureTracker {
  private sessionSeen = new Set<string>(); // `${noteKey}|${surface}`
  private daySeen = new Set<string>(); // `${YYYY-MM-DD}|${surface}`

  constructor(private vocab: VocabularyStore, private settings: () => CciSettings) {}

  /** Record an exposure, subject to the dedup settings. */
  commit(surface: string, noteKey: string): void {
    const s = this.settings();
    if (s.exposure.maxOncePerNotePerSession) {
      const id = `${noteKey}|${surface}`;
      if (this.sessionSeen.has(id)) return;
      this.sessionSeen.add(id);
    }
    if (s.exposure.maxOncePerDay) {
      const day = new Date().toISOString().slice(0, 10);
      const id = `${day}|${surface}`;
      if (this.daySeen.has(id)) return;
      this.daySeen.add(id);
    }
    this.vocab.recordExposure(
      surface,
      s.exactTimestampRetentionLimit,
      s.storeAllExactTimestamps,
      noteKey === "_no_note" ? undefined : noteKey
    );
  }

  resetSession(): void {
    this.sessionSeen.clear();
  }
}
