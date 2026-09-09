import { Notice } from "obsidian";
import type CciPlugin from "../main";
import { hasCjk } from "../dictionary/normalizeChinese";

export interface VaultIndexProgress {
  scanned: number;
  total: number;
  recorded: number;
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
 */
export async function indexVault(
  plugin: CciPlugin,
  onProgress?: (p: VaultIndexProgress) => void
): Promise<VaultIndexProgress> {
  const files = plugin.app.vault.getMarkdownFiles();
  const settings = plugin.settings;
  const progress: VaultIndexProgress = { scanned: 0, total: files.length, recorded: 0 };
  for (const file of files) {
    let text = "";
    try {
      text = await plugin.app.vault.cachedRead(file);
    } catch {
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
          settings.storeAllExactTimestamps
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
    notice.setMessage(
      `Chinese plugin: indexed ${result.scanned} files, ${result.recorded} new exposures.`
    );
    plugin.settings.vaultIndexed = true;
    await plugin.saveSettings();
    window.setTimeout(() => notice.hide(), 4000);
  } catch (err) {
    notice.setMessage(
      "Chinese plugin: indexing failed — " + (err as Error).message
    );
    window.setTimeout(() => notice.hide(), 6000);
  }
}
