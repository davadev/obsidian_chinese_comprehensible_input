import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExposureTracker } from "../vocabulary/ExposureTracker";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";
import type { VocabularyStore } from "../vocabulary/VocabularyStore";

interface RecordCall {
  surface: string;
  limit: number;
  storeAll: boolean;
  noteKey: string | undefined;
}

function mockStore(): { vocab: VocabularyStore; calls: RecordCall[] } {
  const calls: RecordCall[] = [];
  const vocab = {
    recordExposure(surface: string, limit: number, storeAll: boolean, noteKey?: string) {
      calls.push({ surface, limit, storeAll, noteKey });
    },
  } as unknown as VocabularyStore;
  return { vocab, calls };
}

function settingsFn(overrides: Partial<CciSettings["exposure"]> = {}): () => CciSettings {
  return () => ({
    ...DEFAULT_SETTINGS,
    exposure: { ...DEFAULT_SETTINGS.exposure, ...overrides },
  });
}

describe("ExposureTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not commit when visibility is shorter than minVisibleMs", () => {
    const { vocab, calls } = mockStore();
    const tracker = new ExposureTracker(vocab, settingsFn({ minVisibleMs: 1000 }));
    vi.setSystemTime(new Date(0));
    tracker.onVisible("好", "note.md");
    vi.setSystemTime(new Date(500));
    tracker.onHidden("好", "note.md");
    expect(calls).toEqual([]);
  });

  it("commits when visibility exceeds minVisibleMs", () => {
    const { vocab, calls } = mockStore();
    const tracker = new ExposureTracker(vocab, settingsFn({ minVisibleMs: 1000 }));
    vi.setSystemTime(new Date(0));
    tracker.onVisible("好", "note.md");
    vi.setSystemTime(new Date(2000));
    tracker.onHidden("好", "note.md");
    expect(calls.length).toBe(1);
    expect(calls[0].surface).toBe("好");
    expect(calls[0].noteKey).toBe("note.md");
  });

  it("honours maxOncePerNotePerSession", () => {
    const { vocab, calls } = mockStore();
    const tracker = new ExposureTracker(
      vocab,
      settingsFn({ maxOncePerNotePerSession: true, maxOncePerDay: false })
    );
    tracker.commit("好", "note.md");
    tracker.commit("好", "note.md");
    expect(calls.length).toBe(1);
    // Different note → still allowed.
    tracker.commit("好", "other.md");
    expect(calls.length).toBe(2);
  });

  it("honours maxOncePerDay", () => {
    const { vocab, calls } = mockStore();
    const tracker = new ExposureTracker(
      vocab,
      settingsFn({ maxOncePerNotePerSession: false, maxOncePerDay: true })
    );
    vi.setSystemTime(new Date("2026-06-15T08:00:00Z"));
    tracker.commit("好", "n1.md");
    tracker.commit("好", "n2.md"); // same day, same surface
    expect(calls.length).toBe(1);
  });

  it("resetSession clears the per-note-session dedup", () => {
    const { vocab, calls } = mockStore();
    const tracker = new ExposureTracker(
      vocab,
      settingsFn({ maxOncePerNotePerSession: true, maxOncePerDay: false })
    );
    tracker.commit("好", "note.md");
    tracker.commit("好", "note.md"); // dropped
    expect(calls.length).toBe(1);
    tracker.resetSession();
    tracker.commit("好", "note.md"); // allowed again
    expect(calls.length).toBe(2);
  });

  it("passes undefined noteKey to recordExposure for the special _no_note marker", () => {
    const { vocab, calls } = mockStore();
    const tracker = new ExposureTracker(
      vocab,
      settingsFn({ maxOncePerNotePerSession: false, maxOncePerDay: false })
    );
    tracker.commit("好", "_no_note");
    expect(calls.length).toBe(1);
    expect(calls[0].noteKey).toBeUndefined();
  });
});
