import { AiProviderService } from "./AiProviderService";
import { CciSettings } from "../settings/types";
import {
  MnemonicParts,
  WordShape,
  assembleLine,
  repairStoryPinyin,
  validateParts,
  wordShape,
} from "./mnemonicFacts";
import {
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  MnemonicPromptArgs,
  buildMnemonicFactsBlock,
  buildMnemonicRepairPrompt,
  buildMnemonicUserPrompt,
} from "./prompts";

export type MnemonicInput = MnemonicPromptArgs;

export interface MnemonicResult {
  /** The short emoji line, assembled by the app. Always present. */
  mnemonic: string;
  /** The prose that unpacks the emoji line, with the word's own pinyin written by the app. */
  story?: string;
  /** What the app could not get right even after one repair; shown to the user, never hidden. */
  notes?: string[];
}

/** Runaway guard for the story. The system prompt asks for one short
 *  paragraph; this only stops a model that ignores that from wrecking the
 *  card layout. The emoji line is bounded by
 *  `MNEMONIC_LINE_MAX_GRAPHEMES` instead — see `mnemonicText.ts` for why
 *  it is counted in graphemes rather than chars. */
const STORY_MAX_CHARS = 2000;

interface ParsedAnswer extends MnemonicParts {
  story: string;
}

/**
 * Generates a mnemonic for a single word (#49, harness #185).
 *
 * The model returns one picture group per character and a story. The app works out
 * everything it can itself: it lists the characters with their tones in the request, checks the answer against the
 * same facts, asks once more if a rule was broken, then writes the emoji line (each group followed by its tone
 * number) and the word's own pinyin in the story. The user-facing prompt template still comes from settings so the
 * result can be personalised; the facts are appended whatever the template says.
 */
export class MnemonicService {
  constructor(
    private ai: AiProviderService,
    private settings: () => CciSettings
  ) {}

  async generate(input: MnemonicInput): Promise<MnemonicResult> {
    const shape = wordShape(input.surface, input.pinyin);
    const template = this.settings().ai.mnemonicPrompt;
    const user = `${buildMnemonicUserPrompt(template, input)}\n\n${buildMnemonicFactsBlock(shape, input.charGlosses)}`;
    let answer = parseMnemonicAnswer(
      await this.ai.chatJson(MNEMONIC_SYSTEM_PROMPT, user, "Mnemonic", MNEMONIC_SCHEMA, true)
    );
    let issues = validateParts(answer, shape);
    if (issues.length > 0) {
      const again = await this.repair(user, issues);
      if (again) {
        const remaining = validateParts(again, shape);
        // Keep the repair only if it is no worse than the first answer.
        if (remaining.length <= issues.length) {
          answer = again;
          issues = remaining;
        }
      }
    }
    return finish(answer, shape, issues);
  }

  /** One extra try with the specific defects. A failure here must not cost the user the first answer. */
  private async repair(user: string, issues: string[]): Promise<ParsedAnswer | null> {
    try {
      return parseMnemonicAnswer(
        await this.ai.chatJson(
          MNEMONIC_SYSTEM_PROMPT,
          `${user}\n\n${buildMnemonicRepairPrompt(issues)}`,
          "Mnemonic",
          MNEMONIC_SCHEMA,
          true
        )
      );
    } catch {
      return null;
    }
  }
}

function finish(answer: ParsedAnswer, shape: WordShape, issues: string[]): MnemonicResult {
  const result: MnemonicResult = { mnemonic: assembleLine(answer, shape) };
  // A name has no picture story, so if the model left the sentence out the app says it plainly.
  const raw = answer.isName && !answer.story.trim() ? nameStory(shape) : answer.story;
  const story = repairStoryPinyin(raw, shape).trim();
  if (story) result.story = clamp(story, STORY_MAX_CHARS);
  if (issues.length > 0) result.notes = issues;
  return result;
}

function nameStory(shape: WordShape): string {
  return `${shape.chars.join("")}${shape.syllables ? ` (${shape.syllables.join(" ")})` : ""} is a name here.`;
}

/** Pull the first balanced `{ … }` block out of `raw` and JSON.parse it.
 *  Tolerant of leading prose or markdown fences (the system prompt asks
 *  for neither, but local LLMs sometimes ignore that). Throws a
 *  human-readable Error on failure. */
function parseMnemonicAnswer(raw: string): ParsedAnswer {
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
  // The slice starts at "{", so it parses to an object or throws above.
  const obj = parsed as Record<string, unknown>;
  const groups = Array.isArray(obj.characters) ? obj.characters : null;
  if (!groups || !groups.every((g) => typeof g === "string")) {
    throw new Error("AI response is missing the required \"characters\" list.");
  }
  return {
    isName: obj.isName === true,
    characters: groups,
    story: typeof obj.story === "string" ? obj.story : "",
  };
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Exported only for the unit tests in src/tests. */
export const __testing = { parseMnemonicAnswer };
