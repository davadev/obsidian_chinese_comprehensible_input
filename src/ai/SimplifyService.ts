import { AiProviderService } from "./AiProviderService";
import { extractJsonObject } from "./jsonReply";
import { NO_CUSTOM, PromptCustom, SIMPLIFY_SYSTEM_PROMPT, buildExplainRepairPrompt, buildSimplifyUserPrompt, systemPromptWith } from "./prompts";
import { Candidate, Measured, SIMPLIFY_SCHEMA, SimplifyResult, normaliseSimplify, rankCandidates, usableCandidates, validateSimplify } from "./simplify";

/** A measured candidate with the model's note on what it changes. */
export interface ScoredCandidate extends Measured {
  change: string;
}

export interface SimplifyOutcome {
  original: Measured;
  /** Every usable candidate, simplest first. */
  ranked: ScoredCandidate[];
  /** The simplest candidate, only when it is strictly simpler than the original. */
  best: ScoredCandidate | null;
  /** What the plugin could see was wrong even after one repair attempt; the learner is told, never shown it as fact. */
  issues: string[];
}

/**
 * Simplify a selection (#238): ask for candidates, check them, measure each against the HSK lists and the learner's
 * vocabulary, rank. The model writes; the plugin decides which is simplest.
 */
export class SimplifyService {
  constructor(
    private ai: AiProviderService,
    private measure: (text: string) => Promise<Measured>,
    private isTraditional: (text: string) => boolean,
    private custom: () => PromptCustom = () => NO_CUSTOM
  ) {}

  async simplify(text: string): Promise<SimplifyOutcome> {
    const user = buildSimplifyUserPrompt(text);
    let result = await this.ask(user);
    let issues = validateSimplify(result, text, this.isTraditional);
    if (issues.length > 0) {
      const again = await this.ask(`${user}\n\n${buildExplainRepairPrompt(issues)}`).catch(() => null);
      if (again) {
        const remaining = validateSimplify(again, text, this.isTraditional);
        if (remaining.length <= issues.length) {
          result = again;
          issues = remaining;
        }
      }
    }
    const original = await this.measure(text);
    const scored: ScoredCandidate[] = [];
    for (const c of usableCandidates(result, text, this.isTraditional)) scored.push(await this.score(c));
    const { ranked, best } = rankCandidates(original, scored);
    return { original, ranked, best, issues };
  }

  private async score(c: Candidate): Promise<ScoredCandidate> {
    return { ...(await this.measure(c.text)), change: c.change };
  }

  private async ask(user: string): Promise<SimplifyResult> {
    const raw = await this.ai.chatJson(systemPromptWith(SIMPLIFY_SYSTEM_PROMPT, this.custom()), user, "Simplify", SIMPLIFY_SCHEMA, true);
    return normaliseSimplify(extractJsonObject(raw, "simplifying"));
  }
}
