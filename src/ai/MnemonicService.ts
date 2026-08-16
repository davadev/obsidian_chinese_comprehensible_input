import { AiProviderService } from "./AiProviderService";
import { CciSettings } from "../settings/types";
import {
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  MnemonicPromptArgs,
  buildMnemonicUserPrompt,
} from "./prompts";

export type MnemonicInput = MnemonicPromptArgs;

export interface MnemonicResult {
  /** The memory hook itself. Always present. */
  mnemonic: string;
  /** Optional longer scene the model volunteered. */
  story?: string;
}

/** Max chars kept from the model. The system prompt asks for 1-3
 *  sentences / one short paragraph — these are runaway guards, not the
 *  intended shape. Both fields are shown verbatim in the popup and the
 *  preview modal, so an unbounded response would wreck the layout. */
const MNEMONIC_MAX_CHARS = 600;
const STORY_MAX_CHARS = 2000;

/**
 * Generates a mnemonic for a single word (#49). Same one-prompt /
 * one-parse call pattern as `EnhanceDictionaryService` — the response is
 * two short strings, so the multi-tier salvage of `parseStory` is not
 * needed. The user-facing prompt template comes from settings so the
 * result can be personalised.
 */
export class MnemonicService {
  constructor(
    private ai: AiProviderService,
    private settings: () => CciSettings
  ) {}

  async generate(input: MnemonicInput): Promise<MnemonicResult> {
    const template = this.settings().ai.mnemonicPrompt ?? "";
    const user = buildMnemonicUserPrompt(template, input);
    const raw = await this.ai.chatJson(
      MNEMONIC_SYSTEM_PROMPT,
      user,
      "Mnemonic",
      MNEMONIC_SCHEMA
    );
    return parseMnemonicResult(raw);
  }
}

/** Pull the first balanced `{ … }` block out of `raw` and JSON.parse it.
 *  Tolerant of leading prose or markdown fences (the system prompt asks
 *  for neither, but local LLMs sometimes ignore that). Throws a
 *  human-readable Error on failure. */
function parseMnemonicResult(raw: string): MnemonicResult {
  const trimmed = raw.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AI did not return a JSON object for the mnemonic.");
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
  const mnemonic = typeof obj.mnemonic === "string" ? obj.mnemonic.trim() : "";
  if (!mnemonic) {
    throw new Error("AI response is missing the required \"mnemonic\" text.");
  }
  const result: MnemonicResult = { mnemonic: clamp(mnemonic, MNEMONIC_MAX_CHARS) };
  if (typeof obj.story === "string") {
    const story = obj.story.trim();
    if (story) result.story = clamp(story, STORY_MAX_CHARS);
  }
  return result;
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Exported only for the unit tests in src/tests. */
export const __testing = { parseMnemonicResult };
