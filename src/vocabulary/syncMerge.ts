import { DATA_SCHEMA_VERSION } from "../constants";
import { axesFromStatus } from "./axes";
import { PersistedVocabData, WordRecord, WordStatus } from "./VocabularyTypes";

/**
 * Idempotent per-record merge used by the vault-side vocabulary mirror.
 *
 * Distinct from `mergeRecords` in VocabularyStore (which SUMS counts and is
 * appropriate for `importJson` treating the incoming file as a separate
 * corpus). `mergeForSync` is for the two-device sync case where the same
 * remote snapshot may land more than once — every operation must be
 * idempotent (max / set-union / earliest / latest), never additive.
 */

const STATUS_RANK: Record<WordStatus, number> = {
  new: 0,
  unknown: 1,
  meaningKnownPinyinUnknown: 2,
  pinyinKnownMeaningUnknown: 2,
  charactersUnknown: 2,
  known: 3,
  ignored: 4,
};

/**
 * Resolve a status conflict between two record snapshots.
 *
 * Order:
 *   1. "new" always loses to any classified status (hardcoded).
 *   2. User-supplied `priority` list — earlier = wins.
 *   3. Timestamp tiebreaker — later `updatedAt` wins.
 *   4. Last resort: built-in rank.
 */
export function resolveStatus(
  a: WordRecord,
  b: WordRecord,
  priority: WordStatus[]
): WordRecord {
  if (a.status === b.status) {
    return a.updatedAt >= b.updatedAt ? a : b;
  }
  // Rule 1: classifying a word is always intentional, reverting to "new" is not.
  if (a.status === "new") return b;
  if (b.status === "new") return a;

  // Rule 2: configured priority list.
  const idxA = priority.indexOf(a.status);
  const idxB = priority.indexOf(b.status);
  if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
    return idxA < idxB ? a : b;
  }

  // Rule 3: timestamp.
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }

  // Rule 4: fallback rank — matches legacy `pickWinningStatus`.
  return STATUS_RANK[a.status] >= STATUS_RANK[b.status] ? a : b;
}

function maxCounts(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  if (b) {
    for (const [k, v] of Object.entries(b)) {
      out[k] = Math.max(out[k] ?? 0, v);
    }
  }
  return out;
}

function unionSortedDedupe(a: string[], b: string[], cap?: number): string[] {
  const set = new Set<string>([...a, ...b]);
  const arr = Array.from(set).sort();
  if (cap && arr.length > cap) return arr.slice(arr.length - cap);
  return arr;
}

function pickEarlier(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function pickLater(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function pickByInnerUpdatedAt<T extends { updatedAt?: string }>(
  a: T | undefined,
  b: T | undefined
): T | undefined {
  if (!a) return b;
  if (!b) return a;
  const ua = a.updatedAt ?? "";
  const ub = b.updatedAt ?? "";
  return ua >= ub ? a : b;
}

export interface SyncMergeOptions {
  /** User-ordered status priority list. */
  statusPriority: WordStatus[];
  /** Cap on `recentSeenAt` length; mirrors VocabularyStore's retention setting. */
  recentSeenAtCap?: number;
}

export function mergeForSync(
  a: WordRecord,
  b: WordRecord,
  opts: SyncMergeOptions
): WordRecord {
  const statusWinner = resolveStatus(a, b, opts.statusPriority);
  const status = statusWinner.status;
  const axes = axesFromStatus(status) ?? statusWinner.axes;

  const dailySeenCounts = maxCounts(a.dailySeenCounts, b.dailySeenCounts);
  const seenCount = Object.values(dailySeenCounts).reduce((s, n) => s + n, 0);
  const notesSeenCounts =
    a.notesSeenCounts || b.notesSeenCounts
      ? maxCounts(a.notesSeenCounts, b.notesSeenCounts)
      : undefined;

  const recentSeenAt = unionSortedDedupe(
    a.recentSeenAt ?? [],
    b.recentSeenAt ?? [],
    opts.recentSeenAtCap
  );

  const surfaces = Array.from(
    new Set([...(a.surfaces ?? []), ...(b.surfaces ?? [])])
  );

  const updatedAt = pickLater(a.updatedAt, b.updatedAt) ?? a.updatedAt;
  const firstSeenAt = pickEarlier(a.firstSeenAt, b.firstSeenAt);
  const knownAt = pickEarlier(a.knownAt, b.knownAt);
  const classifiedAt = pickEarlier(a.classifiedAt, b.classifiedAt);
  const lastSeenAt = pickLater(a.lastSeenAt, b.lastSeenAt);

  const srs = pickSrsByReview(a.srs, b.srs);
  const mnemonic = pickByInnerUpdatedAt(a.mnemonic, b.mnemonic);

  // Reason from the most recent ignore. If neither side is ignored, drop it.
  let ignoredReason: string | undefined;
  if (status === "ignored") {
    if (statusWinner.ignoredReason) ignoredReason = statusWinner.ignoredReason;
    else ignoredReason = a.ignoredReason ?? b.ignoredReason;
  }

  return {
    key: a.key,
    surfaces,
    simplified: a.simplified ?? b.simplified,
    traditional: a.traditional ?? b.traditional,
    pinyin: a.pinyin ?? b.pinyin,
    definitions: a.definitions ?? b.definitions,
    hsk: a.hsk ?? b.hsk,
    status,
    axes,
    firstSeenAt,
    lastSeenAt,
    knownAt,
    classifiedAt,
    seenCount,
    recentSeenAt,
    dailySeenCounts,
    notesSeenCounts,
    mnemonic,
    srs,
    notes: a.notes ?? b.notes,
    ignoredReason,
    updatedAt,
  };
}

function pickSrsByReview(
  a: WordRecord["srs"],
  b: WordRecord["srs"]
): WordRecord["srs"] {
  if (!a) return b;
  if (!b) return a;
  const ra = a.lastReviewedAt ?? "";
  const rb = b.lastReviewedAt ?? "";
  return ra >= rb ? a : b;
}

/**
 * Whole-store merge. Words present on only one side are kept as-is; words
 * on both sides are merged via `mergeForSync`.
 */
export function mergeStoresForSync(
  local: PersistedVocabData,
  remote: PersistedVocabData,
  opts: SyncMergeOptions
): PersistedVocabData {
  const out: Record<string, WordRecord> = { ...local.words };
  for (const [k, rRemote] of Object.entries(remote.words)) {
    const rLocal = out[k];
    out[k] = rLocal ? mergeForSync(rLocal, rRemote, opts) : rRemote;
  }
  return {
    schemaVersion: Math.max(
      local.schemaVersion ?? DATA_SCHEMA_VERSION,
      remote.schemaVersion ?? DATA_SCHEMA_VERSION
    ),
    words: out,
  };
}
