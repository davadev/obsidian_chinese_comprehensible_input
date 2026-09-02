import { App, normalizePath } from "obsidian";
import { DictionaryCustomWords, DictionaryEntry, DictionaryOverrides } from "./DictionaryTypes";
import { SEED_ENTRIES } from "./seedDictionary";
import { HSK_MAP, HSK_SOURCE } from "./hskMap.generated";
import { makeKey, repairPinyin } from "./normalizeChinese";
import { extractTaiwanReading } from "./taiwanReading";

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
    // Three derived fields are filled in here rather than on disk, so an
    // existing user picks all of them up on the next load without having
    // to re-download the dictionary. They are gathered into one patch and
    // applied with a single spread: this runs for every one of ~125k
    // entries at load, and cloning once per field would triple the
    // allocation churn. The clone (rather than mutation) is what keeps the
    // module-level SEED_ENTRIES objects immutable across reload().
    const patch: Partial<DictionaryEntry> = {};

    // Backfill HSK level metadata from the generated hskMap when the
    // entry has none of its own. Seed entries that already carry an
    // explicit `hsk` are NOT overwritten — they win per the project's
    // "existing HSK 1-3 data has priority" rule. CC-CEDICT entries
    // (which never carry HSK) get filled here so the downloaded
    // dictionary picks up HSK 1-6 categorization without us modifying
    // the dictionary file on disk.
    if (!e.hsk) {
      const level = HSK_MAP[e.simplified];
      if (level) patch.hsk = { source: HSK_SOURCE, levels: [String(level)] };
    }

    // Repair pinyin written by an older build: -iu tone marks on the wrong
    // vowel (jǐu -> jiǔ) and ü syllables left with a bare tone digit
    // (nü3 -> nǚ). Key-safe — see repairPinyin's contract.
    const repaired = repairPinyin(e.pinyin);
    if (repaired !== e.pinyin) patch.pinyin = repaired;

    // CC-CEDICT records Taiwan readings as a trailing "Taiwan pr. [le4 se4]"
    // gloss. Lift it into a real field; the gloss stays in definitions[] so
    // the popup still shows it.
    if (!e.pinyinTaiwan) {
      const tw = extractTaiwanReading(e.definitions);
      if (tw) patch.pinyinTaiwan = tw;
    }

    if (Object.keys(patch).length > 0) e = { ...e, ...patch };
    const s = this.bySimplified.get(e.simplified) ?? [];
    s.push(e);
    this.bySimplified.set(e.simplified, s);
    if (e.traditional && e.traditional !== e.simplified) {
      const t = this.byTraditional.get(e.traditional) ?? [];
      t.push(e);
      this.byTraditional.set(e.traditional, t);
    }
  }

  /**
   * True when `ch` is written only in Traditional — it appears as a
   * traditional form and is never itself a simplified headword.
   *
   * Deliberately excludes characters like 台, 只 and 后, which ARE
   * simplified headwords and so carry no evidence either way despite being
   * common in Taiwan writing. See `scriptDetect.ts`.
   */
  isTraditionalMarker(ch: string): boolean {
    return this.byTraditional.has(ch) && !this.bySimplified.has(ch);
  }

  /** True if any entry exists for surface (simplified or traditional). */
  has(surface: string): boolean {
    if (this.getCustomWords()[surface]) return true;
    return this.bySimplified.has(surface) || this.byTraditional.has(surface);
  }

  /** Returns native dictionary entries WITHOUT user overrides or custom words applied. */
  lookupRaw(surface: string): DictionaryEntry[] {
    return this.native(surface);
  }

  /**
   * Native entries for a surface, simplified-map entries FIRST.
   *
   * The ordering is load-bearing and must never depend on a setting:
   * `VocabularyStore.ensure()` derives its canonical key from
   * `lookup(surface)[0].simplified`, so if `[0]` could move, every record
   * for the 66 surfaces that are both a simplified headword and someone
   * else's traditional form (著, 乾, 宁, 於 …) would be re-keyed whenever
   * the user toggled the script.
   *
   * Appending the traditional-map entries rather than the previous
   * `simplified ?? traditional` recovers the senses that were silently
   * dropped for those 66 surfaces, while leaving `[0]` exactly as it was.
   */
  private native(surface: string): DictionaryEntry[] {
    const simplified = this.bySimplified.get(surface);
    const traditional = this.byTraditional.get(surface);
    if (!traditional) return simplified ?? [];
    if (!simplified) return traditional;
    return [...simplified, ...traditional.filter((e) => !simplified.includes(e))];
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
    const native = this.native(surface);
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
        pinyinTaiwan: ov.pinyinTaiwan ?? e.pinyinTaiwan,
        traditional: ov.traditional ?? e.traditional,
        definitions: ov.definitions ?? e.definitions,
        hsk: ov.hsk ?? e.hsk,
        grammar: ov.grammar ?? e.grammar,
      });
    }
    return out;
  }

  /**
   * Every surface the tokenizer should be able to match — native entries
   * plus user-added custom words. This is the sole feed for the trie.
   *
   * `includeTraditional` is a UNION, not a swap: Traditional readers still
   * meet Simplified text, and a vault holding both kinds of note has to keep
   * working without a per-note switch. It defaults to off so an upgrading
   * Simplified user gets a bit-identical trie.
   *
   * Cost of the union, measured on the 125k-entry CC-CEDICT build:
   * 121,275 -> 198,106 keys, trie build 26 ms -> 42 ms, heap 44 MB -> 68 MB.
   */
  *surfaces(opts: { includeTraditional?: boolean } = {}): IterableIterator<string> {
    const seen = new Set<string>();
    for (const s of this.bySimplified.keys()) {
      seen.add(s);
      yield s;
    }
    if (opts.includeTraditional) {
      for (const t of this.byTraditional.keys()) {
        if (seen.has(t)) continue;
        seen.add(t);
        yield t;
      }
    }
    for (const [surface, word] of Object.entries(this.getCustomWords())) {
      if (!seen.has(surface)) {
        seen.add(surface);
        yield surface;
      }
      if (opts.includeTraditional && word.traditional && !seen.has(word.traditional)) {
        seen.add(word.traditional);
        yield word.traditional;
      }
    }
  }

  /**
   * How many distinct traditional forms the dictionary knows for a surface.
   *
   * Used to decide whether showing "the traditional form" is even meaningful.
   * 1,078 simplified headwords map to more than one — 发 is 發 or 髮, 干 is
   * 乾 or 幹, 复 is 復/複/覆 — and CC-CEDICT orders entries by codepoint
   * rather than frequency, so picking the first would routinely surface an
   * obsolete variant (干 -> 乹, 历 -> 厤). Anything above 1 means "do not
   * guess".
   */
  distinctTraditionalForms(surface: string): number {
    const forms = new Set<string>();
    for (const e of this.lookup(surface)) {
      if (e.traditional && e.traditional !== e.simplified) forms.add(e.traditional);
    }
    return forms.size;
  }

  /** All entries combined (simplified + traditional-only). */
  *allEntries(): IterableIterator<DictionaryEntry> {
    for (const arr of this.bySimplified.values()) for (const e of arr) yield e;
  }

  size(): number {
    return this.bySimplified.size;
  }
}
