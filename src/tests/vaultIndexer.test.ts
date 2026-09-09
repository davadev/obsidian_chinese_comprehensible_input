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
      settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false },
      tokenizer: {
        tokenize: vi.fn(async () => [
          { surface: "学习", isWord: true, candidates: [{ simplified: "学习" }] },
          { surface: "!", isWord: false, candidates: [] },
          { surface: "空", isWord: true, candidates: [] },
          { surface: "学习", isWord: true, candidates: [{ simplified: "学习" }] },
        ]),
      },
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
    expect(result).toEqual({ scanned: 2, total: 2, recorded: 2 });
    expect(recordNoteScan).toHaveBeenCalledTimes(1);
    expect(recordNoteScan).toHaveBeenCalledWith("a.md", new Map([["学习", 2]]), 5, false);
    expect(progressCalls.at(-1)).toEqual(result);
  });

  it("indexVaultWithNotice marks the vault indexed and saves settings", async () => {
    const plugin = {
      settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false },
      tokenizer: { tokenize: vi.fn(async () => []) },
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
});
