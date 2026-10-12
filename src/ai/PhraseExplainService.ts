import { AiProviderService } from "./AiProviderService";
import { extractJsonObject } from "./jsonReply";
import {
  PHRASE_CHECK_SCHEMA,
  PHRASE_SCHEMA,
  PhraseCheck,
  PhraseResult,
  normalisePhrase,
  normalisePhraseCheck,
  validatePhrase,
} from "./phrase";
import {
  PHRASE_CHECK_SYSTEM_PROMPT,
  PHRASE_SYSTEM_PROMPT,
  buildExplainRepairPrompt,
  buildPhraseCheckUserPrompt,
  buildPhraseUserPrompt,
} from "./prompts";

export interface PhraseOutcome {
  result: PhraseResult;
  /** What the plugin could see was wrong even after one repair attempt; shown to the learner, never hidden. */
  issues: string[];
}

/**
 * Explains a phrase (#186): a small call first to see whether the text is generally correct, then the explanation itself.
 * The two calls are separate on purpose: the check is cheap and fast, and it stops the plugin explaining broken grammar as
 * if it were right.
 */
export class PhraseExplainService {
  constructor(private ai: AiProviderService) {}

  async check(text: string): Promise<PhraseCheck> {
    const raw = await this.ai.chatJson(PHRASE_CHECK_SYSTEM_PROMPT, buildPhraseCheckUserPrompt(text), "PhraseCheck", PHRASE_CHECK_SCHEMA);
    return normalisePhraseCheck(extractJsonObject(raw, "phrase check"));
  }

  /** `typo` is the one-line description from the check, when it found one. */
  async explain(text: string, typo?: string): Promise<PhraseOutcome> {
    const user = buildPhraseUserPrompt({ text, typo });
    let result = await this.ask(user);
    let issues = validatePhrase(result, text);
    if (issues.length > 0) {
      const again = await this.ask(`${user}\n\n${buildExplainRepairPrompt(issues)}`).catch(() => null);
      if (again) {
        const remaining = validatePhrase(again, text);
        // Keep the repair only if it is no worse than the first answer.
        if (remaining.length <= issues.length) {
          result = again;
          issues = remaining;
        }
      }
    }
    return { result, issues };
  }

  private async ask(user: string): Promise<PhraseResult> {
    const raw = await this.ai.chatJson(PHRASE_SYSTEM_PROMPT, user, "PhraseExplain", PHRASE_SCHEMA);
    return normalisePhrase(extractJsonObject(raw, "explanation"));
  }
}
