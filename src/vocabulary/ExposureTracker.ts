import { CciSettings } from "../settings/types";
import { VocabularyStore } from "./VocabularyStore";

interface PendingExposure {
  firstSeenMs: number;
  noteKey: string;
}

/**
 * Decides whether a word visible in the viewport should be counted as "seen".
 *
 * Rules:
 *  - Must be visible at least `minVisibleMs` (settings).
 *  - Not counted twice in the same session per note (if enabled).
 *  - Not counted twice in the same day (if enabled).
 *  - Excluded-zone filtering happens upstream in the decoration plugin; the
 *    tracker only sees surfaces it was told to track.
 */
export class ExposureTracker {
  private pending = new Map<string, PendingExposure>();
  private sessionSeen = new Set<string>(); // `${noteKey}|${surface}`
  private daySeen = new Set<string>(); // `${YYYY-MM-DD}|${surface}`

  constructor(private vocab: VocabularyStore, private settings: () => CciSettings) {}

  /** Called when a surface becomes visible. */
  onVisible(surface: string, noteKey: string): void {
    const id = `${noteKey}|${surface}`;
    if (this.pending.has(id)) return;
    this.pending.set(id, { firstSeenMs: Date.now(), noteKey });
  }

  /** Called when a surface leaves the viewport (or note closes). */
  onHidden(surface: string, noteKey: string): void {
    const id = `${noteKey}|${surface}`;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    const dur = Date.now() - p.firstSeenMs;
    if (dur < this.settings().exposure.minVisibleMs) return;
    this.commit(surface, noteKey);
  }

  /** Force-commit (e.g. popup opened, generated story rendered). */
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
      s.storeAllExactTimestamps
    );
  }

  resetSession(): void {
    this.sessionSeen.clear();
    this.pending.clear();
  }
}
