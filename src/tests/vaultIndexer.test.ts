import { describe, expect, it, vi } from "vitest";
import { indexVault, indexVaultWithNotice } from "../vocabulary/VaultIndexer";

describe("VaultIndexer", () => {
  it("records only dictionary-backed word tokens from markdown files with CJK", async () => {
    const recordExposure = vi.fn();
    const plugin = {
      settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false },
      tokenizer: {
        tokenize: vi.fn(async () => [
          { surface: "学习", isWord: true, candidates: [{ simplified: "学习" }] },
          { surface: "!", isWord: false, candidates: [] },
          { surface: "空", isWord: true, candidates: [] },
        ]),
      },
      vocab: { recordExposure },
      app: {
        vault: {
          getMarkdownFiles: () => [{ path: "a.md" }, { path: "b.md" }],
          cachedRead: vi.fn(async (file: { path: string }) => (file.path === "a.md" ? "学习中文" : "hello")),
        },
      },
    } as any;

    const progressCalls: any[] = [];
    const result = await indexVault(plugin, (p) => progressCalls.push({ ...p }));
    expect(result).toEqual({ scanned: 2, total: 2, recorded: 1 });
    expect(recordExposure).toHaveBeenCalledWith("学习", 5, false, "a.md");
    expect(progressCalls.at(-1)).toEqual(result);
  });

  it("indexVaultWithNotice marks the vault indexed and saves settings", async () => {
    const plugin = {
      settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false },
      tokenizer: { tokenize: vi.fn(async () => []) },
      vocab: { recordExposure: vi.fn() },
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
