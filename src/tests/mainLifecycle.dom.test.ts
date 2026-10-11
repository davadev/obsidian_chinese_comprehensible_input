// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { fakeApp } from "./__mocks__/mainHarness";
import { VIEW_TYPE_CHINESE, VIEW_TYPE_STATS } from "../constants";

/**
 * Loading the whole plugin, with the real services on an in-memory vault and a workspace that records what was
 * registered. This is the plugin's spine: the crash counter is read and advanced BEFORE anything risky, a plugin that
 * has crashed too often disables itself instead of loading, a failed load is shown to the user (and rethrown), and a
 * good load registers its views, commands, events and timers, merges the stored settings with the defaults (migrating
 * old shapes), and starts the background work only once the layout is ready.
 */

installObsidianDom();

const modal = vi.hoisted(() => ({ choice: "later" as string, opened: 0 }));
vi.mock("../ui/RestoreBackupModal", () => ({
  RestoreBackupModal: class {
    constructor(_a: unknown, _i: unknown, private resolve: (c: string) => void) {}
    open() {
      modal.opened++;
      this.resolve(modal.choice);
    }
  },
}));
const indexer = vi.hoisted(() => ({ indexVaultWithNotice: vi.fn(async () => {}) }));
vi.mock("../vocabulary/VaultIndexer", () => indexer);

import CciPlugin from "../main";

const MANIFEST = { id: "chinese-comprehensible-input", name: "CCI", version: "0.8.0-beta.1", dir: ".obsidian/plugins/chinese-comprehensible-input" };
const CRASH_FILE = `${MANIFEST.dir}/crash-state.json`;

function load(opts: { data?: unknown; crash?: unknown; mobile?: boolean } = {}) {
  const env = fakeApp();
  if (opts.crash !== undefined) env.files.set(CRASH_FILE, JSON.stringify(opts.crash));
  Platform.isMobile = !!opts.mobile;
  const plugin = new CciPlugin(env.app, MANIFEST as never) as any;
  plugin.data = opts.data ?? null;
  return { plugin, ...env };
}
const crashState = (env: { files: Map<string, string> }) => JSON.parse(env.files.get(CRASH_FILE) ?? "null");

beforeEach(() => {
  Notice.instances.length = 0;
  modal.choice = "later";
  modal.opened = 0;
  indexer.indexVaultWithNotice.mockClear();
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Platform.isMobile = false;
  document.body.innerHTML = "";
});

describe("the crash guard at the start of onload", () => {
  it("advances the counter before the rest of the plugin starts, and resets it after 30 seconds of running", async () => {
    const env = load({ crash: { counter: 2, autoDisabled: false } });
    let counterWhenDataWasRead: unknown;
    const realLoad = env.plugin.loadData.bind(env.plugin);
    env.plugin.loadData = async () => ((counterWhenDataWasRead = crashState(env)), realLoad());
    await env.plugin.onload();
    expect(counterWhenDataWasRead).toEqual({ counter: 3, autoDisabled: false });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(crashState(env).counter).toBe(3);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(crashState(env)).toEqual({ counter: 0, autoDisabled: false });
  });

  it("a first launch (no state file yet) starts counting from one", async () => {
    const env = load();
    let seen: unknown;
    const realLoad = env.plugin.loadData.bind(env.plugin);
    env.plugin.loadData = async () => ((seen = crashState(env)), realLoad());
    await env.plugin.onload();
    expect(seen).toEqual({ counter: 1, autoDisabled: false });
  });

  it("after too many launches that never proved themselves, the plugin disables itself and does not load", async () => {
    const env = load({ crash: { counter: 5, autoDisabled: false } });
    await env.plugin.onload();
    expect(env.app.plugins.disablePlugin).toHaveBeenCalledWith(MANIFEST.id);
    expect(Notice.instances.at(-1)!.message).toContain("auto-disabled: hit 5 crashes in a row");
    expect(Notice.instances.at(-1)!.duration).toBe(0);
    expect(env.plugin.views.size).toBe(0);
    expect(env.plugin.commands).toHaveLength(0);
    expect(crashState(env)).toEqual({ counter: 0, autoDisabled: true });
  });

  it("a plugin that was auto-disabled and is switched on again clears the flag and stays off once, saying why", async () => {
    const env = load({ crash: { counter: 0, autoDisabled: true } });
    await env.plugin.onload();
    expect(Notice.instances.at(-1)!.message).toContain("auto-disabled after repeated crashes");
    expect(env.app.plugins.disablePlugin).toHaveBeenCalled();
    expect(env.plugin.views.size).toBe(0);
    expect(crashState(env)).toEqual({ counter: 0, autoDisabled: false });
  });

  it("when the app has no plugin manager the disable is skipped without an error", async () => {
    const env = load({ crash: { counter: 5, autoDisabled: false } });
    env.app.plugins = undefined;
    await expect(env.plugin.onload()).resolves.toBeUndefined();
  });

  it("a counter file that cannot be written never stops the plugin loading", async () => {
    const env = load();
    env.adapter.write.mockImplementation(async (p: string) => {
      if (p === CRASH_FILE) throw new Error("EIO");
    });
    await env.plugin.onload();
    expect(env.plugin.views.size).toBe(2);
  });

  it("a probe that throws outright (a broken manifest path) never stops the plugin loading", async () => {
    const env = load();
    const real = env.plugin.crashStatePath;
    env.plugin.crashStatePath = () => {
      throw new Error("no manifest");
    };
    void real;
    await env.plugin.onload();
    expect(env.plugin.views.size).toBe(2);
    expect(console.warn).toHaveBeenCalledWith("CCI crash-counter probe failed", expect.any(Error));
  });
});

