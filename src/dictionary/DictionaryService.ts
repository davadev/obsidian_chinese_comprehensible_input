import { App, normalizePath } from "obsidian";
import { DictionaryCustomWords, DictionaryEntry, DictionaryOverrides } from "./DictionaryTypes";
import { SEED_ENTRIES } from "./seedDictionary";
import { HSK_MAP, HSK_SOURCE } from "./hskMap.generated";
import { makeKey } from "./normalizeChinese";

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
  /**
   * Optional overlay sources injected by the plugin. Looked up on every
   * `lookup()` call so changes to overrides / custom words take effect
   * without rebuilding the underlying maps.
   */
  private getOverrides: () => DictionaryOverrides = () => ({});
  private getCustomWords: () => DictionaryCustomWords = () => ({});

  constructor(private app: App) {}

  /**
   * Plugin hands in getters for the user's override + custom-word maps
   * so the overlay sees live data without holding a reference to the
   * mutable objects.
   */
  setOverlay(
    overrides: () => DictionaryOverrides,
    customWords: () => DictionaryCustomWords
  ): void {
    this.getOverrides = overrides;
    this.getCustomWords = customWords;
  }

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

  /** True iff the vault-side dictionary file `.cci-dictionary.json` exists. */
  async isOnDisk(): Promise<boolean> {
    try {
      return await this.app.vault.adapter.exists(normalizePath(".cci-dictionary.json"));
    } catch {
      return false;
    }
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
    // Backfill HSK level metadata from the generated hskMap when the
    // entry has none of its own. Seed entries that already carry an
    // explicit `hsk` are NOT overwritten — they win per the project's
    // "existing HSK 1-3 data has priority" rule. CC-CEDICT entries
    // (which never carry HSK) get filled here so the downloaded
    // dictionary picks up HSK 1-6 categorization without us modifying
    // the dictionary file on disk.
    if (!e.hsk) {
      const level = HSK_MAP[e.simplified];
      if (level) {
        e = {
          ...e,
          hsk: { source: HSK_SOURCE, levels: [String(level)] },
        };
      }
    }
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
    if (this.getCustomWords()[surface]) return true;
    return this.bySimplified.has(surface) || this.byTraditional.has(surface);
  }

  lookup(surface: string): DictionaryEntry[] {
    const out: DictionaryEntry[] = [];
    const custom = this.getCustomWords()[surface];
    if (custom) {
      out.push({
        simplified: custom.simplified,
        traditional: custom.traditional ?? custom.simplified,
        pinyin: custom.pinyin,
        definitions: custom.definitions,
        hsk: custom.hsk,
      });
    }
    const native = this.bySimplified.get(surface) ?? this.byTraditional.get(surface) ?? [];
    const overrides = this.getOverrides();
    for (const e of native) {
      const key = makeKey(e.simplified, e.pinyin);
      const ov = overrides[key];
      if (!ov) {
        out.push(e);
        continue;
      }
      out.push({
        ...e,
        pinyin: ov.pinyin ?? e.pinyin,
        traditional: ov.traditional ?? e.traditional,
        definitions: ov.definitions ?? e.definitions,
        hsk: ov.hsk ?? e.hsk,
      });
    }
    return out;
  }

  /** Iterate all simplified surfaces — native + user-added custom words.
   * Used by the tokenizer to build its trie. */
  *surfaces(): IterableIterator<string> {
    const seen = new Set<string>();
    for (const s of this.bySimplified.keys()) {
      seen.add(s);
      yield s;
    }
    for (const s of Object.keys(this.getCustomWords())) {
      if (!seen.has(s)) yield s;
    }
  }

  /** All entries combined (simplified + traditional-only). */
  *allEntries(): IterableIterator<DictionaryEntry> {
    for (const arr of this.bySimplified.values()) for (const e of arr) yield e;
  }

  size(): number {
    return this.bySimplified.size;
  }
}
