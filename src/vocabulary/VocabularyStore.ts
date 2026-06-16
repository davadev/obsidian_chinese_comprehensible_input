import { Plugin, normalizePath } from "obsidian";
import { DATA_SCHEMA_VERSION } from "../constants";
import { DictionaryService } from "../dictionary/DictionaryService";
import { makeKey } from "../dictionary/normalizeChinese";
import { HSK_MAP, HSK_SOURCE } from "../dictionary/hskMap.generated";
import { migrateVocab } from "./migrations";
import { KnownAxes, PersistedVocabData, WordRecord, WordStatus } from "./VocabularyTypes";
import { axesFromStatus, statusFromAxes } from "./axes";
import { mergeStoresForSync } from "./syncMerge";
import { CciSettings } from "../settings/types";
import { DictionaryCustomWords, DictionaryOverrides } from "../dictionary/DictionaryTypes";

type PluginDataBlob = Record<string, unknown>;

type BlobUpdatingPlugin = Plugin & {
  updateDataBlob?: (mutate: (blob: PluginDataBlob) => void | Promise<void>) => Promise<void>;
};

/**
 * Bridge from main.ts so the mirror payload also carries dictionary
 * overrides + custom words. Read-side merges are forwarded back to the
 * plugin for persistence and tokenizer refresh.
 */
export interface DictionaryMirrorBridge {
  getOverrides: () => DictionaryOverrides;
  getCustomWords: () => DictionaryCustomWords;
  mergeRemote: (
    overrides: DictionaryOverrides,
    customWords: DictionaryCustomWords
  ) => Promise<void>;
}

/** Envelope wrapping vocab + dictionary user data into a single mirror file. */
const MIRROR_ENVELOPE_VERSION = 2;
interface MirrorEnvelope {
  schemaVersion: number;
  vocab: unknown;
  dictionaryOverrides?: DictionaryOverrides;
  dictionaryCustomWords?: DictionaryCustomWords;
}

/**
 * Vocabulary store backed by Obsidian plugin data via loadData/saveData.
 * Writes are debounced. Schema migrations run on load.
 *
 * When `settings.sync.mirrorEnabled` is on, the same blob is additionally
 * written to a vault-side JSON file at `settings.sync.mirrorPath`. That
 * file lives outside `.obsidian/` so the remotely-save plugin syncs it
 * without "sync config dir" enabled. External changes to the mirror (sync
 * pulls in remote work) are merged back in via `mergeMirrorContent`, called
 * from main.ts' vault `'modify'` watcher.
 */
export class VocabularyStore {
  /**
   * Coalesce rapid mirror writes (exposure ticks while reading) so Nextcloud
   * /  remotely-save get a quiet target. data.json keeps its own 400ms
   * debounce because crash-recovery there cares about granularity; the
   * mirror only needs to converge for cross-device sync.
   */
  private static MIRROR_WRITE_DEBOUNCE_MS = 5_000;

  private data: PersistedVocabData = { schemaVersion: DATA_SCHEMA_VERSION, words: {} };
  private loaded = false;
  private saveTimer: number | null = null;
  private mirrorWriteTimer: number | null = null;
  /** Hash of the last mirror bytes we wrote; used to ignore self-triggered modify events. */
  private lastMirrorHash: string | null = null;
  /** Last seen mtime of the mirror file. Used by the fast poll to short-
   *  circuit the 2.9 MB read when the file hasn't moved on disk. */
  private lastMirrorMtime: number | null = null;
  private dictBridge: DictionaryMirrorBridge | null = null;
  private surfaceLookupCache = new Map<string, WordRecord | null>();

  /** Wire up the bridge after construction (avoids circular deps with CciPlugin). */
  setDictionaryMirrorBridge(bridge: DictionaryMirrorBridge): void {
    this.dictBridge = bridge;
  }

  constructor(
    private plugin: Plugin,
    private dict: DictionaryService,
    private getSettings: () => CciSettings,
    /** Key used inside the combined plugin data blob to namespace vocabulary data. */
    private namespace = "vocab"
  ) {}

  /** Path the mirror should live at, or null if mirroring is off. */
  mirrorPath(): string | null {
    const sync = this.getSettings().sync;
    if (!sync?.mirrorEnabled) return null;
    return sync.mirrorPath ? normalizePath(sync.mirrorPath) : null;
  }

