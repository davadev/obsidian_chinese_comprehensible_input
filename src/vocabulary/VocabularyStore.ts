import { Plugin } from "obsidian";
import { DATA_SCHEMA_VERSION } from "../constants";
import { DictionaryService } from "../dictionary/DictionaryService";
import { makeKey } from "../dictionary/normalizeChinese";
import { migrateVocab } from "./migrations";
import { PersistedVocabData, WordRecord, WordStatus } from "./VocabularyTypes";

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

  bySurface(surface: string): WordRecord | undefined {
    // Fast path: same-key lookup if user keyed by surface only.
    if (this.data.words[surface]) return this.data.words[surface];
    for (const r of Object.values(this.data.words)) {
      if (r.surfaces.includes(surface)) return r;
    }
    return undefined;
  }

  ensure(surface: string): WordRecord {
    const existing = this.bySurface(surface);
    if (existing) return existing;
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
    if (status === "ignored" && reason) r.ignoredReason = reason;
    r.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return r;
  }

  recordExposure(surface: string, retentionLimit: number, storeAll: boolean): WordRecord {
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
    r.updatedAt = iso;
    this.scheduleSave();
    return r;
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
  return {
    ...a,
    ...b,
    surfaces: Array.from(new Set([...(a.surfaces ?? []), ...(b.surfaces ?? [])])),
    seenCount: (a.seenCount ?? 0) + (b.seenCount ?? 0),
    recentSeenAt: [...a.recentSeenAt, ...b.recentSeenAt].sort(),
    dailySeenCounts: mergeCounts(a.dailySeenCounts, b.dailySeenCounts),
    status: pickWinningStatus(a.status, b.status),
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
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
