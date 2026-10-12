import { AiProviderService } from "./AiProviderService";
import {
  EXPLAIN_SCHEMA,
  ExplainContext,
  ExplainResult,
  normaliseExplain,
  validateExplain,
} from "./explain";
import {
  EXPLAIN_SYSTEM_PROMPT,
  ExplainPromptArgs,
  NO_CUSTOM,
  PromptCustom,
  systemPromptWith,
  buildExplainRepairPrompt,
  buildExplainUserPrompt,
} from "./prompts";
import { isHanChar } from "./mnemonicFacts";

export type ExplainInput = ExplainPromptArgs;

export interface ExplainOutcome {
  result: ExplainResult;
  /** What the plugin could see was wrong even after one repair attempt; shown to the learner, never hidden. */
  issues: string[];
}

/**
 * Writes the Explain note for one word (#186). Same shape as the mnemonic service: one request, a check against facts the
 * plugin already has, one repair attempt with the specific defects, then the best answer with the remaining problems
 * attached so the dialog can say what is off instead of presenting a silently worse note.
 */
export class ExplainService {
  constructor(
    private ai: AiProviderService,
    private custom: () => PromptCustom = () => NO_CUSTOM
  ) {}

  async generate(input: ExplainInput): Promise<ExplainOutcome> {
    const user = buildExplainUserPrompt(input);
    const ctx = contextFor(input);
    const system = systemPromptWith(EXPLAIN_SYSTEM_PROMPT, this.custom());
    let result = withRadicals(parse(await this.ai.chatJson(system, user, "Explain", EXPLAIN_SCHEMA, true)), input);
    let issues = validateExplain(result, ctx);
    if (issues.length > 0) {
      const again = await this.repair(system, user, issues, input);
      if (again) {
        const remaining = validateExplain(again, ctx);
        // Keep the repair only if it is no worse than the first answer.
        if (remaining.length <= issues.length) {
          result = again;
          issues = remaining;
        }
      }
    }
    return { result, issues };
  }

  /** One extra try. A failure here must not cost the learner the first answer. */
  private async repair(system: string, user: string, issues: string[], input: ExplainInput): Promise<ExplainResult | null> {
    try {
      return withRadicals(
        parse(
          await this.ai.chatJson(system, `${user}\n\n${buildExplainRepairPrompt(issues)}`, "Explain", EXPLAIN_SCHEMA, true)
        ),
        input
      );
    } catch {
      return null;
    }
  }
}

/** The written forms an example may use, and how many characters the word has. */
export function contextFor(input: ExplainInput): ExplainContext {
  const forms = [input.surface];
  if (input.traditional && input.traditional !== input.surface) forms.push(input.traditional);
  return { forms, charCount: Array.from(input.surface).filter(isHanChar).length };
}

/** Pull the first balanced `{ … }` block out of `raw` and read it. Tolerant of prose and code fences around it. */
/**
 * Each character's radical comes from the plugin's own lookup (Unicode Unihan), matched by position, whatever the model
 * wrote. A model answering from memory gets radicals and decompositions wrong; the lookup does not.
 */
function withRadicals(result: ExplainResult, input: ExplainInput): ExplainResult {
  return {
    ...result,
    // The character itself is a fact too: a model that leaves it out (it did, once the radical fields were gone) is filled in.
    characters: result.characters.map((c, i) => ({ ...c, character: c.character || (input.chars[i]?.char ?? ""), radical: input.chars[i]?.radical ?? "" })),
  };
}

function parse(raw: string): ExplainResult {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI did not return a JSON object for the explanation.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(first, last + 1));
  } catch (err) {
    throw new Error(`Could not parse AI JSON: ${(err as Error).message}`);
  }
  return normaliseExplain(parsed);
}

/** Exported only for the unit tests in src/tests. */
export const __testing = { parse };