  async load(initialBlob: unknown): Promise<void> {
    const blob = (initialBlob ?? {}) as Record<string, unknown>;
    const raw = blob[this.namespace];
    this.data = migrateVocab(raw);
    this.clearSurfaceLookupCache();
    this.loaded = true;
    this.dedupeOnLoad();
    // Mirror merge is intentionally NOT awaited here. iOS Files-provider I/O
    // (Nextcloud, iCloud) can stall or reject in ways that surface as a
    // generic "plugin encountered an error while loading" notice. Caller
    // (main.ts onload) schedules `bootstrapMirrorAfterLoad` for after
    // workspace layout is ready, wrapped in its own try/catch.
  }

  /** Run the load-time mirror merge. Caller (main.ts) decides when. */
  async bootstrapMirrorAfterLoad(): Promise<void> {
    await this.mergeMirrorOnLoad();
  }

  /**
   * If the vault mirror is enabled and present on disk, merge it into the
   * in-memory store using `mergeForSync` and persist the result. Also
   * scans the mirror's folder for `*.conflict-*.json` siblings written by
   * remotely-save, merges and removes each.
   */
  /** Public entry point for re-running the load-time mirror sweep. User-
   *  initiated, so the resulting write should be immediate rather than
   *  deferred by the mirror-write debounce. */
  async reloadMirror(): Promise<void> {
    await this.mergeMirrorOnLoad();
    await this.flushMirrorNow();
  }