describe("a load that fails", () => {
  it("shows the actual error to the user (there is no console on a phone) and rethrows it", async () => {
    const env = load();
    env.plugin.loadData = async () => {
      throw new Error("data.json is unreadable");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(env.plugin.onload()).rejects.toThrow("data.json is unreadable");
    expect(Notice.instances.at(-1)!.message).toBe("Chinese plugin failed to load: data.json is unreadable");
    expect(Notice.instances.at(-1)!.duration).toBe(0);
    expect(crashState(env).counter).toBe(1); // not reset: the next start counts it
    await vi.advanceTimersByTimeAsync(60_000);
    expect(crashState(env).counter).toBe(1);
  });

  it("an error without a message is still reported", async () => {
    const env = load();
    env.plugin.loadData = async () => {
      throw "plain string";
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(env.plugin.onload()).rejects.toBe("plain string");
    expect(Notice.instances.at(-1)!.message).toContain("plain string");
  });
}) ;

describe("what a good load sets up", () => {
  it("registers both views, the settings tab, the commands, and one interval each for the poller, the daily story and the crash reset", async () => {
    const env = load();
    await env.plugin.onload();
    expect([...env.plugin.views.keys()].sort()).toEqual([VIEW_TYPE_CHINESE, VIEW_TYPE_STATS].sort());
    expect(env.plugin.settingTabs).toHaveLength(1);
    expect(env.plugin.commands.map((c: any) => c.id)).toContain("backup-now");
    expect(env.plugin.intervals.length).toBeGreaterThanOrEqual(3);
  });

  it("the view factories build the real views for a leaf", async () => {
    const env = load();
    await env.plugin.onload();
    const leaf = { view: undefined } as any;
    expect(env.plugin.views.get(VIEW_TYPE_CHINESE)!(leaf).getViewType()).toBe(VIEW_TYPE_CHINESE);
    expect(env.plugin.views.get(VIEW_TYPE_STATS)!(leaf).getViewType()).toBe(VIEW_TYPE_STATS);
  });

  it("the ribbon button exists on a phone only (on desktop the header action does the job), and opens the current note", async () => {
    const desktop = load({ mobile: false });
    await desktop.plugin.onload();
    expect(desktop.plugin.ribbon).toHaveLength(0);
    const phone = load({ mobile: true });
    await phone.plugin.onload();
    expect(phone.plugin.ribbon).toHaveLength(1);
    expect(phone.plugin.ribbon[0].icon).toBe("cci-zhong");
    phone.plugin.openCurrentInChineseView = vi.fn(async () => {});
    phone.plugin.ribbon[0].cb();
    expect(phone.plugin.openCurrentInChineseView).toHaveBeenCalled();
  });

  it("the tokenizer weights words by what the learner knows: known most, unknown next, anything else least, no record none", async () => {
    const env = load();
    await env.plugin.onload();
    const ctx = (env.plugin.tokenizer as any).scoringCtx;
    const status: Record<string, string> = { 甲: "known", 乙: "unknown", 丙: "meaningKnownPinyinUnknown" };
    env.plugin.vocab.bySurface = (s: string) => (status[s] ? { status: status[s] } : undefined);
    expect([ctx.hasRecord("甲"), ctx.hasRecord("戊")]).toEqual([true, false]);
    expect(["甲", "乙", "丙", "戊"].map((s) => ctx.knownBoost(s))).toEqual([0.3, 0.2, 0.1, 0]);
  });

  it("the services read the live settings: the AI section, the story folder, the dictionary overlay and the mirror bridge", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, story: { folder: "My Stories" } }, dictionaryOverrides: { "学|xue2": { updatedAt: "2026-01-01T00:00:00.000Z" } }, dictionaryCustomWords: { 火锅: { simplified: "火锅", updatedAt: "2026-01-01T00:00:00.000Z" } } } });
    await env.plugin.onload();
    const p = env.plugin;
    for (const service of ["tokenizer", "exposure", "srs", "story", "enhance", "mnemonic"]) {
      expect((p[service] as any).settings(), service).toBe(p.settings);
    }
    expect((p.ai as any).getSettings()).toBe(p.settings.ai);
    expect((p.ai as any).getDebugFolder()).toBe("My Stories");
    expect(Object.keys((p.dictionary as any).getOverrides())).toEqual(["学|xue2"]);
    expect(Object.keys((p.dictionary as any).getCustomWords())).toEqual(["火锅"]);
    const bridge = (p.vocab as any).dictBridge;
    expect(Object.keys(bridge.getOverrides())).toEqual(["学|xue2"]);
    expect(Object.keys(bridge.getCustomWords())).toEqual(["火锅"]);
    p.mergeMirroredDictionaryData = vi.fn(async () => {});
    await bridge.mergeRemote({ a: 1 }, { b: 2 });
    expect(p.mergeMirroredDictionaryData).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
  });

  it("AI usage reported by the provider is recorded in the settings", async () => {
    const env = load();
    await env.plugin.onload();
    (env.plugin.ai as any).onUsage({ ts: Date.now(), provider: "openai", inputTokens: 5, cachedInputTokens: 0, outputTokens: 1 });
    expect(env.plugin.settings.ai.usageLog).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
  });
});

