import { describe, expect, it, vi } from "vitest";
import { indexVault, indexVaultWithNotice } from "../vocabulary/VaultIndexer";

describe("VaultIndexer", () => {
  it("records only dictionary-backed word tokens from markdown files with CJK", async () => {
    // One call per note carrying the whole tally, not one call per occurrence:
    // recordNoteScan reconciles against the count already stored for the path,
    // so it needs the total. 学习 appears twice in the same file and must
    // arrive as a single entry of 2.
    const recordNoteScan = vi.fn(
      (_path: string, counts: Map<string, number>) =>
        [...counts.values()].reduce((a, b) => a + b, 0)
    );
    const plugin = {
      settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false, scriptVariant: "simplified" },
      tokenizer: {
        tokenize: vi.fn(async () => [
          { surface: "学习", isWord: true, candidates: [{ simplified: "学习" }] },
          { surface: "!", isWord: false, candidates: [] },
          { surface: "空", isWord: true, candidates: [] },
          { surface: "学习", isWord: true, candidates: [{ simplified: "学习" }] },
        ]),
      },
      dictionary: { ensureLoaded: vi.fn(async () => {}), isTraditionalMarker: () => false },
      vocab: { recordNoteScan },
      app: {
        vault: {
          getMarkdownFiles: () => [{ path: "a.md" }, { path: "b.md" }],
          cachedRead: vi.fn(async (file: { path: string }) => (file.path === "a.md" ? "学习中文" : "hello")),
        },
      },
    } as any;

    const progressCalls: any[] = [];
    const result = await indexVault(plugin, (p) => progressCalls.push({ ...p }));
    expect(result).toEqual({ scanned: 2, total: 2, recorded: 2, skipped: 0 });
    expect(recordNoteScan).toHaveBeenCalledTimes(1);
    expect(recordNoteScan).toHaveBeenCalledWith("a.md", new Map([["学习", 2]]), 5, false, {
      markExistingBaseline: true,
    });
    expect(progressCalls.at(-1)).toEqual(result);
  });

  it("indexVaultWithNotice marks the vault indexed and saves settings", async () => {
    const plugin = {
      settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false, scriptVariant: "simplified" },
      tokenizer: { tokenize: vi.fn(async () => []) },
      dictionary: { ensureLoaded: vi.fn(async () => {}), isTraditionalMarker: () => false },
      vocab: { recordNoteScan: vi.fn(() => 0) },
      saveSettings: vi.fn(async () => {}),
      app: {
        vault: {
          getMarkdownFiles: () => [{ path: "a.md" }],
          cachedRead: vi.fn(async () => "hello"),
        },
      },
    } as any;

    await indexVaultWithNotice(plugin);
    expect(plugin.settings.vaultIndexed).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  /**
   * Indexing a Traditional note while the plugin is set to Simplified used to
   * manufacture junk: the trie holds no traditional surfaces, so the note
   * collapses to single-character edges, and because DictionaryService.lookup()
   * checks both maps regardless of the setting, every one of those characters
   * still resolved and was recorded as its own word. Indexing only ever adds,
   * so 學 / 習 / 灣 stuck around forever.
   */
  describe("notes written in the other script", () => {
    function harness(scriptVariant: string, traditionalChars: string[]) {
      const recordNoteScan = vi.fn(() => 1);
      const tokenize = vi.fn(async () => [
        { surface: "學習", isWord: true, candidates: [{ simplified: "学习" }] },
      ]);
      const plugin = {
        settings: {
          exactTimestampRetentionLimit: 5,
          storeAllExactTimestamps: false,
          vaultIndexed: false,
          scriptVariant,
        },
        dictionary: {
          ensureLoaded: vi.fn(async () => {}),
          isTraditionalMarker: (ch: string) => traditionalChars.includes(ch),
        },
        tokenizer: { tokenize },
        vocab: { recordNoteScan },
        app: {
          vault: {
            getMarkdownFiles: () => [{ path: "tw.md" }],
            cachedRead: vi.fn(async () => "台灣的天氣很熱"),
          },
        },
      } as any;
      return { plugin, tokenize, recordNoteScan };
    }

    it("skips a Traditional note when Simplified is selected", async () => {
      const { plugin, tokenize, recordNoteScan } = harness("simplified", ["灣", "氣", "熱"]);
      const result = await indexVault(plugin);
      expect(result).toEqual({ scanned: 1, total: 1, recorded: 0, skipped: 1 });
      // Skipped before tokenizing, so it costs a character scan, not a
      // segmentation pass — and nothing reaches the vocabulary store.
      expect(tokenize).not.toHaveBeenCalled();
      expect(recordNoteScan).not.toHaveBeenCalled();
    });

    it("indexes the same note normally when Traditional is selected", async () => {
      // Traditional mode indexes BOTH scripts, so nothing is ever skipped.
      const { plugin, tokenize, recordNoteScan } = harness("traditional", ["灣", "氣", "熱"]);
      const result = await indexVault(plugin);
      expect(result).toEqual({ scanned: 1, total: 1, recorded: 1, skipped: 0 });
      expect(tokenize).toHaveBeenCalled();
      expect(recordNoteScan).toHaveBeenCalled();
    });

    it("skips nothing in auto, because the union trie reads both scripts", async () => {
      const { plugin, tokenize, recordNoteScan } = harness("auto", ["灣", "氣", "熱"]);
      const result = await indexVault(plugin);
      expect(result).toEqual({ scanned: 1, total: 1, recorded: 1, skipped: 0 });
      expect(tokenize).toHaveBeenCalled();
      expect(recordNoteScan).toHaveBeenCalled();
    });

    it("does not skip a Simplified note that is below the marker threshold", async () => {
      // The detector needs 3 distinct traditional-only characters; anything
      // less is not evidence, and a Simplified vault must index untouched.
      const { plugin, recordNoteScan } = harness("simplified", ["灣"]);
      const result = await indexVault(plugin);
      expect(result.skipped).toBe(0);
      expect(recordNoteScan).toHaveBeenCalled();
    });
  });
});
