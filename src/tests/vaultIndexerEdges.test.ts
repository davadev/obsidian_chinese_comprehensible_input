import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { indexVault, indexVaultWithNotice } from "../vocabulary/VaultIndexer";

/**
 * What happens when indexing meets bad input: unreadable notes, a tokenizer that throws on one
 * of them, a vault big enough to need yielding, and a failing save. Indexing only ever adds
 * records, so the behaviours that matter are "one bad note never stops the rest" and "nothing is
 * marked as done unless it was".
 */

const word = (surface: string) => ({ surface, isWord: true, candidates: [{ simplified: surface }] });

function make(files: string[], texts: Record<string, string | Error>, over: Record<string, unknown> = {}) {
  const recordNoteScan = vi.fn((_p: string, counts: Map<string, number>, ..._rest: unknown[]) => [...counts.values()].reduce((a, b) => a + b, 0));
  const plugin: any = {
    settings: { exactTimestampRetentionLimit: 5, storeAllExactTimestamps: false, vaultIndexed: false, trackedBaselineRepaired: false, scriptVariant: "auto", ...over },
    tokenizer: { tokenize: vi.fn(async (t: string) => [...t].filter((c) => c >= "一").map(word)) },
    dictionary: { ensureLoaded: vi.fn(async () => {}), isTraditionalMarker: () => false },
    vocab: { recordNoteScan },
    saveSettings: vi.fn(async () => {}),
    app: {
      vault: {
        getMarkdownFiles: () => files.map((path) => ({ path })),
        cachedRead: vi.fn(async (f: { path: string }) => {
          const t = texts[f.path];
          if (t instanceof Error) throw t;
          return t ?? "";
        }),
      },
    },
  };
  return { plugin, recordNoteScan };
}

beforeEach(() => {
  (globalThis as any).window = globalThis;
});
afterEach(() => vi.restoreAllMocks());

describe("indexVault", () => {
  it("an unreadable note is counted as scanned and never stops the rest", async () => {
    const { plugin, recordNoteScan } = make(["bad.md", "good.md"], { "bad.md": new Error("locked"), "good.md": "你好" });
    const r = await indexVault(plugin);
    expect(r).toEqual({ scanned: 2, total: 2, recorded: 2, skipped: 0 });
    expect(recordNoteScan).toHaveBeenCalledTimes(1);
  });

  it("a tokenizer failure on one note is swallowed, that note records nothing, the next one does", async () => {
    const { plugin, recordNoteScan } = make(["a.md", "b.md"], { "a.md": "你好", "b.md": "世界" });
    plugin.tokenizer.tokenize.mockRejectedValueOnce(new Error("boom"));
    const r = await indexVault(plugin);
    expect(r.scanned).toBe(2);
    expect(recordNoteScan).toHaveBeenCalledTimes(1);
    expect(recordNoteScan.mock.calls[0][0]).toBe("b.md");
  });

  it("notes with no Chinese never reach the tokenizer or the store", async () => {
    const { plugin, recordNoteScan } = make(["en.md", "empty.md"], { "en.md": "just english", "empty.md": "" });
    const r = await indexVault(plugin);
    expect(r).toEqual({ scanned: 2, total: 2, recorded: 0, skipped: 0 });
    expect(plugin.tokenizer.tokenize).not.toHaveBeenCalled();
    expect(recordNoteScan).not.toHaveBeenCalled();
  });

  it("an empty vault finishes immediately and still reports once", async () => {
    const { plugin } = make([], {});
    const seen: number[] = [];
    const r = await indexVault(plugin, (p) => seen.push(p.scanned));
    expect(r).toEqual({ scanned: 0, total: 0, recorded: 0, skipped: 0 });
    expect(seen).toEqual([0]);
  });

  it("reports progress every 5 notes (and at the end) and yields to the UI between", async () => {
    const files = Array.from({ length: 12 }, (_, i) => `n${i}.md`);
    const { plugin } = make(files, Object.fromEntries(files.map((f) => [f, "你好"])));
    const spy = vi.spyOn(globalThis, "setTimeout");
    const seen: number[] = [];
    await indexVault(plugin, (p) => seen.push(p.scanned));
    expect(seen).toEqual([5, 10, 12]);
    expect(spy.mock.calls.filter(([, ms]) => ms === 0).length).toBe(2);
  });

  it("only marks existing records as baseline on the first pass, i.e. while trackedBaselineRepaired is false", async () => {
    const first = make(["a.md"], { "a.md": "你好" });
    await indexVault(first.plugin);
    expect(first.recordNoteScan.mock.calls[0][4]).toEqual({ markExistingBaseline: true });
    const later = make(["a.md"], { "a.md": "你好" }, { trackedBaselineRepaired: true });
    await indexVault(later.plugin);
    expect(later.recordNoteScan.mock.calls[0][4]).toEqual({ markExistingBaseline: false });
  });

  it("ignores non-word tokens and words the dictionary has no candidates for", async () => {
    const { plugin, recordNoteScan } = make(["a.md"], { "a.md": "你好" });
    plugin.tokenizer.tokenize.mockResolvedValue([
      { surface: "，", isWord: false, candidates: [] },
      { surface: "未知", isWord: true, candidates: [] },
      word("你好"),
    ]);
    await indexVault(plugin);
    expect([...recordNoteScan.mock.calls[0][1].entries()]).toEqual([["你好", 1]]);
  });
});

describe("indexVaultWithNotice", () => {
  it("reports how many were skipped as Traditional, and still marks the vault indexed", async () => {
    const { plugin } = make(["tw.md"], { "tw.md": "台灣的天氣很熱" }, { scriptVariant: "simplified" });
    plugin.dictionary.isTraditionalMarker = () => true;
    await indexVaultWithNotice(plugin);
    expect(plugin.settings.vaultIndexed).toBe(true);
    expect(plugin.settings.trackedBaselineRepaired).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark the vault indexed when indexing itself fails, and says so instead of throwing", async () => {
    const { plugin } = make(["a.md"], { "a.md": "你好" });
    plugin.dictionary.ensureLoaded.mockRejectedValue(new Error("dictionary missing"));
    await expect(indexVaultWithNotice(plugin)).resolves.toBeUndefined();
    expect(plugin.settings.vaultIndexed).toBe(false);
    expect(plugin.settings.trackedBaselineRepaired).toBe(false);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("a failing save is reported, not thrown into onload", async () => {
    const { plugin } = make(["a.md"], { "a.md": "你好" });
    plugin.saveSettings.mockRejectedValue(new Error("disk full"));
    await expect(indexVaultWithNotice(plugin)).resolves.toBeUndefined();
  });
});
