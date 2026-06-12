import { ColorState, KnownAxes, WordRecord, WordStatus } from "./VocabularyTypes";
import { ColorMode } from "../settings/types";

/**
 * Class-key suffix used by `cci-color-${key}`. Status keys mirror ColorState;
 * HSK keys cover levels 1..7 and a `hsk-none` fallback for words missing an
 * HSK entry (or filtered out by the user's HSK source selection).
 */
export type ColorClassKey =
  | "known"
  | "partial"
  | "unknown"
  | "new"
  | "ignored"
  | "hsk-1"
  | "hsk-2"
  | "hsk-3"
  | "hsk-4"
  | "hsk-5"
  | "hsk-6"
  | "hsk-7"
  | "hsk-none";

type HskSourceFilter = "2.0" | "3.0" | "both";

/**
 * Mode-aware color resolution. Status mode delegates to `colorOf` (and
 * therefore preserves the existing show/hide gating elsewhere). HSK mode
 * walks `rec.hsk.levels` and picks the lowest numeric level (lower HSK =
 * more common word). Levels above 7 collapse into level 7; missing or
 * source-mismatched HSK data falls through to `hsk-none`.
 */
export function colorClassKey(
  rec: WordRecord | undefined,
  mode: ColorMode,
  hskSource: HskSourceFilter
): ColorClassKey {
  if (mode === "status") return colorOf(rec);
  if (!rec) return "hsk-none";
  const hsk = rec.hsk;
  if (!hsk || !hsk.levels || hsk.levels.length === 0) return "hsk-none";
  if (hskSource !== "both" && hsk.source && hsk.source !== hskSource) {
    return "hsk-none";
  }
  let lowest = Infinity;
  for (const raw of hsk.levels) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (n < lowest) lowest = n;
  }
  if (!Number.isFinite(lowest)) return "hsk-none";
  const clamped = Math.min(7, Math.max(1, lowest));
  return (`hsk-${clamped}` as ColorClassKey);
}

/** Compute a stable derived status from explicit axes. */
export function statusFromAxes(axes: KnownAxes): WordStatus {
  const { chars, pinyin, meaning } = axes;
  if (chars && pinyin && meaning) return "known";
  if (!chars && !pinyin && !meaning) return "unknown";
  if (chars && pinyin && !meaning) return "pinyinKnownMeaningUnknown";
  if (chars && !pinyin && meaning) return "meaningKnownPinyinUnknown";
  if (!chars && pinyin && meaning) return "charactersUnknown";
  // Other partial combos collapse to the closest existing status.
  if (chars && !pinyin && !meaning) return "unknown";
  if (!chars && pinyin && !meaning) return "pinyinKnownMeaningUnknown";
  if (!chars && !pinyin && meaning) return "meaningKnownPinyinUnknown";
  return "unknown";
}

/** Reverse direction: best-effort axes from a legacy status only. */
export function axesFromStatus(status: WordStatus): KnownAxes | undefined {
  switch (status) {
    case "known":
      return { chars: true, pinyin: true, meaning: true };
    case "unknown":
      return { chars: false, pinyin: false, meaning: false };
    case "meaningKnownPinyinUnknown":
      return { chars: true, pinyin: false, meaning: true };
    case "pinyinKnownMeaningUnknown":
      return { chars: true, pinyin: true, meaning: false };
    case "charactersUnknown":
      return { chars: false, pinyin: true, meaning: true };
    case "ignored":
    case "new":
      return undefined;
  }
}

/** Map a record to the coarse color/state used for rendering. */
export function colorOf(rec: WordRecord | undefined): ColorState {
  if (!rec) return "new";
  if (rec.status === "ignored") return "ignored";
  if (rec.status === "new") return "new";
  const axes = rec.axes ?? axesFromStatus(rec.status);
  if (!axes) return "new";
  const score = (axes.chars ? 1 : 0) + (axes.pinyin ? 1 : 0) + (axes.meaning ? 1 : 0);
  if (score === 3) return "known";
  if (score === 0) return "unknown";
  return "partial";
}