describe("the stored settings are merged with the defaults", () => {
  it("a blob with nothing in it loads the defaults, and derives the HSK palette from the accent once", async () => {
    const env = load();
    await env.plugin.onload();
    expect(env.plugin.settings.hskColorsDerivedFromAccent).toBe(true);
    expect(Object.keys(env.plugin.settings.customColors.hsk)).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(0);
    expect((env.plugin.data as any).settings.hskColorsDerivedFromAccent).toBe(true);
  });

  it("an already-derived palette is left as the user saved it", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, customColors: { hsk: { "1": "#123456" } } } } });
    await env.plugin.onload();
    expect(env.plugin.settings.customColors.hsk["1"]).toBe("#123456");
    expect(env.plugin.settings.customColors.hsk["7"]).toBeTruthy(); // missing sub-keys come from the defaults
  });

  it("older blobs missing newer keys get them, colours merge key by key, text colours merge too", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, customColors: { known: "#010203" }, textColors: { enabled: true } } } });
    await env.plugin.onload();
    expect(env.plugin.settings.customColors.known).toBe("#010203");
    expect(env.plugin.settings.customColors.partial).toBeTruthy();
    expect(env.plugin.settings.textColors).toMatchObject({ enabled: true });
    expect(env.plugin.settings.textColors.chars).toBeTruthy();
  });

  it("a stored blob with no colour sections at all still ends up with them", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, customColors: undefined, textColors: undefined } } });
    await env.plugin.onload();
    expect(env.plugin.settings.customColors.known).toBeTruthy();
    expect(env.plugin.settings.textColors.chars).toBeTruthy();
  });

  it("the two retired display modes become 'none'", async () => {
    for (const mode of ["popup-only", "color-only"]) {
      const env = load({ data: { settings: { defaultDisplayMode: mode, hskColorsDerivedFromAccent: true } } });
      await env.plugin.onload();
      expect(env.plugin.settings.defaultDisplayMode, mode).toBe("none");
    }
  });

  it("an old flat AI shape is folded into the current one, and a key found in it is moved to the device-local store, never kept in the settings", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, ai: { enabled: true, apiKey: "sk-legacy", baseUrl: "http://old:11434/v1", chatModel: "old-model" } } } });
    await env.plugin.onload();
    expect(env.plugin.settings.ai.ollama.chatModel).toBe("old-model");
    expect(env.plugin.settings.ai.ollama.apiKey).toBe("");
    expect(env.storage.get("cci-ai-apikey-ollama")).toBe("sk-legacy");
  });

  it("the AI section merges key by key and keeps the usage log; a key that slipped into data.json is dropped from the settings and rescued", async () => {
    const log = [{ ts: 1, provider: "openai", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }];
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, ai: { enabled: true, usageLog: log, ollama: { apiKey: "sk-in-blob", chatModel: "m" } } } } });
    await env.plugin.onload();
    expect(env.plugin.settings.ai.usageLog).toEqual(log);
    expect(env.plugin.settings.ai.ollama.apiKey).toBe("");
    expect(env.plugin.settings.ai.ollama.chatModel).toBe("m");
    expect(env.plugin.settings.ai.ollama.baseUrl).toBeTruthy();
    expect(env.storage.get("cci-ai-apikey-ollama")).toBe("sk-in-blob");
  });

  it("an AI section without a usage log gets an empty one", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, ai: { enabled: true, ollama: { chatModel: "m" } } } } });
    await env.plugin.onload();
    expect(env.plugin.settings.ai.usageLog).toEqual([]);
  });

  it("the stored script is what the reader is built for, so loading re-tokenizes nothing", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true, scriptVariant: "traditional", pronunciationRegion: "taiwan" } } });
    await env.plugin.onload();
    expect([env.plugin.lastAppliedScriptVariant, env.plugin.lastAppliedRegion]).toEqual(["traditional", "taiwan"]);
    expect(env.app.workspace.getLeavesOfType).not.toHaveBeenCalledWith(VIEW_TYPE_STATS);
  });
});

