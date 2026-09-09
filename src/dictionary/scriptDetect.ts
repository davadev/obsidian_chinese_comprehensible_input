import type { DictionaryService } from "./DictionaryService";

/**
 * Detecting that text is Traditional, conservatively and in one direction.
 *
 * The signal is characters that appear in the dictionary as a traditional
 * form and never as a simplified headword — 灣, 學, 圖, 氣, 熱 and ~3,600
 * others. Their presence is strong evidence; their absence proves nothing.
 *
 * The symmetric test does NOT work and must not be added: 台, 只, 后 and 里
 * are simplified forms of 臺, 隻, 後 and 裡 yet are entirely normal in
 * Taiwan writing, so scoring "looks simplified" misfires badly — a pure
 * Traditional paragraph scores 7 traditional against 4 simplified, and
 * 你好我是人今天 reads as simplified. Measured the other way round, the
 * asymmetric rule below produced zero false positives on every simplified
 * sample tried.
 */
export interface ScriptDetector {
  isTraditionalMarker(ch: string): boolean;
}

/** Minimum distinct marker characters before we believe it. Two would fire
 *  on an incidental quotation; three is enough to mean the note is written
 *  in Traditional. */
export const TRADITIONAL_MARKER_THRESHOLD = 3;

export function countTraditionalMarkers(
  text: string,
  dict: Pick<DictionaryService, "isTraditionalMarker">
): number {
  const seen = new Set<string>();
  for (const ch of text) {
    if (seen.has(ch)) continue;
    if (dict.isTraditionalMarker(ch)) seen.add(ch);
  }
  return seen.size;
}

export function looksTraditional(
  text: string,
  dict: Pick<DictionaryService, "isTraditionalMarker">
): boolean {
  return countTraditionalMarkers(text, dict) >= TRADITIONAL_MARKER_THRESHOLD;
}
