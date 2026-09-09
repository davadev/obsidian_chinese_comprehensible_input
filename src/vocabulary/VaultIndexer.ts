import { Notice } from "obsidian";
import type CciPlugin from "../main";
import { hasCjk } from "../dictionary/normalizeChinese";
import { looksTraditional } from "../dictionary/scriptDetect";

export interface VaultIndexProgress {
  scanned: number;
  total: number;
  recorded: number;
  /** Files left alone because they are written in the other script. */
  skipped: number;
}

/**
 * Walk every Markdown file in the vault, tokenize the Chinese spans, and hand
 * each note's word tally to `recordNoteScan`. Chunked + yields to the UI so a
 * large vault does not freeze the editor.
 *
 * Safe to re-run: counts are recorded per note as a high-water mark, so a
 * second pass over unchanged notes writes nothing. `progress.recorded` is
 * therefore the number of NEW exposures, not the number of tokens seen — it
 * reads 0 on a clean re-index.
 *
 * Notes written in the other script are skipped rather than indexed wrong.
 * With Simplified selected the trie holds no traditional surfaces, so a
 * Traditional note finds no multi-character match and collapses to the
 * single-character OOV edge — and because `DictionaryService.lookup()` checks
 * BOTH maps regardless of the setting, each of those characters still resolves
 * and gets recorded. That manufactures a permanent 學 / 習 / 灣 vocabulary
 * record per character, and since indexing only ever adds, nothing removes
 * them again.
 *
 * One-directional on purpose: with Traditional selected the trie is a union of
 * both scripts, so Simplified notes index correctly and are never skipped.
 */
export async function indexVault(
  plugin: CciPlugin,
  onProgress?: (p: VaultIndexProgress) => void
): Promise<VaultIndexProgress> {
  const files = plugin.app.vault.getMarkdownFiles();
  const settings = plugin.settings;
  const progress: VaultIndexProgress = { scanned: 0, total: files.length, recorded: 0, skipped: 0 };
  // looksTraditional() reads the dictionary's traditional index, and the check
  // below runs before the first tokenize() — which used to be what forced the
  // load. Idempotent, so this costs nothing when the dictionary is already up.
  await plugin.dictionary.ensureLoaded();
  // Only the simplified-only trie can shatter a Traditional note, so only it
  // needs the skip. "auto" and "traditional" index the union and read both.
  const skipTraditional = settings.scriptVariant === "simplified";
  // One-shot: records an earlier build's index created carry no backfilledAt,
  // so this pass adopts the still-unclassified ones as baseline. The caller
  // sets the flag afterwards; leaving it on would keep re-marking genuinely
  // newly-read words on every later index.
  const markExistingBaseline = !settings.trackedBaselineRepaired;
  for (const file of files) {
    let text = "";
    try {
      text = await plugin.app.vault.cachedRead(file);
    } catch {
      progress.scanned++;
      continue;
    }
    if (hasCjk(text) && skipTraditional && looksTraditional(text, plugin.dictionary)) {
      // Before tokenizing, so a skipped file costs a character scan rather
      // than a full segmentation pass.
      progress.skipped++;
      progress.scanned++;
      continue;
    }
    if (hasCjk(text)) {
      try {
        const tokens = await plugin.tokenizer.tokenize(text);
        // Tally the whole note first: recordNoteScan reconciles against the
        // count already stored for this path, so it needs the total, not one
        // call per occurrence.
        const counts = new Map<string, number>();
        for (const tok of tokens) {
          if (!tok.isWord || tok.candidates.length === 0) continue;
          counts.set(tok.surface, (counts.get(tok.surface) ?? 0) + 1);
        }
        progress.recorded += plugin.vocab.recordNoteScan(
          file.path,
          counts,
          settings.exactTimestampRetentionLimit,
          settings.storeAllExactTimestamps,
          { markExistingBaseline }
        );
      } catch {
        // tokenizer failure on this file shouldn't stop the scan
      }
    }
    progress.scanned++;
    if (progress.scanned % 5 === 0) {
      onProgress?.(progress);
      // Yield to the UI so the editor stays responsive.
      await new Promise((r) => window.setTimeout(r, 0));
    }
  }
  onProgress?.(progress);
  return progress;
}

/**
 * Convenience wrapper that shows a single Notice updated periodically and
 * persists `vaultIndexed = true` when complete. Safe to fire-and-forget from
 * `onload`.
 */
export async function indexVaultWithNotice(plugin: CciPlugin): Promise<void> {
  const notice = new Notice("Chinese plugin: indexing vault…", 0);
  try {
    const result = await indexVault(plugin, (p) => {
      notice.setMessage(
        `Chinese plugin: indexing vault… ${p.scanned}/${p.total}`
      );
    });
    const skippedNote = result.skipped
      ? ` — skipped ${result.skipped} that look Traditional. Switch Text script to index them.`
      : "";
    notice.setMessage(
      `Chinese plugin: indexed ${result.scanned} files, ${result.recorded} new exposures${skippedNote || "."}`
    );
    plugin.settings.vaultIndexed = true;
    plugin.settings.trackedBaselineRepaired = true;
    await plugin.saveSettings();
    window.setTimeout(() => notice.hide(), 4000);
  } catch (err) {
    notice.setMessage(
      "Chinese plugin: indexing failed — " + (err as Error).message
    );
    window.setTimeout(() => notice.hide(), 6000);
  }
}