  private async mergeMirrorOnLoad(): Promise<void> {
    const path = this.mirrorPath();
    if (!path) return;
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (await adapter.exists(path)) {
        const content = await adapter.read(path);
        this.mergeMirrorContent(content);
        this.lastMirrorHash = await hashString(content);
        try {
          const st = await adapter.stat(path);
          if (st) this.lastMirrorMtime = st.mtime;
        } catch { /* ignore */ }
      }
      await this.sweepConflictFiles(path);
    } catch (e) {
      console.error("CCI sync: mirror load failed", e);
    }
    // Never let a mirror write failure cascade into a plugin load failure —
    // the user can still use the plugin even if the vault-side mirror is
    // momentarily unwritable.
    if (this.loaded) {
      try {
        await this.flushSave();
      } catch (e) {
        console.error("CCI sync: post-load flushSave failed", e);
      }
    }
  }

  private async sweepConflictFiles(mirrorPath: string): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const slash = mirrorPath.lastIndexOf("/");
    const folder = slash >= 0 ? mirrorPath.slice(0, slash) : "";
    const baseFull = slash >= 0 ? mirrorPath.slice(slash + 1) : mirrorPath;
    const base = baseFull.replace(/\.json$/i, "");
    let listing;
    try {
      listing = await adapter.list(folder || "/");
    } catch {
      return;
    }
    for (const filePath of listing.files ?? []) {
      const name = filePath.slice(filePath.lastIndexOf("/") + 1);
      if (filePath === mirrorPath) continue;
      // remotely-save names conflicts like "vocabulary.conflict-2026-06-12.json"
      // or "vocabulary.<host>.conflict.json"; match anything that starts with
      // the base name and contains "conflict".
      if (!name.startsWith(base) || !/conflict/i.test(name)) continue;
      if (!name.toLowerCase().endsWith(".json")) continue;
      try {
        const c = await adapter.read(filePath);
        this.mergeMirrorContent(c);
        await adapter.remove(filePath);
      } catch (e) {
        console.warn("CCI sync: failed to absorb conflict file", filePath, e);
      }
    }
  }

  /**
   * Apply a mirror JSON blob (as raw string) to the in-memory store. Used by
   * load-time merge and by main.ts' vault `'modify'` watcher when remotely-
   * save pulls in a newer remote version. Idempotent: harmless to re-apply
   * the same content.
   */
  mergeMirrorContent(content: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.warn("CCI sync: mirror file is not valid JSON", e);
      return false;
    }
    // Two formats: legacy = raw PersistedVocabData; v2 = envelope wrapping
    // vocab + dictionary user data.
    const isEnvelope =
      parsed && typeof parsed === "object" && "vocab" in (parsed as Record<string, unknown>);
    const envelope: MirrorEnvelope = isEnvelope
      ? (parsed as MirrorEnvelope)
      : { schemaVersion: 1, vocab: parsed };

    const remote = migrateVocab(envelope.vocab);
    const settings = this.getSettings();
    const merged = mergeStoresForSync(this.data, remote, {
      statusPriority: settings.sync.statusPriority,
      recentSeenAtCap: settings.storeAllExactTimestamps
        ? undefined
        : settings.exactTimestampRetentionLimit,
    });
    this.data = merged;
    this.clearSurfaceLookupCache();

    if (this.dictBridge) {
      const remoteOv = envelope.dictionaryOverrides ?? {};
      const remoteCw = envelope.dictionaryCustomWords ?? {};
      if (Object.keys(remoteOv).length || Object.keys(remoteCw).length) {
        // Fire-and-forget, but never leak an unhandled rejection — iOS
        // WKWebView treats unhandled rejections more aggressively than
        // Electron and can surface them as plugin load failures.
        this.dictBridge
          .mergeRemote(remoteOv, remoteCw)
          .catch((err) => console.error("CCI sync: dictionary merge failed", err));
      }
    }
    return true;
  }

  /**
   * Called by main.ts after the vault watcher fires for the mirror path.
   * Returns true iff the file content differs from what we last wrote
   * (i.e. this is a genuine external change, not our own echoing write).
   */
  async absorbExternalMirrorChange(): Promise<boolean> {
    const path = this.mirrorPath();
    if (!path) return false;
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(path))) return false;
    // Cheap mtime gate: skip the 2.9 MB read entirely when the file hasn't
    // moved on disk. Falls through to the full read if stat is unsupported
    // by the adapter or returns null.
    try {
      const st = await adapter.stat(path);
      if (st && this.lastMirrorMtime != null && st.mtime <= this.lastMirrorMtime) {
        return false;
      }
    } catch {
      /* stat unsupported on this platform; fall through */
    }
    const content = await adapter.read(path);
    const hash = await hashString(content);
    if (hash === this.lastMirrorHash) {
      // Same content; remember mtime so future polls short-circuit on stat.
      try {
        const st = await adapter.stat(path);
        if (st) this.lastMirrorMtime = st.mtime;
      } catch { /* ignore */ }
      return false;
    }
    const ok = this.mergeMirrorContent(content);
    if (!ok) return false;
    this.lastMirrorHash = hash;
    try {
      const st = await adapter.stat(path);
      if (st) this.lastMirrorMtime = st.mtime;
    } catch { /* ignore */ }
    await this.flushSave();
    return true;
  }

  /**
   * One-time pass on load: re-key any record whose stored `key` doesn't match
   * the canonical `makeKey(simplified, pinyin)`. Merge with any existing
   * record under the canonical key. Fixes the "marked known in note A, shows
   * untracked in note B" duplicate caused by older entries keyed by raw
   * surface instead of by simplified|pinyin.
   */
  private dedupeOnLoad(): void {
    let mutated = false;
    const out: Record<string, WordRecord> = {};
    for (const r of Object.values(this.data.words)) {
      // Backfill knownAt for records already in the "known" bucket — best
      // approximation is updatedAt, which at least won't shift on future
      // edits.
      if (r.status === "known" && !r.knownAt) {
        r.knownAt = r.updatedAt;
        mutated = true;
      }
      // Backfill classifiedAt for records already out of "new". Same
      // proxy (updatedAt) since we don't have the real transition time.
      if (r.status !== "new" && !r.classifiedAt) {
        r.classifiedAt = r.updatedAt;
        mutated = true;
      }
      // Backfill HSK level metadata from the imported map. Records with an
      // existing `hsk` keep theirs unchanged (existing HSK 1-3 data wins).
      if (!r.hsk) {
        const surface = r.simplified ?? r.surfaces[0];
        const level = surface ? HSK_MAP[surface] : undefined;
        if (level) {
          r.hsk = { source: HSK_SOURCE, levels: [String(level)] };
          mutated = true;
        }
      }
      const canonical = makeKey(r.simplified ?? r.surfaces[0] ?? r.key, r.pinyin);
      if (canonical !== r.key) {
        r.key = canonical;
        mutated = true;
      }
      const prev = out[canonical];
      if (!prev) {
        out[canonical] = r;
        continue;
      }
      out[canonical] = mergeRecords(prev, r);
      mutated = true;
    }
    if (mutated) {
      this.data.words = out;
      this.clearSurfaceLookupCache();
      this.scheduleSave();
    }
  }

  /** Returns a frozen view of the persisted blob to be merged with settings. */
  toBlob(): PersistedVocabData {
    return this.data;
  }

  size(): number {
    return Object.keys(this.data.words).length;
  }

  get(key: string): WordRecord | undefined {
    return this.data.words[key];
  }

  /**
   * Look up a record by the visible surface. Resolves the canonical
   * `simplified|pinyin` key via the dictionary so the same word marked in
   * any note (in any variant — simplified, traditional, or alternate
   * surface) lands on the same record. Falls back to the surfaces[] scan
   * for records that pre-date this canonical-key logic; if the load-time
   * dedupe has already run there will not be any.
   */
  bySurface(surface: string): WordRecord | undefined {
    if (this.surfaceLookupCache.has(surface)) {
      return this.surfaceLookupCache.get(surface) ?? undefined;
    }
    const top = this.dict.lookup(surface)[0];
    const canonical = makeKey(top?.simplified ?? surface, top?.pinyin);
    const direct = this.data.words[canonical];
    if (direct) {
      this.surfaceLookupCache.set(surface, direct);
      return direct;
    }
    for (const r of Object.values(this.data.words)) {
      if (r.surfaces.includes(surface)) {
        this.surfaceLookupCache.set(surface, r);
        return r;
      }
    }
    this.surfaceLookupCache.set(surface, null);
    return undefined;
  }

  ensure(surface: string): WordRecord {
    const existing = this.bySurface(surface);
    if (existing) {
      if (!existing.surfaces.includes(surface)) {
        existing.surfaces.push(surface);
        this.clearSurfaceLookupCache();
        this.scheduleSave();
      }
      return existing;
    }
    const entries = this.dict.lookup(surface);
    const top = entries[0];
    const key = makeKey(top?.simplified ?? surface, top?.pinyin);
    const now = new Date().toISOString();
    const rec: WordRecord = {
      key,
      surfaces: [surface, ...(top && top.traditional !== top.simplified ? [top.traditional] : [])].filter(
        (s, i, a) => s && a.indexOf(s) === i
      ),
      simplified: top?.simplified ?? surface,
      traditional: top?.traditional,
      pinyin: top?.pinyin,
      definitions: top?.definitions,
      hsk: top?.hsk,
      status: "new",
      seenCount: 0,
      recentSeenAt: [],
      dailySeenCounts: {},
      updatedAt: now,
    };
    this.data.words[key] = rec;
    this.clearSurfaceLookupCache();
    this.scheduleSave();
    return rec;
  }

  setStatus(surface: string, status: WordStatus, reason?: string): WordRecord {
    const r = this.ensure(surface);
    const wasNew = r.status === "new";
    r.status = status;
    const derived = axesFromStatus(status);
    if (derived) r.axes = derived;
    if (status === "ignored" && reason) r.ignoredReason = reason;
    const now = new Date().toISOString();
    if (status === "known" && !r.knownAt) r.knownAt = now;
    if (wasNew && status !== "new" && !r.classifiedAt) r.classifiedAt = now;
    r.updatedAt = now;
    this.scheduleSave();
    return r;
  }

  setAxes(surface: string, axes: KnownAxes): WordRecord {
    const r = this.ensure(surface);
    const wasNew = r.status === "new";
    r.axes = axes;
    r.status = statusFromAxes(axes);
    const now = new Date().toISOString();
    if (r.status === "known" && !r.knownAt) r.knownAt = now;
    if (wasNew && r.status !== "new" && !r.classifiedAt) r.classifiedAt = now;
    r.updatedAt = now;
    this.scheduleSave();
    return r;
  }

  recordExposure(
    surface: string,
    retentionLimit: number,
    storeAll: boolean,
    notePath?: string
  ): WordRecord {
    const r = this.ensure(surface);
    const now = new Date();
    const iso = now.toISOString();
    const day = iso.slice(0, 10);
    r.seenCount += 1;
    r.firstSeenAt = r.firstSeenAt ?? iso;
    r.lastSeenAt = iso;
    r.recentSeenAt.push(iso);
    if (!storeAll && r.recentSeenAt.length > retentionLimit) {
      r.recentSeenAt.splice(0, r.recentSeenAt.length - retentionLimit);
    }
    r.dailySeenCounts[day] = (r.dailySeenCounts[day] ?? 0) + 1;
    if (notePath) {
      r.notesSeenCounts = r.notesSeenCounts ?? {};
      r.notesSeenCounts[notePath] = (r.notesSeenCounts[notePath] ?? 0) + 1;
    }
    r.updatedAt = iso;
    this.scheduleSave();
    return r;
  }

  /** Returns the list of known note paths that have at least one record exposure. */
  knownNotePaths(): string[] {
    const set = new Set<string>();
    for (const r of this.values()) {
      if (!r.notesSeenCounts) continue;
      for (const k of Object.keys(r.notesSeenCounts)) set.add(k);
    }
    return Array.from(set).sort();
  }

  updateMnemonic(surface: string, patch: Partial<NonNullable<WordRecord["mnemonic"]>>): WordRecord {
    const r = this.ensure(surface);
    r.mnemonic = { ...(r.mnemonic ?? {}), ...patch, updatedAt: new Date().toISOString() };
    r.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return r;
  }

  updateSrs(surface: string, patch: Partial<NonNullable<WordRecord["srs"]>>): WordRecord {
    const r = this.ensure(surface);
    r.srs = { ...(r.srs ?? {}), ...patch };
    r.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return r;
  }

  values(): WordRecord[] {
    return Object.values(this.data.words);
  }

  async exportJson(): Promise<string> {
    return JSON.stringify(this.data, null, 2);
  }

  async exportCsv(): Promise<string> {
    const header = [
      "key",
      "surface",
      "pinyin",
      "definitions",
      "hsk",
      "status",
      "seenCount",
      "firstSeenAt",
      "lastSeenAt",
      "dueAt",
    ];
    const rows = [header.join(",")];
    for (const r of this.values()) {
      rows.push(
        [
          csv(r.key),
          csv(r.surfaces[0] ?? ""),
          csv(r.pinyin ?? ""),
          csv((r.definitions ?? []).join("; ")),
          csv((r.hsk?.levels ?? []).join("/")),
          csv(r.status),
          String(r.seenCount),
          csv(r.firstSeenAt ?? ""),
          csv(r.lastSeenAt ?? ""),
          csv(r.srs?.dueAt ?? ""),
        ].join(",")
      );
    }
    return rows.join("\n");
  }

  async importJson(text: string): Promise<{ added: number; updated: number }> {
    const incoming = migrateVocab(JSON.parse(text));
    let added = 0;
    let updated = 0;
    for (const [k, v] of Object.entries(incoming.words)) {
      if (this.data.words[k]) {
        this.data.words[k] = mergeRecords(this.data.words[k], v);
        updated++;
      } else {
        this.data.words[k] = v;
        added++;
      }
    }
    this.clearSurfaceLookupCache();
    this.scheduleSave();
    return { added, updated };
  }

  async resetAll(): Promise<void> {
    this.data = { schemaVersion: DATA_SCHEMA_VERSION, words: {} };
    this.clearSurfaceLookupCache();
    await this.flushSave();
  }

  /**
   * Bulk-change every record currently in status === "new" to the given
   * status. Used by the "Mark all unclassified as Unknown" button on the
   * stats dashboard. Returns the number of records affected.
   */
  markAllNewAs(status: WordStatus): number {
    let n = 0;
    const now = new Date().toISOString();
    const derived = axesFromStatus(status);
    for (const r of Object.values(this.data.words)) {
      if (r.status !== "new") continue;
      r.status = status;
      if (derived) r.axes = derived;
      if (status === "known" && !r.knownAt) r.knownAt = now;
      if (!r.classifiedAt) r.classifiedAt = now;
      r.updatedAt = now;
      n++;
    }
    if (n) this.scheduleSave();
    return n;
  }

  private scheduleSave(): void {
    if (!this.loaded) return;
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.flushSave().catch(console.error);
    }, 400);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const plugin = this.plugin as BlobUpdatingPlugin;
    if (typeof plugin.updateDataBlob === "function") {
      await plugin.updateDataBlob((blob) => {
        blob[this.namespace] = this.data;
      });
    } else {
      const blob = (await this.plugin.loadData()) ?? {};
      blob[this.namespace] = this.data;
      await this.plugin.saveData(blob);
    }
    // Mirror write is decoupled and debounced — see scheduleMirrorWrite.
    this.scheduleMirrorWrite();
  }

  private clearSurfaceLookupCache(): void {
    this.surfaceLookupCache.clear();
  }

  private scheduleMirrorWrite(): void {
    if (!this.loaded) return;
    if (!this.mirrorPath()) return;
    if (this.mirrorWriteTimer != null) window.clearTimeout(this.mirrorWriteTimer);
    this.mirrorWriteTimer = window.setTimeout(() => {
      this.mirrorWriteTimer = null;
      this.writeMirror().catch((e) => console.error("CCI sync: mirror write failed", e));
    }, VocabularyStore.MIRROR_WRITE_DEBOUNCE_MS);
  }

  /** Force-flush a pending mirror write immediately. Called from user-initiated
   *  paths (re-sync button, settings refresh) and plugin unload so we don't
   *  lose the last few seconds of changes on quit. */
  async flushMirrorNow(): Promise<void> {
    if (this.mirrorWriteTimer != null) {
      window.clearTimeout(this.mirrorWriteTimer);
      this.mirrorWriteTimer = null;
    }
    await this.writeMirror();
  }

  private async writeMirror(): Promise<void> {
    const path = this.mirrorPath();
    if (!path) return;
    try {
      await ensureFolderForFile(this.plugin, path);
      const envelope: MirrorEnvelope = {
        schemaVersion: MIRROR_ENVELOPE_VERSION,
        vocab: this.data,
        dictionaryOverrides: this.dictBridge?.getOverrides() ?? {},
        dictionaryCustomWords: this.dictBridge?.getCustomWords() ?? {},
      };
      const content = JSON.stringify(envelope, null, 2);
      const adapter = this.plugin.app.vault.adapter;
      // Try atomic write (stage to .tmp, then rename). Avoids Nextcloud /
      // remotely-save catching a half-written JSON. Some mobile adapters
      // (older Obsidian builds) don't expose `rename` or reject `.tmp`
      // paths, so fall back to a direct write in that case rather than
      // failing the whole save.
      const tmpPath = `${path}.tmp`;
      let wroteAtomic = false;
      try {
        await adapter.write(tmpPath, content);
        if (await adapter.exists(path)) {
          await adapter.remove(path);
        }
        await adapter.rename(tmpPath, path);
        wroteAtomic = true;
      } catch (atomicErr) {
        console.warn("CCI sync: atomic mirror write unavailable, falling back to direct write", atomicErr);
        // Best-effort cleanup of the staging file; ignore failures.
        try {
          if (await adapter.exists(tmpPath)) await adapter.remove(tmpPath);
        } catch {
          /* ignore */
        }
        await adapter.write(path, content);
      }
      void wroteAtomic;
      this.lastMirrorHash = await hashString(content);
      try {
        const st = await adapter.stat(path);
        if (st) this.lastMirrorMtime = st.mtime;
      } catch { /* ignore */ }
    } catch (e) {
      console.error("CCI sync: mirror write failed", e);
    }
  }
}

