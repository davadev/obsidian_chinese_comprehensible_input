/**
 * Pure rules for the automatic backup of plugin data (#149): which version is newer, what to do at start-up, which
 * backup to offer after a downgrade, which backups to keep. No I/O, so every branch is a table test.
 *
 * WHY THIS EXISTS. Going back to an older release through BRAT does not undo what the newer one did to `data.json`,
 * and an older version reading data written by a newer one can misread it (migrations only go forward). So each
 * version change snapshots the data first, and a downgrade is noticed and offered a way back.
 */

export type BackupKind = "version-change" | "manual" | "pre-restore" | "downgrade-safety";

/** One backup, as recorded in `backups/index.json`. */
export interface BackupEntry {
  id: string;
  /** ISO timestamp the backup was taken. */
  createdAt: string;
  /** The version that WROTE the data in this backup (not the version that took it). */
  fromVersion: string;
  kind: BackupKind;
  /** File name inside the backups folder. */
  file: string;
  encoding: "gzip" | "none";
  /** Size of the bundle text before compression, in bytes. */
  rawBytes: number;
  storedBytes: number;
  /** SHA-256 of the bundle text, hex. */
  sha256: string;
  /** Which files the bundle holds. */
  includes: Array<"data" | "vocabMirror" | "settingsMirror">;
}

// ---- versions ----------------------------------------------------------------------------------------------------

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease identifiers, e.g. ["beta", 10]; empty for a stable release. */
  pre: Array<string | number>;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Semver parse. `null` for anything that is not a version (including the "unknown" label). */
export function parseVersion(v: string | undefined | null): ParsedVersion | null {
  if (typeof v !== "string") return null;
  const m = VERSION_RE.exec(v.trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

/** True for a release without a prerelease suffix. Unparseable counts as not stable. */
export function isStableVersion(v: string | undefined | null): boolean {
  const p = parseVersion(v);
  return p !== null && p.pre.length === 0;
}

function cmpIdentifier(a: string | number, b: string | number): number {
  const an = typeof a === "number";
  const bn = typeof b === "number";
  if (an && bn) return a < b ? -1 : a > b ? 1 : 0;
  if (an) return -1; // numeric identifiers have lower precedence than alphanumeric ones
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver precedence, prereleases included: `0.8.0-beta.10 > 0.8.0-beta.9` (a string sort gets this wrong) and
 * `0.8.0-beta.2 < 0.8.0`. Anything unparseable orders below every real version, and two unparseable values are equal:
 * an unknown origin is treated as "older than anything we know".
 */
export function compareVersions(a: string | undefined | null, b: string | undefined | null): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const k of ["major", "minor", "patch"] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1; // a stable release outranks its own prereleases
  if (pb.pre.length === 0) return -1;
  const n = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const c = cmpIdentifier(pa.pre[i], pb.pre[i]);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  if (pa.pre.length === pb.pre.length) return 0;
  return pa.pre.length < pb.pre.length ? -1 : 1;
}

// ---- start-up decision -------------------------------------------------------------------------------------------

export type StartupAction = "first-run" | "same" | "upgrade" | "downgrade";

/**
 * What kind of start this is, from the version recorded at the previous start and the one running now.
 *
 * `first-run` covers "no record yet", which includes the first start after updating from a release that predates this
 * feature. Two versions that are not both parseable can only be compared for equality; a difference is treated as an
 * upgrade (the safe direction: it backs up).
 */
export function decideStartup(args: { lastRun: string | undefined | null; running: string }): StartupAction {
  const { lastRun, running } = args;
  if (lastRun === undefined || lastRun === null || lastRun === "") return "first-run";
  if (lastRun === running) return "same";
  if (!parseVersion(lastRun) || !parseVersion(running)) return "upgrade";
  const c = compareVersions(running, lastRun);
  return c === 0 ? "same" : c > 0 ? "upgrade" : "downgrade";
}

// ---- choosing and keeping backups --------------------------------------------------------------------------------

const newestFirst = (a: BackupEntry, b: BackupEntry): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/**
 * The backup to offer when the plugin has gone back to `running`: the newest one whose data was written by `running`
 * or an older version. Example: stable S, then betas b1, b2, b3 (each version change snapshots the data as the
 * previous version left it, so the backups are labelled S, b1, b2). Back on S only the S backup qualifies: exactly
 * the data S left. Back on b1, S and b1 qualify and the newer, b1, wins. A backup of unknown origin counts as oldest.
 */
export function selectRestoreCandidate(entries: readonly BackupEntry[], running: string): BackupEntry | null {
  const eligible = entries.filter((e) => compareVersions(e.fromVersion, running) <= 0);
  if (eligible.length === 0) return null;
  return [...eligible].sort(newestFirst)[0];
}

/**
 * Which backups survive. The newest `keep` by time, PLUS always the newest one whose data was written by a stable
 * release: ten betas in a day with `keep = 5` would otherwise push out the one snapshot that makes the way back to
 * the stable release possible. Both lists are newest first.
 */
export function applyRetention(
  entries: readonly BackupEntry[],
  keep: number
): { keep: BackupEntry[]; drop: BackupEntry[] } {
  const n = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 1;
  const sorted = [...entries].sort(newestFirst);
  const pinned = sorted.find((e) => isStableVersion(e.fromVersion));
  const kept = sorted.filter((e, i) => i < n || e === pinned);
  const dropped = sorted.filter((e) => !kept.includes(e));
  return { keep: kept, drop: dropped };
}

/**
 * Identical data to the newest backup means that backup already covers this moment: do not write a second copy.
 * (Only the newest is compared, so an A, B, A sequence still records the second A.)
 */
export function shouldSkipSnapshot(sha256: string, entries: readonly BackupEntry[]): boolean {
  if (entries.length === 0) return false;
  return [...entries].sort(newestFirst)[0].sha256 === sha256;
}

// ---- names -------------------------------------------------------------------------------------------------------

const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "_");

/** `20261010T101500Z`, sortable and free of characters some file systems reject. */
export function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
}

export function backupId(createdAt: string, kind: BackupKind, fromVersion: string): string {
  return `${compactTimestamp(createdAt)}-${kind}-from-${safe(fromVersion)}`;
}

export function backupFileName(id: string, encoding: "gzip" | "none"): string {
  return `${id}${encoding === "gzip" ? ".json.gz" : ".json"}`;
}
