import { DATA_SCHEMA_VERSION } from "../constants";
import { PersistedVocabData, WordRecord } from "./VocabularyTypes";
import { isOverMnemonicLine } from "./mnemonicText";

/**
 * Migrate persisted vocab data forward to the current schema version.
 * Each migration step must be idempotent and never throw on legal input.
 */
export function migrateVocab(raw: unknown): PersistedVocabData {
  if (!raw || typeof raw !== "object") {
    return { schemaVersion: DATA_SCHEMA_VERSION, words: {} };
  }
  let data = raw as Partial<PersistedVocabData> & { [k: string]: unknown };
  let v = typeof data.schemaVersion === "number" ? data.schemaVersion : 0;

  if (v < 1) {
    data = {
      schemaVersion: 1,
      words: (data.words as Record<string, WordRecord>) ?? {},
    };
    v = 1;
  }

  if (v < 3) {
    splitLongMnemonics(data.words as Record<string, WordRecord> | undefined);
    data.schemaVersion = 3;
    v = 3;
  }

  return data as PersistedVocabData;
}

/**
 * v3: `mnemonic.text` became the short "emoji line" and `mnemonic.story`
 * the prose that unpacks it. Before v3 the single `text` field held
 * whatever the user (or the AI) wrote, often several sentences.
 *
 * Nothing is ever deleted here: a `text` too long to be a line is MOVED
 * into `story`, and only when `story` is empty — a record that already
 * has a story keeps both fields verbatim (the card clamps the display
 * instead). `mnemonic.updatedAt` is intentionally left alone: this is a
 * reshape, not a user edit, so two-device conflict resolution
 * (`pickByInnerUpdatedAt` in syncMerge) keeps behaving as before.
 *
 * Idempotent, and safe to run on payloads arriving from a device that
 * hasn't updated yet — `migrateVocab` is called on load, on mirror
 * absorb, and on import.
 */
function splitLongMnemonics(words: Record<string, WordRecord> | undefined): void {
  if (!words || typeof words !== "object") return;
  for (const rec of Object.values(words)) {
    const m = rec?.mnemonic;
    if (!m) continue;
    const text = typeof m.text === "string" ? m.text : "";
    const story = typeof m.story === "string" ? m.story : "";
    if (!text || story || !isOverMnemonicLine(text)) continue;
    m.story = text;
    m.text = "";
  }
}