describe("dictionary overrides at load", () => {
  const legacy = { "女|nü53": { updatedAt: "2026-01-01T00:00:00.000Z", pinyin: "nǚ" } };

  it("legacy keys are re-keyed once and written back, without touching the mirror", async () => {
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true }, dictionaryOverrides: legacy } });
    await env.plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(env.plugin.dictionaryOverrides)).toEqual(["女|nü3"]);
    expect(Object.keys((env.plugin.data as any).dictionaryOverrides)).toEqual(["女|nü3"]);
  });

  it("a failed write-back is logged and does not fail the load (it simply runs again next launch)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = load({ data: { settings: { hskColorsDerivedFromAccent: true }, dictionaryOverrides: legacy } });
    const realSave = env.plugin.saveData.bind(env.plugin);
    let calls = 0;
    env.plugin.saveData = async (d: unknown) => {
      if (++calls > 0 && (d as any).dictionaryOverrides && !(d as any).__failedOnce) {
        (d as any).__failedOnce = true;
        throw new Error("disk full");
      }
      return realSave(d);
    };
    await env.plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    expect(err).toHaveBeenCalledWith("CCI: override key migration write failed", expect.any(Error));
    expect(env.plugin.views.size).toBe(2);
  });

  it("custom words are loaded as stored, and a blob without either map loads empty ones", async () => {
    const withWords = load({ data: { settings: { hskColorsDerivedFromAccent: true }, dictionaryCustomWords: { 火锅: { simplified: "火锅", pinyin: "huǒ guō", definitions: [], createdAt: "x", updatedAt: "y" } } } });
    await withWords.plugin.onload();
    expect(Object.keys(withWords.plugin.dictionaryCustomWords)).toEqual(["火锅"]);
    const empty = load();
    await empty.plugin.onload();
    expect(empty.plugin.dictionaryCustomWords).toEqual({});
    expect(empty.plugin.dictionaryOverrides).toEqual({});
  });
});

