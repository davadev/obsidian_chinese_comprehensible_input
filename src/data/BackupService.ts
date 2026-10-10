import {
  BackupEntry,
  BackupKind,
  StartupAction,
  applyRetention,
  backupFileName,
  backupId,
  decideStartup,
  selectRestoreCandidate,
  shouldSkipSnapshot,
} from "./backupPolicy";

/**
 * Automatic backup of the plugin's data on a version change, and the way back after a downgrade (#149).
 *
 * The rules (which backup to offer, which to keep) are in backupPolicy.ts. This is the I/O around them, behind small
 * interfaces so every failure path can be driven in a test.
 *
 * TWO PROPERTIES THE REST OF THE PLUGIN RELIES ON
 *
 *  1. It FAILS OPEN. Nothing here can throw into `onload()`: a full disk, an unreadable file, a corrupt index or a
 *     device without gzip all end as a visible Notice and a normal start. Backups are a safety net, never a gate.
 *  2. Restoring is STAGED. `stageRestore()` only writes a marker; `applyPendingRestore()` runs at the NEXT start,
 *     before any data has been loaded. Restoring inside a running plugin is not safe: `data.json` is mirrored into
 *     settings, the vocabulary store, the dictionary overrides and open views, there is no reload path, and
 *     `onunload()` flushes the old in-memory vocabulary back over the file.
 *
 * WHAT IS IN A BACKUP: the raw text of `data.json` exactly as the previous version left it (not a re-serialisation:
 * `vocab.load` mutates the parsed blob in place) plus, when they exist, this device's vault mirror files. The
 * dictionary file is not included (it is re-downloadable).
 */

export const BACKUP_DIR_NAME = "backups";
export const BACKUP_INDEX_FILE = "index.json";
export const PENDING_RESTORE_FILE = "pending-restore.json";
const NOTICE_MS = 15_000;

/** The slice of Obsidian's DataAdapter this module needs. */
export interface BackupAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface BackupCodec {
  /** gzip bytes, or `null` when this runtime cannot compress (the backup is then stored as plain JSON). */
  compress(text: string): Promise<Uint8Array | null>;
  decompress(bytes: Uint8Array): Promise<string>;
}

/** Settings and paths that are only known once `data.json` has been read, so they are asked for at the moment of use. */
export interface BackupContext {
  enabled: boolean;
  keep: number;
  vocabMirrorPath?: string | null;
  settingsMirrorPath?: string | null;
}

export interface BackupDeps {
  adapter: BackupAdapter;
  codec: BackupCodec;
  sha256(text: string): Promise<string>;
  now(): Date;
  notify(message: string, durationMs?: number): void;
  /** `<plugin folder>/backups` */
  dir: string;
  /** `<plugin folder>/data.json` */
  dataPath: string;
  /** `manifest.version` of the build that is running now. */
  version: string;
  context(): BackupContext;
}

interface BackupIndex {
  schemaVersion: 1;
  lastRunVersion?: string;
  backups: BackupEntry[];
}

interface BackupBundle {
  v: 1;
  files: {
    data: string;
    vocabMirror?: { path: string; text: string };
    settingsMirror?: { path: string; text: string };
  };
}

export interface StartupResult {
  action: StartupAction;
  /** The snapshot taken at this start, if any. */
  backedUp: BackupEntry | null;
  skipped?: "disabled" | "unchanged" | "no-data";
  /** Set when taking the snapshot failed; the version is then NOT recorded, so the next start tries again. */
  failed?: string;
  /** Set only on a downgrade the user has not yet answered. */
  downgrade?: { from: string; to: string; candidate: BackupEntry | null };
}

export interface SnapshotResult {
  entry: BackupEntry | null;
  skipped?: "unchanged" | "no-data";
  failed?: string;
}

export interface StageResult {
  ok: boolean;
  message: string;
}

export interface RestoreResult {
  status: "none" | "applied" | "failed";
  entry?: BackupEntry;
  message?: string;
  /** Mirror files that could not be written, or whose folder is gone and were left alone. */
  mirrorsSkipped?: string[];
}

// ---- runtime helpers ---------------------------------------------------------------------------------------------

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** gzip through the platform streams, the same ones the dictionary downloader already depends on for decompression. */
export function createGzipCodec(): BackupCodec {
  return {
    async compress(text) {
      if (typeof CompressionStream !== "function") return null;
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
    async decompress(bytes) {
      if (typeof DecompressionStream !== "function") {
        throw new Error("this device cannot read compressed backups");
      }
      const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    },
  };
}

/** Never empty: a corrupt gzip stream throws an Error with no message, and a notice reading "()" helps nobody. */
const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m || (e instanceof Error && e.name ? e.name : "unknown error");
};
const toArrayBuffer = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

