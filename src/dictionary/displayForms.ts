import { DictionaryEntry } from "./DictionaryTypes";
import type { DictionaryService } from "./DictionaryService";
import type { PronunciationRegion, ScriptVariant } from "../settings/types";

/** The shape both `WordRecord` and a dictionary entry satisfy well enough
 *  to pick a display surface from. Kept structural so this module stays
 *  free of a vocabulary import. */
export interface SurfaceSource {
  surfaces?: string[];
  simplified?: string;
  traditional?: string;
}

export interface PinyinSource {
  pinyin?: string;
  pinyinTaiwan?: string;
}

/**
 * Which reading to show.
 *
 * Taiwan falls back to the Mainland reading whenever CC-CEDICT records no
 * Taiwan-specific one, which is the case for all but ~500 words. Note this
 * covers idiosyncratic re-readings (垃圾 lè sè) and NOT the systematic
 * neutral-tone difference (謝謝 xièxiè, 東西 dōngxī), which CC-CEDICT
 * simply does not record.
 *
 * `entry` wins over `record` because a WordRecord's pinyin is a snapshot
 * taken when the word was first met — it predates both the tone repair and
 * the Taiwan field.
 */
export function displayPinyin(
  entry: PinyinSource | undefined,
  record: PinyinSource | undefined,
  region: PronunciationRegion
): string {
  if (region === "taiwan") {
    const taiwan = entry?.pinyinTaiwan ?? record?.pinyinTaiwan;
    if (taiwan) return taiwan;
  }
  return entry?.pinyin ?? record?.pinyin ?? "";
}

/**
 * Which written form to show for a word the learner has met.
 *
 * This NEVER converts between scripts. It returns a form the learner has
 * actually encountered, preferring one that matches the script they read in.
 *
 * Converting is not a safe alternative: 1,078 simplified headwords map to
 * more than one traditional form, CC-CEDICT orders entries by codepoint
 * rather than frequency, and `frequencyRank` is never populated — so taking
 * the first candidate's `traditional` yields 发 -> 發 (wrong for 头发/hair),
 * 干 -> 乹 and 历 -> 厤 (obsolete variants nobody writes), and 里 -> 裏 (the
 * Hong Kong form where Taiwan writes 裡). Drilling a learner on those would
 * teach characters they will never meet.
 *
 * So: show what they read. A word only ever seen in Simplified stays
 * Simplified even in Traditional mode, which is also consistent with the
 * plugin never rewriting note text.
 */
export function displaySurface(
  record: SurfaceSource,
  script: ScriptVariant,
  dict?: Pick<DictionaryService, "distinctTraditionalForms">
): string {
  const surfaces = record.surfaces ?? [];
  const fallback = record.simplified ?? surfaces[0] ?? "";
  if (script !== "traditional") {
    // Prefer a surface known to be the simplified form; otherwise whatever
    // was seen first.
    return record.simplified ?? surfaces[0] ?? "";
  }
  // A surface the learner actually met that is this word's traditional form.
  if (record.traditional && surfaces.includes(record.traditional)) return record.traditional;
  // Otherwise only offer the traditional form when it is unambiguous, and
  // even then only if we were given a dictionary to confirm that with.
  if (record.traditional && record.traditional !== record.simplified && dict) {
    const source = record.simplified ?? surfaces[0];
    if (source && dict.distinctTraditionalForms(source) === 1) return record.traditional;
  }
  return fallback;
}

/**
 * The counterpart form to show as a secondary line, or undefined when there
 * is nothing trustworthy to show. Same ambiguity rule as `displaySurface`.
 */
export function counterpartSurface(
  entry: DictionaryEntry | undefined,
  shown: string,
  script: ScriptVariant,
  dict?: Pick<DictionaryService, "distinctTraditionalForms">
): { label: string; value: string } | undefined {
  if (!entry) return undefined;
  if (script === "traditional") {
    if (!entry.simplified || entry.simplified === shown) return undefined;
    return { label: "Simplified", value: entry.simplified };
  }
  if (!entry.traditional || entry.traditional === shown) return undefined;
  if (dict && dict.distinctTraditionalForms(entry.simplified) > 1) return undefined;
  return { label: "Traditional", value: entry.traditional };
}