describe("events and timers wired at load", () => {
  const loaded = async (opts: Parameters<typeof load>[0] = {}) => {
    const env = load(opts);
    await env.plugin.onload();
    const ws = (name: string) => env.workspaceHandlers.find((h) => h.name === name)!.cb;
    return { ...env, ws };
  };

  it("opening a file or changing the layout adds the Markdown header buttons; a layout change also re-evaluates the poller", async () => {
    const { plugin, ws } = await loaded();
    plugin.injectMarkdownHeaderActions = vi.fn();
    plugin.restartSyncPollerIfModeChanged = vi.fn();
    ws("file-open")();
    expect(plugin.injectMarkdownHeaderActions).toHaveBeenCalledTimes(1);
    ws("layout-change")();
    expect(plugin.injectMarkdownHeaderActions).toHaveBeenCalledTimes(2);
    expect(plugin.restartSyncPollerIfModeChanged).toHaveBeenCalledTimes(1);
  });

  it("switching to a Chinese view checks the mirror at once; other views, and no view, do not; the settings mirror is checked either way", async () => {
    const { plugin, ws } = await loaded();
    plugin.restartSyncPollerIfModeChanged = vi.fn();
    plugin.checkMirrorOnce = vi.fn(async () => {});
    plugin.checkSettingsMirrorOnce = vi.fn(async () => {});
    ws("active-leaf-change")({ view: { getViewType: () => VIEW_TYPE_CHINESE } });
    expect(plugin.checkMirrorOnce).toHaveBeenCalledTimes(1);
    ws("active-leaf-change")({ view: { getViewType: () => "markdown" } });
    ws("active-leaf-change")({ view: {} });
    ws("active-leaf-change")(null);
    expect(plugin.checkMirrorOnce).toHaveBeenCalledTimes(1);
    expect(plugin.checkSettingsMirrorOnce).toHaveBeenCalledTimes(4);
    expect(plugin.restartSyncPollerIfModeChanged).toHaveBeenCalledTimes(4);
  });

  it("coming back to the window checks the settings mirror (the user was probably editing on the other device)", async () => {
    const { plugin } = await loaded();
    plugin.checkSettingsMirrorOnce = vi.fn(async () => {});
    const focus = plugin.domEvents.find((d: any) => d.type === "focus")!;
    expect(focus.target).toBe(window);
    focus.cb();
    expect(plugin.checkSettingsMirrorOnce).toHaveBeenCalled();
  });

  it("the Markdown header buttons are also added once the layout is ready", async () => {
    const { plugin, layoutReady } = await loaded();
    plugin.injectMarkdownHeaderActions = vi.fn();
    layoutReady[0]();
    expect(plugin.injectMarkdownHeaderActions).toHaveBeenCalledTimes(1);
  });
});

describe("after the layout is ready", () => {
  const ready = async (opts: Parameters<typeof load>[0] = {}) => {
    const env = load(opts);
    await env.plugin.onload();
    env.plugin.bootstrapVocabMirror = vi.fn(async () => {});
    env.plugin.promptDowngradeRestore = vi.fn(async () => {});
    env.plugin.tickAutoStory = vi.fn(async () => {});
    env.plugin.settingsMirror.bootstrap = vi.fn(async () => {});
    return env;
  };

  it("merges the vocabulary mirror and bootstraps the settings mirror, asks the downgrade question only after both, and checks for a daily story shortly after", async () => {
    const env = await ready();
    const order: string[] = [];
    env.plugin.bootstrapVocabMirror = vi.fn(async () => void order.push("vocab"));
    env.plugin.settingsMirror.bootstrap = vi.fn(async () => void order.push("settings"));
    env.plugin.promptDowngradeRestore = vi.fn(async () => void order.push("prompt"));
    env.layoutReady[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["vocab", "settings", "prompt"]);
    expect(env.plugin.tickAutoStory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(env.plugin.tickAutoStory).toHaveBeenCalledTimes(1);
  });

  it("a settings mirror that fails to bootstrap is logged and the downgrade question still gets asked", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await ready();
    env.plugin.settingsMirror.bootstrap = vi.fn(async () => {
      throw new Error("stalled");
    });
    env.layoutReady[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(err).toHaveBeenCalledWith("CCI settings mirror bootstrap failed", expect.any(Error));
    expect(env.plugin.promptDowngradeRestore).toHaveBeenCalled();
  });

  it("a downgrade prompt that fails is only logged", async () => {
    const env = await ready();
    env.plugin.promptDowngradeRestore = vi.fn(async () => {
      throw new Error("modal failed");
    });
    env.layoutReady[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(console.warn).toHaveBeenCalledWith("CCI: downgrade prompt failed", expect.any(Error));
  });

  it("the daily story is also checked every five minutes", async () => {
    const env = await ready();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(env.plugin.tickAutoStory).toHaveBeenCalledTimes(1);
  });

  it("a failing background bootstrap is logged, never thrown into load", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = load();
    env.plugin.bootstrapVault = vi.fn(async () => {
      throw new Error("bootstrap boom");
    });
    await env.plugin.onload();
    await vi.advanceTimersByTimeAsync(0);
    expect(err).toHaveBeenCalledWith("CCI bootstrap failed", expect.any(Error));
  });
});

describe("unloading a loaded plugin", () => {
  it("flushes without error", async () => {
    const env = load();
    await env.plugin.onload();
    env.plugin.onunload();
    await vi.advanceTimersByTimeAsync(0);
    expect(crashState(env).counter).toBe(0);
  });
});