/**
 * Stable-but-fast hash for change-detection on the mirror file. Not
 * cryptographic — just used to ignore our own write events. Uses SubtleCrypto
 * (always present in Obsidian's Electron runtime).
 */
async function hashString(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureFolderForFile(plugin: Plugin, filePath: string): Promise<void> {
  const slash = filePath.lastIndexOf("/");
  if (slash <= 0) return;
  const folder = filePath.slice(0, slash);
  const adapter = plugin.app.vault.adapter;
  if (!(await adapter.exists(folder))) {
    await adapter.mkdir(folder);
  }
}

function csv(s: string): string {
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function mergeRecords(a: WordRecord, b: WordRecord): WordRecord {
  const firstSeenAt = pickEarlier(a.firstSeenAt, b.firstSeenAt);
  const knownAt = pickEarlier(a.knownAt, b.knownAt);
  const classifiedAt = pickEarlier(a.classifiedAt, b.classifiedAt);
  return {
    ...a,
    ...b,
    surfaces: Array.from(new Set([...(a.surfaces ?? []), ...(b.surfaces ?? [])])),
    seenCount: (a.seenCount ?? 0) + (b.seenCount ?? 0),
    recentSeenAt: [...a.recentSeenAt, ...b.recentSeenAt].sort(),
    dailySeenCounts: mergeCounts(a.dailySeenCounts, b.dailySeenCounts),
    status: pickWinningStatus(a.status, b.status),
    firstSeenAt,
    knownAt,
    classifiedAt,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
}

function pickEarlier(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function pickWinningStatus(a: WordStatus, b: WordStatus): WordStatus {
  const rank: Record<WordStatus, number> = {
    new: 0,
    unknown: 1,
    meaningKnownPinyinUnknown: 2,
    pinyinKnownMeaningUnknown: 2,
    charactersUnknown: 2,
    known: 3,
    ignored: 4,
  };
  return rank[a] >= rank[b] ? a : b;
}
