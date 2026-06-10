import { App, normalizePath } from "obsidian";
import { DictionaryEntry } from "./DictionaryTypes";
import { SEED_ENTRIES } from "./seedDictionary";

/**
 * Lazy dictionary store.
 * - In-memory simplified -> entry[] and traditional -> entry[] maps.
 * - Seeded with a tiny built-in list so the plugin works without external data.
 * - Optional: loads extra entries from `<vault>/.cci-dictionary.json` (user-supplied),
 *   used so a learner can drop their own CC-CEDICT shard into the vault without
 *   shipping CC BY-SA data inside the plugin bundle.
 */
export class DictionaryService {
  private bySimplified = new Map<string, DictionaryEntry[]>();
  private byTraditional = new Map<string, DictionaryEntry[]>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(private app: App) {}

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.doLoad();
    await this.loadingPromise;
  }

  /** Force re-read of the vault-side dictionary file after a download. */
  async reload(): Promise<void> {
    this.bySimplified.clear();
    this.byTraditional.clear();
    this.loaded = false;
    this.loadingPromise = null;
    await this.ensureLoaded();
  }

  private async doLoad(): Promise<void> {
    for (const e of SEED_ENTRIES) this.index(e);
    await this.tryLoadVaultDictionary();
    this.loaded = true;
  }

  private async tryLoadVaultDictionary(): Promise<void> {
    const path = normalizePath(".cci-dictionary.json");
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) return;
      const raw = await this.app.vault.adapter.read(path);
      const data = JSON.parse(raw) as DictionaryEntry[];
      if (!Array.isArray(data)) return;
      for (const e of data) {
        if (e && typeof e.simplified === "string" && typeof e.pinyin === "string") {
          this.index(e);
        }
      }
    } catch {
      // Silent: missing/invalid extra dictionary should not block plugin.
    }
  }

  private index(e: DictionaryEntry) {
    const s = this.bySimplified.get(e.simplified) ?? [];
    s.push(e);
    this.bySimplified.set(e.simplified, s);
    if (e.traditional && e.traditional !== e.simplified) {
      const t = this.byTraditional.get(e.traditional) ?? [];
      t.push(e);
      this.byTraditional.set(e.traditional, t);
    }
  }

  /** True if any entry exists for surface (simplified or traditional). */
  has(surface: string): boolean {
    return this.bySimplified.has(surface) || this.byTraditional.has(surface);
  }

  lookup(surface: string): DictionaryEntry[] {
    const s = this.bySimplified.get(surface);
    if (s) return s;
    const t = this.byTraditional.get(surface);
    if (t) return t;
    return [];
  }

  /** Iterate all simplified surfaces for prefix-based trie building. */
  surfaces(): IterableIterator<string> {
    return this.bySimplified.keys();
  }

  /** All entries combined (simplified + traditional-only). */
  *allEntries(): IterableIterator<DictionaryEntry> {
    for (const arr of this.bySimplified.values()) for (const e of arr) yield e;
  }

  size(): number {
    return this.bySimplified.size;
  }
}
