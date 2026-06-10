import { CciSettings } from "../settings/types";
import { VocabularyStore } from "../vocabulary/VocabularyStore";
import { WordRecord } from "../vocabulary/VocabularyTypes";
import { ReviewGrade, ScheduleResult } from "./srsTypes";

/**
 * SM-2-like scheduler. Abstracted as a single class so it can later be swapped
 * for FSRS-lite without touching callers.
 */
export class SrsScheduler {
  constructor(private vocab: VocabularyStore, private settings: () => CciSettings) {}

  /** Words eligible for SRS review based on status filter. */
  eligibleForReview(): WordRecord[] {
    const s = this.settings();
    return this.vocab.values().filter((r) => {
      if (r.status === "ignored") return false;
      if (r.status === "known") return s.srs.scheduleKnownOccasionally;
      return r.status === "unknown" || r.status === "meaningKnownPinyinUnknown" || r.status === "pinyinKnownMeaningUnknown" || r.status === "new";
    });
  }

  /** Currently due words. */
  due(now = new Date()): WordRecord[] {
    return this.eligibleForReview().filter((r) => {
      const due = r.srs?.dueAt;
      if (!due) return true;
      return new Date(due).getTime() <= now.getTime();
    });
  }

  /** Apply a review grade to a word and persist. */
  applyGrade(surface: string, grade: ReviewGrade): ScheduleResult {
    const rec = this.vocab.ensure(surface);
    const prev = rec.srs ?? {
      intervalDays: 0,
      ease: this.settings().srs.initialEase,
      lapses: 0,
    };
    const init = this.settings().srs.initialIntervalDays;
    let interval = prev.intervalDays ?? 0;
    let ease = prev.ease ?? this.settings().srs.initialEase;
    let lapses = prev.lapses ?? 0;

    switch (grade) {
      case "again":
        lapses += 1;
        interval = init;
        ease = Math.max(1.3, ease - 0.2);
        break;
      case "hard":
        interval = Math.max(init, Math.round(interval * 1.2));
        ease = Math.max(1.3, ease - 0.15);
        break;
      case "good":
        interval = interval === 0 ? init : Math.round(interval * ease);
        break;
      case "easy":
        interval = interval === 0 ? init * 2 : Math.round(interval * ease * 1.3);
        ease = Math.min(3.5, ease + 0.15);
        break;
    }
    const now = new Date();
    const dueAt = new Date(now.getTime() + interval * 86400000).toISOString();
    const result: ScheduleResult = {
      dueAt,
      intervalDays: interval,
      ease,
      lapses,
      lastReviewedAt: now.toISOString(),
    };
    this.vocab.updateSrs(surface, result);
    return result;
  }

  /** Soft signal from natural reading exposure. Doesn't promote to passed review. */
  applyExposureSignal(surface: string): void {
    const rec = this.vocab.bySurface(surface);
    if (!rec) return;
    if (rec.status === "ignored" || rec.status === "known") return;
    // Tiny ease nudge if word is repeatedly seen without lookup.
    const ease = (rec.srs?.ease ?? this.settings().srs.initialEase) + 0.01;
    this.vocab.updateSrs(surface, { ease: Math.min(3.5, ease) });
  }

  /** Popup on a due/eligible word counts as a weak/failed recall when enabled. */
  applyPopupSignal(surface: string): void {
    if (!this.settings().srs.popupOnDueIsFailedRecall) return;
    const rec = this.vocab.bySurface(surface);
    if (!rec) return;
    if (rec.status === "ignored" || rec.status === "known") return;
    this.applyGrade(surface, "again");
  }
}
