import type { DictionaryEntry } from "../dictionary/DictionaryTypes";
import { displayPinyin } from "../dictionary/displayForms";
import { makeKey } from "../dictionary/normalizeChinese";
import { charGlossesFor } from "../ai/mnemonicFacts";
import type { MnemonicInput } from "../ai/MnemonicService";
import { computeOpenAiCostUsd } from "../ai/openaiProfile";
import type { BatchMnemonicScope, PronunciationRegion } from "../settings/types";
import type { Token } from "../tokenizer/tokenizerTypes";
import { extractSentenceAround } from "../ui/StatsView";
import type { WordRecord, WordStatus } from "./VocabularyTypes";

/**
 * "Generate mnemonics for this note": which words, what to send for each, how many at a time, and what it costs.
 * Kept free of UI so the rules (never touch a known word, never overwrite a mnemonic, stop when the provider is
 * clearly broken) are testable on their own.
 */

/** Known words need no hook and ignored words were set aside on purpose, whatever the scope says. */
export function statusInScope(status: WordStatus, scope: BatchMnemonicScope): boolean {
  if (status === "known" || status === "ignored") return false;
  if (scope === "notKnown") return true;
  if (scope === "marked") return status !== "new";
  return status === "unknown";
}

export interface BatchItem {
  /** The form as it appears in the note, which is what the model is asked about. */
  surface: string;
  /** Where the mnemonic is stored: the record's first-seen surface, like the single editor. */
  storage: string;
  /** The sentence of the word's first occurrence in the note. */
  sentence: string;
  status: WordStatus;
}

export interface BatchSelection {
  items: BatchItem[];
  /** In-scope words that already have a mnemonic and are left alone. */
  haveMnemonic: number;
}

/** Each distinct word once (by dictionary entry, so 学习 and 學習 count together), in reading order. */
export function selectBatchWords(
  text: string,
  tokens: Token[],
  vocab: { bySurface(surface: string): WordRecord | undefined },
  scope: BatchMnemonicScope
): BatchSelection {
  const seen = new Set<string>();
  const items: BatchItem[] = [];
  let haveMnemonic = 0;
  for (const tok of tokens) {
    if (!tok.isWord || tok.candidates.length === 0) continue;
    const entry = tok.selected ?? tok.candidates[0];
    const id = makeKey(entry.simplified, entry.pinyin);
    if (seen.has(id)) continue;
    const rec = vocab.bySurface(tok.surface);
    const status = rec?.status ?? "new";
    if (!statusInScope(status, scope)) continue;
    seen.add(id);
    if (rec?.mnemonic?.text || rec?.mnemonic?.story) {
      haveMnemonic++;
      continue;
    }
    items.push({
      surface: tok.surface,
      storage: rec?.surfaces[0] ?? tok.surface,
      sentence: extractSentenceAround(text, tok.start).text,
      status,
    });
  }
  return { items, haveMnemonic };
}

/** What the single-word editor would send, minus the fields the learner has not typed yet. */
export function batchInput(
  item: BatchItem,
  deps: {
    lookup: (surface: string) => DictionaryEntry[];
    bySurface: (surface: string) => WordRecord | undefined;
    region: PronunciationRegion;
  }
): MnemonicInput {
  const dict = deps.lookup(item.surface)[0];
  const rec = deps.bySurface(item.surface);
  return {
    surface: item.surface,
    pinyin: displayPinyin(dict, rec, deps.region),
    traditional: dict?.traditional ?? rec?.traditional,
    definitions: dict?.definitions ?? rec?.definitions ?? [],
    sentence: item.sentence,
    hskLevels: rec?.hsk?.levels ?? dict?.hsk?.levels ?? [],
    charGlosses: charGlossesFor(item.surface, deps.lookup),
  };
}

/** Measured on the gold set with the shipped prompt: about 730 tokens in and 75 out per word; a margin for repairs. */
const EST_INPUT_TOKENS = 800;
const EST_OUTPUT_TOKENS = 110;

/** USD for `count` words on OpenAI, or null when the provider is a local model (nothing is billed). */
export function estimateBatchUsd(count: number, provider: string, modelId: string): number | null {
  if (provider !== "openai") return null;
  return computeOpenAiCostUsd(
    { inputTokens: count * EST_INPUT_TOKENS, cachedInputTokens: 0, outputTokens: count * EST_OUTPUT_TOKENS },
    modelId
  );
}

export function formatUsd(usd: number): string {
  return usd < 0.01 ? "under $0.01" : `about $${usd.toFixed(2)}`;
}

export interface BatchOutcome {
  item: BatchItem;
  ok: boolean;
  /** What the app could not get right even after its repair attempt; the mnemonic was still saved. */
  caveats?: string[];
  error?: string;
}

export type BatchStop = "user" | "failures" | null;

/** A key that is wrong, a server that is down: five failures in a row is not bad luck, so stop spending time on it. */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Run `worker` over `items`, `concurrency` at a time. A failed item never stops the others, but a run of failures does,
 * and so does `shouldStop` (checked before each item starts; items already running finish). The worker returns the
 * caveats for the item, if any.
 */
export async function runBatch(
  items: BatchItem[],
  worker: (item: BatchItem) => Promise<string[] | undefined>,
  opts: {
    concurrency: number;
    shouldStop: () => boolean;
    onProgress: (done: number, total: number, last: BatchOutcome) => void;
  }
): Promise<{ outcomes: BatchOutcome[]; stopped: BatchStop }> {
  const outcomes: BatchOutcome[] = [];
  let next = 0;
  let consecutive = 0;
  let stopped: BatchStop = null;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      if (opts.shouldStop()) {
        stopped ??= "user";
        return;
      }
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        stopped ??= "failures";
        return;
      }
      const item = items[next++];
      let outcome: BatchOutcome;
      try {
        const caveats = await worker(item);
        consecutive = 0;
        outcome = caveats?.length ? { item, ok: true, caveats } : { item, ok: true };
      } catch (err) {
        consecutive++;
        outcome = { item, ok: false, error: ((err as Error).message ?? String(err)).split("\n")[0].slice(0, 200) };
      }
      outcomes.push(outcome);
      opts.onProgress(outcomes.length, items.length, outcome);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, lane));
  return { outcomes, stopped };
}