// ---- index file --------------------------------------------------------------------------------------------------

const KINDS: readonly BackupKind[] = ["version-change", "manual", "pre-restore", "downgrade-safety"];

function coerceEntry(raw: unknown): BackupEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | null => {
    const v = o[k];
    return typeof v === "string" && v !== "" ? v : null;
  };
  const num = (k: string): number | null => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const id = str("id"), createdAt = str("createdAt"), fromVersion = str("fromVersion"), file = str("file"), sha256 = str("sha256");
  const rawBytes = num("rawBytes"), storedBytes = num("storedBytes");
  if (!id || !createdAt || !fromVersion || !file || !sha256 || rawBytes === null || storedBytes === null) return null;
  if (!KINDS.includes(o.kind as BackupKind)) return null;
  if (o.encoding !== "gzip" && o.encoding !== "none") return null;
  // A file name must stay inside the backups folder.
  if (file.includes("/") || file.includes("\\") || file.includes("..")) return null;
  const includes = Array.isArray(o.includes)
    ? (o.includes.filter((x) => x === "data" || x === "vocabMirror" || x === "settingsMirror") as BackupEntry["includes"])
    : [];
  return { id, createdAt, fromVersion, kind: o.kind as BackupKind, file, encoding: o.encoding, rawBytes, storedBytes, sha256, includes };
}

function coerceIndex(raw: unknown): BackupIndex {
  const empty: BackupIndex = { schemaVersion: 1, backups: [] };
  if (!raw || typeof raw !== "object") return empty;
  const o = raw as Record<string, unknown>;
  const backups = Array.isArray(o.backups) ? o.backups.map(coerceEntry).filter((e): e is BackupEntry => e !== null) : [];
  const lastRunVersion = typeof o.lastRunVersion === "string" && o.lastRunVersion !== "" ? o.lastRunVersion : undefined;
  return { schemaVersion: 1, lastRunVersion, backups };
}

// ---- service -----------------------------------------------------------------------------------------------------

