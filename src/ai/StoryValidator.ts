import { TokenizerService } from "../tokenizer/TokenizerService";
import { maxHskLevel } from "../dictionary/hskOverlay";
import { GeneratedStory, ValidationReport } from "./aiTypes";

export interface ValidatorConfig {
  targetHsk: number; // 1..6, 0 = any
  lengthChars: number;
  tooHardRatioCap: number; // e.g., 0.15
}

export async function validateStory(
  story: GeneratedStory,
  targetWords: string[],
  tokenizer: TokenizerService,
  cfg: ValidatorConfig
): Promise<ValidationReport> {
  const text = story.textChinese;
  const tokens = await tokenizer.tokenize(text);

  const wordSet = new Set<string>();
  const tooHardWords = new Set<string>();
  let cjkChars = 0;
  let englishChars = 0;
  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) englishChars++;
    else if (/[一-鿿]/.test(ch)) cjkChars++;
  }
  for (const t of tokens) {
    if (!t.isWord) continue;
    wordSet.add(t.surface);
    const hsk = maxHskLevel(t.selected?.hsk?.levels ?? []);
    if (cfg.targetHsk > 0 && hsk > 0 && hsk > cfg.targetHsk + 1 && !targetWords.includes(t.surface)) {
      tooHardWords.add(t.surface);
    }
  }

  const missing = targetWords.filter((w) => !text.includes(w));
  const englishRatio = englishChars + cjkChars === 0 ? 0 : englishChars / (englishChars + cjkChars);
  const lengthOk = Math.abs(text.length - cfg.lengthChars) <= cfg.lengthChars * 0.5;

  const score =
    1 -
    (missing.length / Math.max(1, targetWords.length)) * 0.6 -
    Math.min(0.3, tooHardWords.size / 50) -
    (englishRatio > 0.1 ? 0.2 : 0);

  const ok = missing.length === 0 && englishRatio <= 0.1 && tooHardWords.size <= 10;

  const notes: string[] = [];
  if (missing.length) notes.push(`Missing target words: ${missing.join(", ")}`);
  if (tooHardWords.size) notes.push(`${tooHardWords.size} potentially too-hard words`);
  if (englishRatio > 0.1) notes.push(`Too much English content: ${(englishRatio * 100).toFixed(1)}%`);
  if (!lengthOk) notes.push(`Length out of range: ${text.length} vs target ${cfg.lengthChars}`);

  return {
    ok,
    missingWords: missing,
    tooHardWords: Array.from(tooHardWords),
    englishRatio,
    lengthOk,
    score: Math.max(0, Math.min(1, score)),
    notes,
  };
}
