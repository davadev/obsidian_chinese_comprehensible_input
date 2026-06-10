import { ColorState, KnownAxes, WordRecord, WordStatus } from "./VocabularyTypes";

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
