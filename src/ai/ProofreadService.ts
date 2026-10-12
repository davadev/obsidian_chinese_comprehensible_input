import { AiProviderService } from "./AiProviderService";
import { extractJsonObject } from "./jsonReply";
import { PROOFREAD_SCHEMA, ProofreadResult, normaliseProofread, validateProofread } from "./proofread";
import { NO_CUSTOM, PROOFREAD_SYSTEM_PROMPT, PromptCustom, buildExplainRepairPrompt, buildProofreadUserPrompt, systemPromptWith } from "./prompts";

export interface ProofreadOutcome {
  result: ProofreadResult;
  /** What the plugin could see was wrong even after one repair attempt; the learner is told, never shown it as fact. */
  issues: string[];
}

/** Proof reads a selection (#186): the corrections, checked against the text they claim to fix, one repair attempt. */
export class ProofreadService {
  constructor(
    private ai: AiProviderService,
    private custom: () => PromptCustom = () => NO_CUSTOM
  ) {}

  async proofread(text: string): Promise<ProofreadOutcome> {
    const user = buildProofreadUserPrompt(text);
    let result = await this.ask(user);
    let issues = validateProofread(result, text);
    if (issues.length > 0) {
      const again = await this.ask(`${user}\n\n${buildExplainRepairPrompt(issues)}`).catch(() => null);
      if (again) {
        const remaining = validateProofread(again, text);
        if (remaining.length <= issues.length) {
          result = again;
          issues = remaining;
        }
      }
    }
    return { result, issues };
  }

  private async ask(user: string): Promise<ProofreadResult> {
    const raw = await this.ai.chatJson(systemPromptWith(PROOFREAD_SYSTEM_PROMPT, this.custom()), user, "Proofread", PROOFREAD_SCHEMA, true);
    return normaliseProofread(extractJsonObject(raw, "proofreading"));
  }
}
