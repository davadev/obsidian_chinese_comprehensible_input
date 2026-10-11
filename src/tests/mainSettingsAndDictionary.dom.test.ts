// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { bind, call, settings, statsView, workspace } from "./__mocks__/mainHarness";
import { VIEW_TYPE_STATS } from "../constants";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { putCachedTokens, getCachedTokens } from "../tokenizer/tokenCache";

/**
 * Everything main.ts does with settings and the dictionary's user data: what gets saved and when, the script/region
 * side effects (which caches to drop, what to tell the user), the Traditional suggestion, the AI usage log, the backup
 * context, and how a mirror from another device is merged into this device's overrides and custom words.
 */

installObsidianDom();

const detect = vi.hoisted(() => ({ traditional: true }));
vi.mock("../dictionary/scriptDetect", () => ({ looksTraditional: () => detect.traditional, countTraditionalMarkers: () => 0 }));
const indexer = vi.hoisted(() => ({ indexVaultWithNotice: vi.fn(async () => {}) }));
vi.mock("../vocabulary/VaultIndexer", () => indexer);

beforeEach(() => {
  Notice.instances.length = 0;
  detect.traditional = true;
  indexer.indexVaultWithNotice.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lastNotice = () => Notice.instances.at(-1)!;

describe("the data blob", () => {
  it("updates go through the queue", async () => {
    const queue = vi.fn(async () => {});
    const mutate = () => {};
    await call("updateDataBlob", { queuedDataBlobUpdate: queue }, mutate);
    expect(queue).toHaveBeenCalledWith(mutate);
  });

  it("loading gives an empty blob when there is nothing saved yet", async () => {
    expect(await call("loadPluginData", { loadData: async () => null })).toEqual({});
    expect(await call("loadPluginData", { loadData: async () => ({ a: 1 }) })).toEqual({ a: 1 });
  });

  it("whether the user has touched settings is whether the blob carries the stamp", async () => {
    expect(await call("hasUserTouchedSettings", { loadPluginData: async () => ({}) })).toBe(false);
    expect(await call("hasUserTouchedSettings", { loadPluginData: async () => ({ __settingsTouchedAt: "2026-01-01" }) })).toBe(true);
  });
});

describe("the backup context", () => {
  const ctx = (self: Record<string, unknown>) => call<any>("backupContext", self);

  it("is read from the settings as they are now, with defaults and limits", () => {
    expect(ctx({ settings: settings((s) => ((s.backupsEnabled = true), (s.backupsKeep = 7))) })).toMatchObject({ enabled: true, keep: 7 });
    expect(ctx({ settings: settings((s) => (s.backupsEnabled = false)) }).enabled).toBe(false);
    for (const [given, keep] of [[0, 1], [500, 50], [3.9, 3], [Number.NaN, DEFAULT_SETTINGS.backupsKeep], ["9", DEFAULT_SETTINGS.backupsKeep], [Infinity, DEFAULT_SETTINGS.backupsKeep]] as const) {
      expect(ctx({ settings: settings((s) => (s.backupsKeep = given)) }).keep, String(given)).toBe(keep);
    }
  });

  it("falls back to what data.json held at start-up, then to nothing, before the settings exist", () => {
    expect(ctx({ settings: undefined, startupSettings: { backupsEnabled: false, backupsKeep: 2 } })).toMatchObject({ enabled: false, keep: 2 });
    expect(ctx({ settings: undefined, startupSettings: undefined })).toEqual({ enabled: true, keep: DEFAULT_SETTINGS.backupsKeep, vocabMirrorPath: null, settingsMirrorPath: null });
  });

  it("names the mirror files only while each mirror is switched on and has a path", () => {
    const on = ctx({ settings: settings((s) => ((s.sync.mirrorEnabled = true), (s.sync.mirrorPath = "V.json"), (s.sync.settingsMirrorEnabled = true), (s.sync.settingsMirrorPath = "S.json"))) });
    expect([on.vocabMirrorPath, on.settingsMirrorPath]).toEqual(["V.json", "S.json"]);
    const off = ctx({ settings: settings((s) => ((s.sync.mirrorEnabled = false), (s.sync.mirrorPath = "V.json"), (s.sync.settingsMirrorEnabled = true), (s.sync.settingsMirrorPath = ""))) });
    expect([off.vocabMirrorPath, off.settingsMirrorPath]).toEqual([null, null]);
    expect(ctx({ settings: undefined, startupSettings: {} })).toMatchObject({ vocabMirrorPath: null, settingsMirrorPath: null });
  });

  it("the plugin folder is the manifest's, or built from the config folder", () => {
    expect(call("pluginDir", { manifest: { dir: "x/plugins/cci", id: "cci" }, app: { vault: { configDir: ".obsidian" } } })).toBe("x/plugins/cci");
    expect(call("pluginDir", { manifest: { id: "cci" }, app: { vault: { configDir: ".obsidian" } } })).toBe(".obsidian/plugins/cci");
  });

  it("the backup service is built for that folder, this version, the real clock, a notice for messages, and a live context", () => {
    const adapter = {};
    const self: any = bind({ manifest: { dir: "d", id: "cci", version: "0.8.0-beta.1" }, app: { vault: { configDir: ".obsidian", adapter } }, settings: settings() });
    const svc = self.makeBackupService();
    expect(self.backups).toBe(svc);
    const deps = (svc as any).d;
    expect([deps.dir, deps.dataPath, deps.version, deps.adapter]).toEqual(["d/backups", "d/data.json", "0.8.0-beta.1", adapter]);
    expect(deps.now()).toBeInstanceOf(Date);
    deps.notify("hello", 5);
    expect(lastNotice().message).toBe("hello");
    expect(lastNotice().duration).toBe(5);
    expect(deps.context().enabled).toBe(true);
  });
});

describe("saving settings", () => {
  const self = (over: Record<string, unknown> = {}) => {
    const blob: Record<string, unknown> = {};
    const o: any = bind({
      settings: settings(),
      lastSharedFingerprint: null,
      updateDataBlob: vi.fn(async (m: (b: any) => void) => m(blob)),
      applyScriptSideEffects: vi.fn(),
      settingsMirror: { scheduleWrite: vi.fn() },
      ...over,
    });
    return { o, blob };
  };

  it("a change to what is shared marks the device as touched and schedules a mirror write", async () => {
    const { o, blob } = self();
    await o.saveSettings();
    expect(blob.settings).toBe(o.settings);
    expect(typeof blob.__settingsTouchedAt).toBe("string");
    expect(o.settingsMirror.scheduleWrite).toHaveBeenCalledTimes(1);
  });

  it("a change that is not shared (or no change) saves without either", async () => {
    const { o, blob } = self();
    await o.saveSettings();
    for (const k of Object.keys(blob)) delete blob[k];
    o.settingsMirror.scheduleWrite.mockClear();
    await o.saveSettings();
    expect(blob.settings).toBe(o.settings);
    expect(blob.__settingsTouchedAt).toBeUndefined();
    expect(o.settingsMirror.scheduleWrite).not.toHaveBeenCalled();
  });

  it("works before the settings mirror exists", async () => {
    const { o } = self({ settingsMirror: undefined });
    await expect(o.saveSettings()).resolves.toBeUndefined();
  });

  it("the silent save passes on whether the change came from another device, and never stamps unless asked", async () => {
    const { o, blob } = self();
    await o.saveSettingsSilently({ remote: true });
    expect(o.applyScriptSideEffects).toHaveBeenCalledWith({ remote: true });
    expect(blob.__settingsTouchedAt).toBeUndefined();
    await o.saveSettingsSilently();
    expect(o.applyScriptSideEffects).toHaveBeenLastCalledWith({ remote: undefined });
    await o.saveSettingsSilently({ markUserTouched: true });
    expect(typeof blob.__settingsTouchedAt).toBe("string");
  });
});

describe("the AI usage log", () => {
  const entry = (ts: number) => ({ ts, provider: "openai", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 });

  it("keeps the last 35 days, adds the new entry, and saves once after a burst", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const o: any = bind({ settings: settings((s) => (s.ai.usageLog = [entry(now - 40 * 86400000), entry(now - 86400000)])), saveSettingsSilently: vi.fn(async () => {}), aiUsageSaveTimer: null });
    o.recordAiUsage(entry(now));
    o.recordAiUsage(entry(now + 1));
    expect(o.settings.ai.usageLog.map((e: any) => e.ts)).toEqual([now - 86400000, now, now + 1]);
    expect(o.saveSettingsSilently).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(o.saveSettingsSilently).toHaveBeenCalledTimes(1);
    expect(o.aiUsageSaveTimer).toBeNull();
  });

  it("starts a log when there is none", () => {
    vi.useFakeTimers();
    const o: any = bind({ settings: settings((s) => (s.ai.usageLog = undefined)), saveSettingsSilently: vi.fn(), aiUsageSaveTimer: null });
    o.recordAiUsage(entry(Date.now()));
    expect(o.settings.ai.usageLog).toHaveLength(1);
  });
});

describe("changing the script or the pronunciation region", () => {
  const self = (over: Record<string, unknown> = {}) => {
    const stats = statsView();
    const o: any = bind({
      settings: settings((s) => ((s.scriptVariant = "simplified"), (s.pronunciationRegion = "mainland"))),
      lastAppliedScriptVariant: "simplified",
      lastAppliedRegion: "mainland",
      tokenizer: { invalidate: vi.fn() },
      vocab: { clearSurfaceCache: vi.fn() },
      forceRetokenizeViews: vi.fn(),
      refreshChineseViews: vi.fn(),
      refreshStatsViews: vi.fn(),
      offerReindexAfterScriptChange: vi.fn(),
      app: { workspace: workspace({ [VIEW_TYPE_STATS]: [{ view: stats }, { view: {} }] }) },
      ...over,
    });
    return { o, stats };
  };

  it("nothing moved means nothing happens", () => {
    const { o } = self();
    o.applyScriptSideEffects();
    expect(o.tokenizer.invalidate).not.toHaveBeenCalled();
    expect(o.forceRetokenizeViews).not.toHaveBeenCalled();
  });

  it("a script change rebuilds the trie, drops the token cache and the stats view's caches, re-tokenizes, and redraws", () => {
    const { o, stats } = self();
    putCachedTokens("cached text", []);
    o.settings.scriptVariant = "traditional";
    o.applyScriptSideEffects();
    expect(o.tokenizer.invalidate).toHaveBeenCalled();
    expect(o.vocab.clearSurfaceCache).toHaveBeenCalled();
    expect(getCachedTokens("cached text")).toBeUndefined();
    expect(stats.invalidateCaches).toHaveBeenCalledTimes(1);
    expect(o.forceRetokenizeViews).toHaveBeenCalled();
    expect(o.refreshChineseViews).toHaveBeenCalled();
    expect(o.refreshStatsViews).toHaveBeenCalled();
    expect(o.lastAppliedScriptVariant).toBe("traditional");
    expect(Notice.instances).toHaveLength(0); // a change made here needs no announcement
  });

  it("a region change alone re-tokenizes (the ruby snapshots its pinyin) without rebuilding the trie", () => {
    const { o, stats } = self();
    o.settings.pronunciationRegion = "taiwan";
    o.applyScriptSideEffects();
    expect(o.tokenizer.invalidate).not.toHaveBeenCalled();
    expect(stats.invalidateCaches).not.toHaveBeenCalled();
    expect(o.forceRetokenizeViews).toHaveBeenCalled();
    expect(o.lastAppliedRegion).toBe("taiwan");
  });

  it("works while the tokenizer and vocabulary do not exist yet (at start-up)", () => {
    const { o } = self({ tokenizer: undefined, vocab: undefined });
    o.settings.scriptVariant = "traditional";
    expect(() => o.applyScriptSideEffects()).not.toThrow();
  });

  it.each([
    ["simplified", "traditional", "Traditional", true],
    ["traditional", "simplified", "Simplified", true],
    ["traditional", "auto", "Automatic", false],
  ])("a change synced from another device (%s to %s) says so, and offers a re-index only when the indexed set moved", (from, to, label, reindex) => {
    const { o } = self({ lastAppliedScriptVariant: from, settings: settings((s) => (s.scriptVariant = to)) });
    o.applyScriptSideEffects({ remote: true });
    expect(o.offerReindexAfterScriptChange).toHaveBeenCalledWith({ reason: `Text script changed to ${label} (synced from another device).`, offerReindex: reindex });
  });
});

describe("telling the user about a script change", () => {
  const self = () => bind({ settings: settings() }) as any;

  it("offers a re-index by default, and the button starts it", () => {
    const o = self();
    o.offerReindexAfterScriptChange();
    const n = lastNotice();
    expect(n.messageEl.firstElementChild!.textContent).toBe("Text script changed. Re-index the vault so word counts match the new script?");
    expect(n.duration).toBe(12000);
    const hide = vi.spyOn(n, "hide");
    n.messageEl.querySelector("button")!.click();
    expect(hide).toHaveBeenCalled();
    expect(indexer.indexVaultWithNotice).toHaveBeenCalledWith(o);
  });

  it("with a reason it leads with it", () => {
    self().offerReindexAfterScriptChange({ reason: "From elsewhere." });
    expect(lastNotice().messageEl.firstElementChild!.textContent).toBe("From elsewhere. Re-index the vault so word counts match the new script?");
  });

  it("with no offer and no reason it stays silent; with no offer and a reason it only informs", () => {
    self().offerReindexAfterScriptChange({ offerReindex: false });
    expect(Notice.instances).toHaveLength(0);
    self().offerReindexAfterScriptChange({ offerReindex: false, reason: "Just so you know." });
    expect(lastNotice().messageEl.textContent).toBe("Just so you know.");
    expect(lastNotice().messageEl.querySelector("button")).toBeNull();
  });
});

describe("suggesting Traditional", () => {
  const self = (over: (s: any) => void = () => {}, extra: Record<string, unknown> = {}) =>
    bind({ traditionalPromptShown: false, settings: settings((s) => ((s.scriptVariant = "simplified"), over(s))), dictionary: {}, saveSettings: vi.fn(async () => {}), offerReindexAfterScriptChange: vi.fn(), ...extra }) as any;

  it("is offered once per session for a note that plainly is Traditional, only while the script is Simplified, and never after 'don't ask again'", () => {
    const o = self();
    o.maybeSuggestTraditional("學習");
    expect(Notice.instances).toHaveLength(1);
    o.maybeSuggestTraditional("學習");
    expect(Notice.instances).toHaveLength(1);
    Notice.instances.length = 0;
    self((s) => (s.scriptVariant = "auto")).maybeSuggestTraditional("學習");
    self((s) => (s.traditionalPromptDismissed = true)).maybeSuggestTraditional("學習");
    detect.traditional = false;
    self().maybeSuggestTraditional("学习");
    expect(Notice.instances).toHaveLength(0);
  });

  it("'Switch to Traditional' changes the script, saves, then offers the re-index", async () => {
    const o = self();
    o.maybeSuggestTraditional("學習");
    const n = lastNotice();
    const hide = vi.spyOn(n, "hide");
    Array.from(n.messageEl.querySelectorAll("button")).find((b) => b.textContent === "Switch to Traditional")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(hide).toHaveBeenCalled();
    expect(o.settings.scriptVariant).toBe("traditional");
    expect(o.saveSettings).toHaveBeenCalled();
    expect(o.offerReindexAfterScriptChange).toHaveBeenCalled();
  });

  it("'Don't ask again' remembers the answer without changing the script", async () => {
    const o = self();
    o.maybeSuggestTraditional("學習");
    const n = lastNotice();
    Array.from(n.messageEl.querySelectorAll("button")).find((b) => b.textContent === "Don't ask again")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(o.settings.traditionalPromptDismissed).toBe(true);
    expect(o.settings.scriptVariant).toBe("simplified");
    expect(o.saveSettings).toHaveBeenCalled();
  });
});

describe("the dictionary's user data", () => {
  const self = (over: Record<string, unknown> = {}) => {
    const blob: Record<string, any> = {};
    const o: any = bind({
      dictionaryOverrides: {},
      dictionaryCustomWords: {},
      updateDataBlob: vi.fn(async (m: (b: any) => void) => m(blob)),
      dictionary: { reload: vi.fn(async () => {}) },
      vocab: { flushSave: vi.fn(async () => {}), clearSurfaceCache: vi.fn() },
      tokenizer: { setOverrides: vi.fn(), invalidate: vi.fn() },
      refreshChineseViews: vi.fn(),
      refreshStatsViews: vi.fn(),
      forceRetokenizeViews: vi.fn(),
      ...over,
    });
    return { o, blob };
  };

  it("saving writes both maps to the blob, then lets the vocabulary store rewrite the mirror", async () => {
    const { o, blob } = self({ dictionaryOverrides: { a: { pinyin: "x" } }, dictionaryCustomWords: { w: { pinyin: "y" } } });
    await o.saveDictionaryUserData();
    expect(blob.dictionaryOverrides).toBe(o.dictionaryOverrides);
    expect(blob.dictionaryCustomWords).toBe(o.dictionaryCustomWords);
    expect(o.vocab.flushSave).toHaveBeenCalled();
  });

  describe("an override", () => {
    it("is stamped, saved, and everything that depends on the dictionary is refreshed", async () => {
      const { o } = self();
      await o.setDictionaryOverride("k", { pinyin: "p" });
      expect(o.dictionaryOverrides.k).toMatchObject({ pinyin: "p", updatedAt: expect.any(String) });
      expect(o.dictionary.reload).toHaveBeenCalled();
      expect(o.vocab.clearSurfaceCache).toHaveBeenCalled();
      expect(o.forceRetokenizeViews).toHaveBeenCalled();
      expect(o.refreshChineseViews).toHaveBeenCalled();
      expect(o.refreshStatsViews).toHaveBeenCalled();
    });

    it("deleting removes it and refreshes the same way", async () => {
      const { o } = self({ dictionaryOverrides: { k: {} } });
      await o.deleteDictionaryOverride("k");
      expect(o.dictionaryOverrides.k).toBeUndefined();
      expect(o.dictionary.reload).toHaveBeenCalled();
      expect(o.forceRetokenizeViews).toHaveBeenCalled();
    });
  });

  describe("a custom word", () => {
    it("is stored under its surface with creation and update times, keeping the original creation time on an edit", async () => {
      const { o } = self();
      await o.setCustomWord("火锅", { simplified: "x", pinyin: "huǒ guō", definitions: ["hot pot"] });
      const first = o.dictionaryCustomWords["火锅"];
      expect(first).toMatchObject({ simplified: "火锅", pinyin: "huǒ guō" });
      expect(first.createdAt).toBe(first.updatedAt);
      await new Promise((r) => setTimeout(r, 5));
      await o.setCustomWord("火锅", { simplified: "x", pinyin: "huǒ guō", definitions: ["hot pot!"] });
      expect(o.dictionaryCustomWords["火锅"].createdAt).toBe(first.createdAt);
      expect(o.dictionaryCustomWords["火锅"].updatedAt >= first.updatedAt).toBe(true);
      expect(o.tokenizer.setOverrides).toHaveBeenCalled();
    });

    it("deleting removes it and refreshes the tokenizer", async () => {
      const { o } = self({ dictionaryCustomWords: { 火锅: { simplified: "火锅" } } });
      await o.deleteCustomWord("火锅");
      expect(o.dictionaryCustomWords["火锅"]).toBeUndefined();
      expect(o.tokenizer.setOverrides).toHaveBeenCalledWith([]);
      expect(o.forceRetokenizeViews).toHaveBeenCalled();
    });

    it("each one becomes a merge rule for the tokenizer, in both scripts when they differ, and the token cache is dropped", () => {
      const { o } = self({ dictionaryCustomWords: { a: { simplified: "火锅" }, b: { simplified: "学习", traditional: "學習" }, c: { simplified: "好", traditional: "好" } } });
      putCachedTokens("something cached", []);
      o.refreshTokenizerCustomWords();
      expect(o.tokenizer.setOverrides).toHaveBeenCalledWith([
        { surface: "火锅", mergeAs: "火锅" },
        { surface: "学习", mergeAs: "学习" },
        { surface: "學習", mergeAs: "學習" },
        { surface: "好", mergeAs: "好" },
      ]);
      expect(o.tokenizer.invalidate).toHaveBeenCalled();
      expect(getCachedTokens("something cached")).toBeUndefined();
    });
  });

  describe("merging another device's dictionary data", () => {
    it("takes entries that are new or newer, keeps ours when ours is newer or equal, and ignores an entry with no timestamp against ours", async () => {
      const { o } = self({
        dictionaryOverrides: { "学习|xue2xi2": { updatedAt: "2026-02-01T00:00:00.000Z", pinyin: "ours" }, "天气|tian1qi4": { updatedAt: "2026-02-01T00:00:00.000Z", pinyin: "ours" } },
        dictionaryCustomWords: { 火锅: { updatedAt: "2026-02-01T00:00:00.000Z", pinyin: "ours" } },
      });
      await o.mergeMirroredDictionaryData(
        { "学习|xue2xi2": { updatedAt: "2026-03-01T00:00:00.000Z", pinyin: "theirs" }, "天气|tian1qi4": { updatedAt: "2026-01-01T00:00:00.000Z", pinyin: "older" }, "新|xin1": { pinyin: "no stamp" } },
        { 火锅: { updatedAt: "2026-01-01T00:00:00.000Z", pinyin: "older" }, 麻辣: { updatedAt: "2026-01-01T00:00:00.000Z", pinyin: "new" } }
      );
      expect(o.dictionaryOverrides["学习|xue2xi2"].pinyin).toBe("theirs");
      expect(o.dictionaryOverrides["天气|tian1qi4"].pinyin).toBe("ours");
      expect(o.dictionaryOverrides["新|xin1"].pinyin).toBe("no stamp");
      expect(o.dictionaryCustomWords["火锅"].pinyin).toBe("ours");
      expect(o.dictionaryCustomWords["麻辣"].pinyin).toBe("new");
      expect(o.updateDataBlob).toHaveBeenCalled();
      expect(o.dictionary.reload).toHaveBeenCalled();
      expect(o.vocab.clearSurfaceCache).toHaveBeenCalled();
      expect(o.tokenizer.setOverrides).toHaveBeenCalled();
      expect(o.refreshChineseViews).toHaveBeenCalled();
      expect(o.refreshStatsViews).toHaveBeenCalled();
      expect(o.vocab.flushSave).not.toHaveBeenCalled(); // no echo write back to the mirror
    });

    it("does nothing at all when there is nothing new", async () => {
      const { o } = self({ dictionaryOverrides: { "学习|xue2xi2": { updatedAt: "2026-02-01T00:00:00.000Z" } }, dictionaryCustomWords: { 火锅: { updatedAt: "2026-02-01T00:00:00.000Z" } } });
      await o.mergeMirroredDictionaryData({ "学习|xue2xi2": { updatedAt: "2026-02-01T00:00:00.000Z" } }, { 火锅: { updatedAt: "2026-01-01T00:00:00.000Z" } });
      expect(o.updateDataBlob).not.toHaveBeenCalled();
      expect(o.dictionary.reload).not.toHaveBeenCalled();
    });

    it("reads an override key written by an older version in the key's current spelling", async () => {
      const { o } = self();
      await o.mergeMirroredDictionaryData({ "学习|xue2 xi2": { updatedAt: "2026-03-01T00:00:00.000Z", pinyin: "legacy" } }, {});
      expect(Object.keys(o.dictionaryOverrides)).toHaveLength(1);
      expect(Object.values<any>(o.dictionaryOverrides)[0].pinyin).toBe("legacy");
    });

    it("an entry that is null or has no stamp on either side is handled", async () => {
      const { o } = self({ dictionaryOverrides: { "学习|xue2xi2": {} } });
      await o.mergeMirroredDictionaryData({ "学习|xue2xi2": {} as any }, { 麻辣: {} as any });
      expect(o.dictionaryCustomWords["麻辣"]).toBeDefined();
    });
  });

  it("re-reading the vocabulary mirror redraws everything", async () => {
    const reloadMirror = vi.fn(async () => {});
    const o: any = bind({ vocab: { reloadMirror }, startSyncMirrorPoller: vi.fn(), refreshChineseViews: vi.fn(), refreshStatsViews: vi.fn() });
    await o.refreshSyncMirror();
    expect(reloadMirror).toHaveBeenCalled();
    expect(o.startSyncMirrorPoller).toHaveBeenCalled();
    expect(o.refreshChineseViews).toHaveBeenCalled();
    expect(o.refreshStatsViews).toHaveBeenCalled();
  });
});
