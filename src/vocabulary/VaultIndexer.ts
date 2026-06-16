import { Notice } from "obsidian";
import type CciPlugin from "../main";
import { hasCjk } from "../dictionary/normalizeChinese";

export interface VaultIndexProgress {
  scanned: number;
  total: number;
  recorded: number;
}

/**
 * Walk every Markdown file in the vault, tokenize the Chinese spans, and
 * `recordExposure` each word-level CJK token. Chunked + yields to the UI so
 * a large vault does not freeze the editor. Re-running it records exposures
 * again on the same canonical records.
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
        for (const tok of tokens) {
          if (!tok.isWord || tok.candidates.length === 0) continue;
          plugin.vocab.recordExposure(
            tok.surface,
            settings.exactTimestampRetentionLimit,
            settings.storeAllExactTimestamps,
            file.path
          );
          progress.recorded++;
        }
      } catch {
        // tokenizer failure on this file shouldn't stop the scan
      }
    }
    progress.scanned++;
    if (progress.scanned % 5 === 0) {
      onProgress?.(progress);
      // Yield to the UI so the editor stays responsive.
      await new Promise((r) => setTimeout(r, 0));
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
      `Chinese plugin: indexed ${result.scanned} files, ${result.recorded} words.`
    );
    plugin.settings.vaultIndexed = true;
    await plugin.saveSettings();
    setTimeout(() => notice.hide(), 4000);
  } catch (err) {
    notice.setMessage(
      "Chinese plugin: indexing failed — " + (err as Error).message
    );
    setTimeout(() => notice.hide(), 6000);
  }
}
