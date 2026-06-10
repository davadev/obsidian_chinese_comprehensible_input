import { DictionaryEntry } from "./DictionaryTypes";
import { HskSource } from "../settings/types";

export function hskLevelsFor(entry: DictionaryEntry | undefined, source: HskSource): string[] {
  if (!entry?.hsk) return [];
  if (source === "both") return entry.hsk.levels;
  if (entry.hsk.source.startsWith(source)) return entry.hsk.levels;
  return [];
}

export function maxHskLevel(levels: string[]): number {
  let max = 0;
  for (const l of levels) {
    const n = parseInt(l, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}
