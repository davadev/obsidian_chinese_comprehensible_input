import { AiProviderService } from "./AiProviderService";
import { CciSettings } from "../settings/types";
import {
  ENHANCE_PINYIN_CLAUSE,
  ENHANCE_SYSTEM_PROMPT,
  buildEnhanceSchema,
  buildEnhanceUserPrompt,
} from "./prompts";

export interface EnhanceInput {
  surface: string;
  pinyin: string;
  traditional?: string;
  currentDefinitions: string[];
  sentence: string;
}

export interface EnhanceResult {
  definitions: string[];
  grammar?: string;
  pinyin?: string;
}

/** Max definitions accepted from the model. Anything beyond this is
 *  likely the model running away — trimmed to keep the popup readable. */
const MAX_DEFINITIONS = 8;

/** Max chars per definition. The system prompt asks for ≤80 — we clamp
 *  to a generous ceiling in case the model ignores the constraint. */
const DEFINITION_MAX_CHARS = 200;

/**
 * Rewrites a single CC-CEDICT dictionary entry to reflect the sense the
 * word carries in a specific sentence. Mirrors the call pattern of
 * `StoryGenerator` but trimmed to one prompt + one parse — the response
 * is small enough that the multi-tier salvage in `parseStory` is not
 * required.
 */
export class EnhanceDictionaryService {
  constructor(
    private ai: AiProviderService,
    private settings: () => CciSettings
  ) {}

  async enhance(input: EnhanceInput): Promise<EnhanceResult> {
    const allowPinyin = !!this.settings().ai.enhanceCanRewritePinyin;
    const system = allowPinyin
      ? ENHANCE_SYSTEM_PROMPT + ENHANCE_PINYIN_CLAUSE
      : ENHANCE_SYSTEM_PROMPT;
    const user = buildEnhanceUserPrompt(input);
    const schema = buildEnhanceSchema(allowPinyin);
    const raw = await this.ai.chatJson(system, user, "EnhanceDictionaryEntry", schema);
    return parseEnhanceResult(raw, allowPinyin);
  }
}

/** Pull the first balanced `{ … }` block out of `raw` and JSON.parse it.
 *  Tolerant of leading prose or markdown fences (the system prompt asks
 *  for neither, but local LLMs sometimes ignore that). Throws a
 *  human-readable Error on failure. */
function parseEnhanceResult(raw: string, allowPinyin: boolean): EnhanceResult {
  const trimmed = raw.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AI did not return a JSON object for the enhanced entry.");
  }
  const jsonSlice = trimmed.slice(firstBrace, lastBrace + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (err) {
    throw new Error(`Could not parse AI JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI JSON was not an object.");
  }
  const obj = parsed as Record<string, unknown>;
  const rawDefs = obj.definitions;
  if (!Array.isArray(rawDefs)) {
    throw new Error("AI response is missing the required \"definitions\" array.");
  }
  const definitions = rawDefs
    .filter((d): d is string => typeof d === "string")
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .map((d) => (d.length > DEFINITION_MAX_CHARS ? d.slice(0, DEFINITION_MAX_CHARS) : d))
    .slice(0, MAX_DEFINITIONS);
  if (definitions.length === 0) {
    throw new Error("AI returned no usable definitions.");
  }
  const result: EnhanceResult = { definitions };
  if (typeof obj.grammar === "string") {
    const g = obj.grammar.trim();
    if (g.length > 0) result.grammar = g;
  }
  if (allowPinyin && typeof obj.pinyin === "string") {
    const p = obj.pinyin.trim();
    if (p.length > 0) result.pinyin = p;
  }
  return result;
}

/** Exported only for the unit tests in src/tests. */
export const __testing = { parseEnhanceResult };
