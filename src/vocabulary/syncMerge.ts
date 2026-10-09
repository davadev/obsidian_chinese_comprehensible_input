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
 *
 * It must also be COMMUTATIVE: `mergeForSync(a, b)` and `mergeForSync(b, a)` produce the same bytes. Each device
 * calls it with its own record as `a`, so any rule of the form `a.x ?? b.x`, `a >= b ? a : b` or "a's items then
 * b's" makes the two devices compute different winners and the mirror never converges (#135). Every choice below is
 * therefore made on data both sides share (a timestamp, then a canonical serialisation as the last resort), never on
 * which side happens to be local.
 */

/** JSON with object keys sorted, so equal values serialise identically whatever order they were built in. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    }
    return val;
  });
}

/** Last-resort tie-break: the value with the smaller canonical form. Equal forms are interchangeable. */
function pickCanon<T>(a: T, b: T): T {
  return canon(a) <= canon(b) ? a : b;
}

/**
 * Pick one record's value for a field that has no timestamp of its own: the side holding a value wins over one
 * that does not; otherwise the side with the later record-level `updatedAt`; on a tie, the smaller canonical form.
 */
function pickFieldByRecord<T>(a: WordRecord, b: WordRecord, get: (r: WordRecord) => T | undefined): T | undefined {
  const va = get(a);
  const vb = get(b);
  if (va === undefined) return vb;
  if (vb === undefined) return va;
  const ua = a.updatedAt ?? "";
  const ub = b.updatedAt ?? "";
  if (ua !== ub) return ua > ub ? va : vb;
  return pickCanon(va, vb);
}

function sortedKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/**
 * Merge two `surfaces` lists. `surfaces[0]` is the first form this word was ever seen in and callers rely on that
 * (displaySurface(), the mnemonic storage key), so it is kept: it comes from the side that saw the word first, and
 * only the remainder is sorted.
 */
function mergeSurfaces(a: WordRecord, b: WordRecord): string[] {
  const sa = a.surfaces ?? [];
  const sb = b.surfaces ?? [];
  const all = new Set<string>([...sa, ...sb]);
  const fa = sa[0];
  const fb = sb[0];
  let first: string | undefined;
  if (fa === undefined) first = fb;
  else if (fb === undefined) first = fa;
  else if (a.firstSeenAt && b.firstSeenAt && a.firstSeenAt !== b.firstSeenAt) first = a.firstSeenAt < b.firstSeenAt ? fa : fb;
  else if (a.firstSeenAt && !b.firstSeenAt) first = fa;
  else if (!a.firstSeenAt && b.firstSeenAt) first = fb;
  else first = fa <= fb ? fa : fb;
  const rest = Array.from(all).filter((x) => x !== first).sort();
  return first === undefined ? rest : [first, ...rest];
}

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
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    return pickCanon(a, b);
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

  // Rule 4: fallback rank — matches legacy `pickWinningStatus`. Three statuses share a rank, so an equal rank is
  // settled by the canonical form rather than by argument order.
  if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] > STATUS_RANK[b.status] ? a : b;
  return pickCanon(a, b);
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
  if (ua !== ub) return ua > ub ? a : b;
  return pickCanon(a, b);
}

/** Smaller of two optional strings; an absent side never wins. */
function pickMinDefined(a?: string, b?: string): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a <= b ? a : b;
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
  // Prefer the winner's STORED axes; derive from the status only when the record
  // predates the axes field.
  //
  // The other way round loses data. `statusFromAxes` is not injective — it maps
  // eight axis combinations onto five statuses — so re-deriving axes from the
  // coarse status silently rewrites the three combinations that collapse:
  //
  //   chars only            -> "unknown"                  -> all three false
  //   pinyin only           -> "pinyinKnownMeaningUnknown" -> chars flipped ON
  //   meaning only          -> "meaningKnownPinyinUnknown" -> chars flipped ON
  //
  // `resolveStatus` returns a whole record, so `statusWinner.axes` is that same
  // record's axes and stays consistent with the status chosen above.
  //
  // This fired on EVERY key present on both sides, including records that were
  // byte-identical, so a reader who ticked only "Characters" in the word popup
  // watched that box untick itself on the next sync — and the corrupted value
  // then propagated to their other device.
  const axes = statusWinner.axes ?? axesFromStatus(status);

  const dailySeenCounts = sortedKeys(maxCounts(a.dailySeenCounts, b.dailySeenCounts));
  const seenCount = Object.values(dailySeenCounts).reduce((s, n) => s + n, 0);
  const notesSeenCounts =
    a.notesSeenCounts || b.notesSeenCounts
      ? sortedKeys(maxCounts(a.notesSeenCounts, b.notesSeenCounts))
      : undefined;

  const recentSeenAt = unionSortedDedupe(
    a.recentSeenAt ?? [],
    b.recentSeenAt ?? [],
    opts.recentSeenAtCap
  );

  const surfaces = mergeSurfaces(a, b);

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
    else ignoredReason = pickMinDefined(a.ignoredReason, b.ignoredReason);
  }

  return {
    key: a.key,
    surfaces,
    simplified: pickFieldByRecord(a, b, (r) => r.simplified),
    traditional: pickFieldByRecord(a, b, (r) => r.traditional),
    pinyin: pickFieldByRecord(a, b, (r) => r.pinyin),
    definitions: pickFieldByRecord(a, b, (r) => r.definitions),
    hsk: pickFieldByRecord(a, b, (r) => r.hsk),
    status,
    axes,
    firstSeenAt,
    // If either device says this record came from a vault scan, it did — the
    // fact is about how the record was born, not about which side is newer.
    // Both merge functions build an explicit literal, so a field missing from
    // one of them is silently dropped on every sync.
    backfilledAt: pickEarlier(a.backfilledAt, b.backfilledAt),
    lastSeenAt,
    knownAt,
    classifiedAt,
    seenCount,
    recentSeenAt,
    dailySeenCounts,
    notesSeenCounts,
    mnemonic,
    srs,
    notes: pickFieldByRecord(a, b, (r) => r.notes),
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
  if (ra !== rb) return ra > rb ? a : b;
  return pickCanon(a, b);
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