export class BackupService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private d: BackupDeps) {}

  private get indexPath(): string {
    return `${this.d.dir}/${BACKUP_INDEX_FILE}`;
  }
  private get markerPath(): string {
    return `${this.d.dir}/${PENDING_RESTORE_FILE}`;
  }

  /** Operations never overlap: a manual backup during start-up would otherwise race on the index. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private warn(message: string): void {
    try {
      this.d.notify(`Chinese plugin: ${message}`, NOTICE_MS);
    } catch {
      /* even a failing notice must not escape */
    }
  }

  // -- public API: each method catches everything and reports --------------------------------------------------------

  /**
   * Called once per start, after the first read of `data.json` and before anything writes to it.
   * Snapshots on an upgrade (or first run), notices a downgrade, and records the version only once the snapshot is safe.
   */
  startup(): Promise<StartupResult> {
    return this.run(async () => {
      let action: StartupAction = "same";
      try {
        const ctx = this.d.context();
        const idx = await this.readIndex();
        action = decideStartup({ lastRun: idx.lastRunVersion, running: this.d.version });

        if (!ctx.enabled) {
          if (action !== "same") await this.recordVersion(idx);
          return { action, backedUp: null, skipped: "disabled" as const };
        }
        if (action === "same") return { action, backedUp: null };

        if (action === "downgrade") {
          const from = idx.lastRunVersion as string;
          // A safety copy of what the newer version left, taken before the older code can touch it, so the restore
          // itself can be undone. One per newer version: a user who keeps answering "decide later" must not slowly push
          // useful backups out of the retention window.
          if (!idx.backups.some((e) => e.kind === "downgrade-safety" && e.fromVersion === from)) {
            try {
              const r = await this.takeSnapshot("downgrade-safety", from, ctx, idx);
              if (r.entry) await this.writeIndex(idx);
            } catch (e) {
              this.warn(`could not save a safety copy of your data before the downgrade (${errMsg(e)}). Your data is unchanged.`);
            }
          }
          const candidate = selectRestoreCandidate(idx.backups, this.d.version);
          return { action, backedUp: null, downgrade: { from, to: this.d.version, candidate } };
        }

        // first-run or upgrade
        const from = idx.lastRunVersion ?? "unknown";
        let r: SnapshotResult;
        try {
          r = await this.takeSnapshot("version-change", from, ctx, idx);
        } catch (e) {
          const failed = errMsg(e);
          this.warn(`could not back up your data before this update (${failed}). Your data is untouched; it will try again next start.`);
          return { action, backedUp: null, failed };
        }
        const dropped = r.entry ? this.retain(idx, ctx.keep) : [];
        idx.lastRunVersion = this.d.version;
        await this.writeIndex(idx);
        await this.deleteFiles(dropped);
        return { action, backedUp: r.entry, ...(r.skipped ? { skipped: r.skipped } : {}) };
      } catch (e) {
        this.warn(`backup check failed (${errMsg(e)}). The plugin carries on without it.`);
        return { action, backedUp: null, failed: errMsg(e) };
      }
    });
  }

  /** "Back up now". Works whether or not automatic backups are on. */
  snapshot(): Promise<SnapshotResult> {
    return this.run(async () => {
      try {
        const ctx = this.d.context();
        const idx = await this.readIndex();
        const r = await this.takeSnapshot("manual", this.d.version, ctx, idx);
        if (r.entry) {
          const dropped = this.retain(idx, ctx.keep);
          await this.writeIndex(idx);
          await this.deleteFiles(dropped);
        }
        return r;
      } catch (e) {
        this.warn(`backup failed (${errMsg(e)}). Your data is untouched.`);
        return { entry: null, failed: errMsg(e) };
      }
    });
  }

  /** Newest first. Empty if the index is missing or unreadable. */
  list(): Promise<BackupEntry[]> {
    return this.run(async () => {
      try {
        const idx = await this.readIndex();
        return [...idx.backups].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      } catch {
        return [];
      }
    });
  }

  /** Queue a restore for the next start. Does not touch any data. */
  stageRestore(id: string): Promise<StageResult> {
    return this.run(async () => {
      try {
        const idx = await this.readIndex();
        const entry = idx.backups.find((e) => e.id === id);
        if (!entry) return { ok: false, message: "That backup is no longer in the list." };
        if (!(await this.d.adapter.exists(`${this.d.dir}/${entry.file}`))) {
          return { ok: false, message: "The backup file is missing, so it cannot be restored." };
        }
        await this.ensureDir();
        await this.put(this.markerPath, (p) => this.d.adapter.write(p, JSON.stringify({ id, stagedAt: this.d.now().toISOString() })));
        return { ok: true, message: "Restore queued. Restart Obsidian (or turn the plugin off and on) to finish." };
      } catch (e) {
        const message = `Could not queue the restore (${errMsg(e)}). Nothing was changed.`;
        this.warn(message);
        return { ok: false, message };
      }
    });
  }

  /** Withdraw a queued restore ("Decide later" after having queued one, or a change of mind). */
  cancelRestore(): Promise<void> {
    return this.run(async () => {
      try {
        if (await this.d.adapter.exists(this.markerPath)) await this.d.adapter.remove(this.markerPath);
      } catch {
        /* nothing to do */
      }
    });
  }

  /** The user answered "Keep current data" to the downgrade question. */
  keepCurrent(): Promise<void> {
    return this.run(async () => {
      try {
        await this.recordVersion(await this.readIndex());
      } catch (e) {
        this.warn(`could not record the version change (${errMsg(e)}). You will be asked again next start.`);
      }
    });
  }

  /**
   * Apply a queued restore. Call at the very start of loading, BEFORE `data.json` is read for use, so nothing in
   * memory can write the old data back over it. Any failure leaves the current data as it is.
   */
  applyPendingRestore(): Promise<RestoreResult> {
    return this.run(async () => {
      let markerSeen = false;
      try {
        if (!(await this.d.adapter.exists(this.markerPath))) return { status: "none" as const };
        markerSeen = true;
        const fail = async (message: string): Promise<RestoreResult> => {
          await this.dropMarker();
          this.warn(`${message} Your current data was not changed.`);
          return { status: "failed", message };
        };

        let id: string;
        try {
          id = String((JSON.parse(await this.d.adapter.read(this.markerPath)) as { id?: unknown }).id ?? "");
        } catch {
          return await fail("The queued restore could not be read.");
        }
        const idx = await this.readIndex();
        const entry = idx.backups.find((e) => e.id === id);
        if (!entry) return await fail("The backup chosen for restore is no longer in the list.");

        let bundle: BackupBundle;
        try {
          bundle = await this.readBundle(entry);
        } catch (e) {
          return await fail(`The chosen backup is damaged or unreadable (${errMsg(e)}).`);
        }

        // Undo point: what is on disk right now, including the mirror files the backup will overwrite.
        const ctx: BackupContext = {
          enabled: true,
          keep: this.d.context().keep,
          vocabMirrorPath: bundle.files.vocabMirror?.path ?? null,
          settingsMirrorPath: bundle.files.settingsMirror?.path ?? null,
        };
        try {
          const pre = await this.takeSnapshot("pre-restore", idx.lastRunVersion ?? "unknown", ctx, idx);
          if (pre.entry) await this.writeIndex(idx);
        } catch (e) {
          return await fail(`Could not save your current data first (${errMsg(e)}), so the restore was not done.`);
        }

        try {
          await this.put(this.d.dataPath, (p) => this.d.adapter.write(p, bundle.files.data));
        } catch (e) {
          return await fail(`Could not write the restored data (${errMsg(e)}).`);
        }

        // Mirror files: only where this device still has one at the recorded place. A mirror the user has since moved
        // or deleted is left alone rather than recreated.
        const mirrorsSkipped: string[] = [];
        for (const m of [bundle.files.vocabMirror, bundle.files.settingsMirror]) {
          if (!m) continue;
          try {
            if (await this.d.adapter.exists(m.path)) await this.put(m.path, (p) => this.d.adapter.write(p, m.text));
            else mirrorsSkipped.push(m.path);
          } catch {
            mirrorsSkipped.push(m.path);
          }
        }
        if (mirrorsSkipped.length) {
          this.warn(`your data was restored, but ${mirrorsSkipped.length} sync file(s) could not be rewritten, so synced newer data may come back.`);
        }

        const after = await this.readIndex();
        after.lastRunVersion = this.d.version;
        await this.writeIndex(after);
        await this.dropMarker();
        return { status: "applied", entry, ...(mirrorsSkipped.length ? { mirrorsSkipped } : {}) };
      } catch (e) {
        if (markerSeen) await this.dropMarker();
        const message = `The restore failed (${errMsg(e)}).`;
        this.warn(`${message} Your current data was not changed.`);
        return { status: "failed", message };
      }
    });
  }

  // -- internals -----------------------------------------------------------------------------------------------------

  private async dropMarker(): Promise<void> {
    try {
      if (await this.d.adapter.exists(this.markerPath)) await this.d.adapter.remove(this.markerPath);
    } catch {
      /* a marker we cannot remove will be retried and fail the same way; it never blocks loading */
    }
  }

  private async ensureDir(): Promise<void> {
    if (!(await this.d.adapter.exists(this.d.dir))) await this.d.adapter.mkdir(this.d.dir);
  }

  /** Stage to `<path>.tmp`, then swap in, so a crash mid-write never leaves a half-written file at `path`. */
  private async put(path: string, write: (p: string) => Promise<void>): Promise<void> {
    const tmp = `${path}.tmp`;
    try {
      await write(tmp);
      if (await this.d.adapter.exists(path)) await this.d.adapter.remove(path);
      await this.d.adapter.rename(tmp, path);
    } catch {
      // Some mobile adapters reject `.tmp` paths or rename: fall back to a direct write, and let THAT error escape.
      try {
        if (await this.d.adapter.exists(tmp)) await this.d.adapter.remove(tmp);
      } catch {
        /* best effort */
      }
      await write(path);
    }
  }

  private async readIndex(): Promise<BackupIndex> {
    const a = this.d.adapter;
    if (!(await a.exists(this.indexPath))) return { schemaVersion: 1, backups: [] };
    try {
      return coerceIndex(JSON.parse(await a.read(this.indexPath)));
    } catch (e) {
      // Keep the damaged file for inspection and start a fresh history rather than refuse to run.
      try {
        const bad = `${this.indexPath}.bad`;
        if (await a.exists(bad)) await a.remove(bad);
        await a.rename(this.indexPath, bad);
      } catch {
        /* best effort */
      }
      this.warn(`the backup list was unreadable (${errMsg(e)}) and was set aside. Existing backup files are kept but not listed.`);
      return { schemaVersion: 1, backups: [] };
    }
  }

  private async writeIndex(idx: BackupIndex): Promise<void> {
    await this.ensureDir();
    await this.put(this.indexPath, (p) => this.d.adapter.write(p, JSON.stringify(idx, null, 2)));
  }

  private async recordVersion(idx: BackupIndex): Promise<void> {
    idx.lastRunVersion = this.d.version;
    await this.writeIndex(idx);
  }

  /** Trim `idx` to the retention policy and return what was dropped, whose files the caller removes after the index is saved. */
  private retain(idx: BackupIndex, keep: number): BackupEntry[] {
    const r = applyRetention(idx.backups, keep);
    idx.backups = r.keep;
    return r.drop;
  }

  private async deleteFiles(gone: BackupEntry[]): Promise<void> {
    for (const e of gone) {
      try {
        const p = `${this.d.dir}/${e.file}`;
        if (await this.d.adapter.exists(p)) await this.d.adapter.remove(p);
      } catch {
        /* an orphaned file is harmless and is not listed */
      }
    }
  }

  private async buildBundle(ctx: BackupContext): Promise<{ text: string; includes: BackupEntry["includes"] } | null> {
    const a = this.d.adapter;
    if (!(await a.exists(this.d.dataPath))) return null;
    const files: BackupBundle["files"] = { data: await a.read(this.d.dataPath) };
    const includes: BackupEntry["includes"] = ["data"];
    const mirror = async (path: string | null | undefined, key: "vocabMirror" | "settingsMirror") => {
      if (!path) return;
      try {
        if (await a.exists(path)) {
          files[key] = { path, text: await a.read(path) };
          includes.push(key);
        }
      } catch {
        /* a mirror we cannot read is simply not part of this backup */
      }
    };
    await mirror(ctx.vocabMirrorPath, "vocabMirror");
    await mirror(ctx.settingsMirrorPath, "settingsMirror");
    const bundle: BackupBundle = { v: 1, files };
    return { text: JSON.stringify(bundle), includes };
  }

  /**
   * Write one backup file and add its entry to `idx` (the caller persists the index). Throws on any failure after
   * removing whatever it half-wrote. Returns `skipped` when there is nothing to back up or the newest backup already
   * holds exactly this data.
   */
  private async takeSnapshot(kind: BackupKind, fromVersion: string, ctx: BackupContext, idx: BackupIndex): Promise<SnapshotResult> {
    const built = await this.buildBundle(ctx);
    if (!built) return { entry: null, skipped: "no-data" };
    const sha256 = await this.d.sha256(built.text);
    if (shouldSkipSnapshot(sha256, idx.backups)) return { entry: null, skipped: "unchanged" };

    const createdAt = this.d.now().toISOString();
    const id = backupId(createdAt, kind, fromVersion);
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.d.codec.compress(built.text);
    } catch {
      bytes = null; // no gzip here: store plain JSON rather than fail the backup
    }
    const encoding: BackupEntry["encoding"] = bytes ? "gzip" : "none";
    const file = backupFileName(id, encoding);
    const path = `${this.d.dir}/${file}`;

    await this.ensureDir();
    try {
      await this.put(path, (p) => (bytes ? this.d.adapter.writeBinary(p, toArrayBuffer(bytes)) : this.d.adapter.write(p, built.text)));
      // Read it back: a backup that cannot be read is worse than none, because it looks like a safety net.
      const entryProbe = { encoding, file } as BackupEntry;
      const back = await this.readBackupText(entryProbe);
      if ((await this.d.sha256(back)) !== sha256) throw new Error("the written backup did not read back identically");
    } catch (e) {
      try {
        if (await this.d.adapter.exists(path)) await this.d.adapter.remove(path);
      } catch {
        /* best effort */
      }
      throw e;
    }

    const entry: BackupEntry = {
      id,
      createdAt,
      fromVersion,
      kind,
      file,
      encoding,
      rawBytes: new TextEncoder().encode(built.text).length,
      storedBytes: bytes ? bytes.length : new TextEncoder().encode(built.text).length,
      sha256,
      includes: built.includes,
    };
    idx.backups.push(entry);
    return { entry };
  }

  private async readBackupText(entry: Pick<BackupEntry, "encoding" | "file">): Promise<string> {
    const path = `${this.d.dir}/${entry.file}`;
    if (entry.encoding === "gzip") return this.d.codec.decompress(new Uint8Array(await this.d.adapter.readBinary(path)));
    return this.d.adapter.read(path);
  }

  private async readBundle(entry: BackupEntry): Promise<BackupBundle> {
    const text = await this.readBackupText(entry);
    if ((await this.d.sha256(text)) !== entry.sha256) throw new Error("its checksum does not match");
    const raw = JSON.parse(text) as Partial<BackupBundle>;
    if (raw?.v !== 1 || typeof raw.files?.data !== "string") throw new Error("it is not a backup this version understands");
    return raw as BackupBundle;
  }
}
