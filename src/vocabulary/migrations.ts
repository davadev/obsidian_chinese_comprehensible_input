import { DATA_SCHEMA_VERSION } from "../constants";
import { PersistedVocabData } from "./VocabularyTypes";

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
      words: (data.words as Record<string, any>) ?? {},
    };
    v = 1;
  }

  return data as PersistedVocabData;
}
