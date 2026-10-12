import type CciPlugin from "../main";
import { computeOpenAiCostUsd } from "../ai/openaiProfile";

/**
 * Adds up what a job cost on OpenAI from the token usage of the requests it made (every request, repair attempts
 * included). A local model bills nothing, so it reports nothing. `start()` before the work, `stop()` when it is over.
 */
export class UsageMeter {
  private off: (() => void) | null = null;
  usd = 0;
  requests = 0;

  constructor(private plugin: Pick<CciPlugin, "onAiUsage">) {}

  start(): void {
    this.off?.();
    this.off = this.plugin.onAiUsage((entry) => {
      if (entry.provider !== "openai") return;
      this.requests++;
      this.usd += computeOpenAiCostUsd(entry, entry.model);
    });
  }

  stop(): void {
    this.off?.();
    this.off = null;
  }

  /** "Cost on OpenAI: $0.0012 (2 requests)", or null when nothing was billed. */
  line(): string | null {
    if (this.requests === 0) return null;
    return `Cost on OpenAI: ${formatSpent(this.usd)} (${this.requests} ${this.requests === 1 ? "request" : "requests"}).`;
  }
}

/**
 * What a finished job actually cost: a few thousandths of a dollar are worth showing, so no rounding up to a cent, and a
 * proof read that costs a twentieth of a thousandth must not read as "$0.0000", which looks like free.
 */
export function formatSpent(usd: number): string {
  if (usd < 0.0001) return "under $0.0001";
  return `$${usd.toFixed(usd >= 0.1 ? 2 : 4)}`;
}
