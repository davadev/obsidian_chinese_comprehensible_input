import type { PersistedVocabData, WordRecord } from "./VocabularyTypes";

/**
 * What goes into the vault mirror, as opposed to what a device keeps for itself.
 *
 * The mirror is a TRANSPORT between devices, not a backup, and it used to carry the whole store. On a real vault that was
 * 41 MB (11,029 words): 54% per-note exposure counters (`notesSeenCounts`, 206,000 entries), 15% exposure timestamps
 * (`recentSeenAt`, 209,000 entries), and 9,820 records that are just "new" (untracked words a vault scan created, with
 * nothing a person decided about them). A file that size is hard on a phone, on WebDAV and on a sync tool, and it
 * stopped syncing.
 *
 * So the mirror carries what is worth moving between devices: every word somebody has classified or written something
 * about, with its status, axes, mnemonic, SRS state, notes and per-day counts. Left out, because every device keeps its
 * own and rebuilds them from its own reading: the untouched "new" records, the per-note counters, and all but the newest
 * few exposure timestamps. Merging is unaffected: the merge treats an absent field as empty and never lets it erase a
 * local value, and `recentSeenAt` stays an array so an older version reading the file is not surprised.
 */
export const MIRROR_RECENT_SEEN_KEEP = 5;

/** A record somebody did something with, as opposed to one a scan or a page view created. */
export function isMirrorWorthy(rec: WordRecord): boolean {
  if (rec.status !== "new") return true;
  return !!(rec.mnemonic || rec.srs || rec.notes || rec.ignoredReason);
}

export function slimRecordForMirror(rec: WordRecord): WordRecord {
  const { notesSeenCounts: _dropped, ...rest } = rec;
  void _dropped;
  return { ...rest, recentSeenAt: rec.recentSeenAt.slice(-MIRROR_RECENT_SEEN_KEEP) };
}

/** A new object; `data` itself is never touched. */
export function slimVocabForMirror(data: PersistedVocabData): PersistedVocabData {
  const words: Record<string, WordRecord> = {};
  for (const [key, rec] of Object.entries(data.words)) {
    if (isMirrorWorthy(rec)) words[key] = slimRecordForMirror(rec);
  }
  return { ...data, words };
}
