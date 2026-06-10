import { Plugin } from "obsidian";
import { DATA_SCHEMA_VERSION } from "../constants";
import { DictionaryService } from "../dictionary/DictionaryService";
import { makeKey } from "../dictionary/normalizeChinese";
import { migrateVocab } from "./migrations";
import { KnownAxes, PersistedVocabData, WordRecord, WordStatus } from "./VocabularyTypes";
import { axesFromStatus, statusFromAxes } from "./axes";

/**
 * Vocabulary store backed by Obsidian plugin data via loadData/saveData.
 * Writes are debounced. Schema migrations run on load.
 */
export class VocabularyStore {
  private data: PersistedVocabData = { schemaVersion: DATA_SCHEMA_VERSION, words: {} };
  private loaded = false;
  private saveTimer: number | null = null;

  constructor(
    private plugin: Plugin,
    private dict: DictionaryService,
    /** Key used inside the combined plugin data blob to namespace vocabulary data. */
    private namespace = "vocab"
  ) {}

  async load(initialBlob: any): Promise<void> {
    const raw = initialBlob?.[this.namespace];
    this.data = migrateVocab(raw);
    this.loaded = true;
    this.dedupeOnLoad();
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
    const top = this.dict.lookup(surface)[0];
    const canonical = makeKey(top?.simplified ?? surface, top?.pinyin);
    const direct = this.data.words[canonical];
    if (direct) return direct;
    for (const r of Object.values(this.data.words)) {
      if (r.surfaces.includes(surface)) return r;
    }
    return undefined;
  }

  ensure(surface: string): WordRecord {
    const existing = this.bySurface(surface);
    if (existing) {
      if (!existing.surfaces.includes(surface)) {
        existing.surfaces.push(surface);
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
    this.scheduleSave();
    return rec;
  }

  setStatus(surface: string, status: WordStatus, reason?: string): WordRecord {
    const r = this.ensure(surface);
    r.status = status;
    // Keep axes in sync with the legacy status when possible so renderers
    // that read axes stay correct after a coarse mark-known/unknown.
    const derived = axesFromStatus(status);
    if (derived) r.axes = derived;
    if (status === "ignored" && reason) r.ignoredReason = reason;
    const now = new Date().toISOString();
    if (status === "known" && !r.knownAt) r.knownAt = now;
    r.updatedAt = now;
    this.scheduleSave();
    return r;
  }

  setAxes(surface: string, axes: KnownAxes): WordRecord {
    const r = this.ensure(surface);
    r.axes = axes;
    r.status = statusFromAxes(axes);
    const now = new Date().toISOString();
    if (r.status === "known" && !r.knownAt) r.knownAt = now;
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
    this.scheduleSave();
    return { added, updated };
  }

  async resetAll(): Promise<void> {
    this.data = { schemaVersion: DATA_SCHEMA_VERSION, words: {} };
    await this.flushSave();
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
    const blob = (await this.plugin.loadData()) ?? {};
    blob[this.namespace] = this.data;
    await this.plugin.saveData(blob);
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
