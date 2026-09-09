import type { AiScript } from "./prompts";
import { TokenizerService } from "../tokenizer/TokenizerService";
import { maxHskLevel } from "../dictionary/hskOverlay";
import { GeneratedStory, ValidationReport } from "./aiTypes";

export interface ValidatorConfig {
  targetHsk: number; // 1..6, 0 = any
  lengthChars: number;
  tooHardRatioCap: number; // e.g., 0.15
  /** Script the story was asked for. When "traditional", a story containing
   *  no traditional-only characters is flagged as having ignored the
   *  instruction. */
  script?: AiScript;
  /** Counts distinct traditional-only characters. Supplied by the caller so
   *  this module stays free of a DictionaryService import. */
  countTraditionalMarkers?: (text: string) => number;
}

/** A target word plus every written form that should count as a hit. */
export interface TargetForms {
  display: string;
  forms: string[];
}

export async function validateStory(
  story: GeneratedStory,
  targets: Array<string | TargetForms>,
  tokenizer: TokenizerService,
  cfg: ValidatorConfig
): Promise<ValidationReport> {
  const text = story.textChinese;
  const tokens = await tokenizer.tokenize(text);
  // A target counts as present in EITHER script regardless of which one was
  // requested, so a model that ignores the script instruction is still
  // scored on whether it used the word.
  const normalised: TargetForms[] = targets.map((t) =>
    typeof t === "string" ? { display: t, forms: [t] } : t
  );
  const targetWords = normalised.map((t) => t.display);

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

  const missing = normalised.filter((t) => !t.forms.some((f) => text.includes(f))).map((t) => t.display);

  // Script check, in the only direction that is reliable. Testing for the
  // ABSENCE of simplified characters does not work — 台, 只, 后 and 里 are
  // simplified headwords yet entirely normal in Traditional writing. Testing
  // for the PRESENCE of traditional-only characters does.
  //
  // The trigger is ZERO markers across the whole story, which a text of the
  // lengths this feature generates essentially never hits by accident, so it
  // is safe to fail the report on and let the repair loop try again — capped
  // by maxRepairIterations either way. Anything less than failing it would be
  // inert: nothing reads `notes`.
  const wrongScript =
    cfg.script === "traditional" &&
    !!cfg.countTraditionalMarkers &&
    cfg.countTraditionalMarkers(text) === 0;
  const englishRatio = englishChars + cjkChars === 0 ? 0 : englishChars / (englishChars + cjkChars);
  const lengthOk = Math.abs(text.length - cfg.lengthChars) <= cfg.lengthChars * 0.5;

  const score =
    1 -
    (missing.length / Math.max(1, targetWords.length)) * 0.6 -
    Math.min(0.3, tooHardWords.size / 50) -
    (englishRatio > 0.1 ? 0.2 : 0) -
    (wrongScript ? 0.2 : 0);

  const ok =
    missing.length === 0 && englishRatio <= 0.1 && tooHardWords.size <= 10 && !wrongScript;

  const notes: string[] = [];
  if (missing.length) notes.push(`Missing target words: ${missing.join(", ")}`);
  if (wrongScript) notes.push("Story appears to be in Simplified characters, but Traditional was requested");
  if (tooHardWords.size) notes.push(`${tooHardWords.size} potentially too-hard words`);
  if (englishRatio > 0.1) notes.push(`Too much English content: ${(englishRatio * 100).toFixed(1)}%`);
  if (!lengthOk) notes.push(`Length out of range: ${text.length} vs target ${cfg.lengthChars}`);

  return {
    ok,
    missingWords: missing,
    wrongScript,
    tooHardWords: Array.from(tooHardWords),
    englishRatio,
    lengthOk,
    score: Math.max(0, Math.min(1, score)),
    notes,
  };
}
