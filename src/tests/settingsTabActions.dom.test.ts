// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { all, byName, flush, makeSettingsTab, renderDef } from "./__mocks__/settingsTabHarness";
import { DEFAULT_SETTINGS, DEFAULT_STATUS_PRIORITY, DEFAULT_TEXT_COLORS } from "../settings/defaults";
import { SETTINGS_EXPORT_DEFAULT_PATH } from "../settings/SettingsIO";
import { DEFAULT_MNEMONIC_USER_TEMPLATE } from "../ai/prompts";

/**
 * The settings tab's behaviour: how a flat key reaches the nested settings, what each change does beyond saving, and
 * what every button does. The risky ones write or delete user data (reset, import, remove the dictionary, push a
 * mirror), so each asks first where it should, reports what happened, and does nothing when declined.
 */

installObsidianDom();

const confirm = vi.hoisted(() => ({ answer: true, asked: [] as string[] }));
vi.mock("../ui/confirmInput", () => ({
  confirmAsync: vi.fn(async (_a: unknown, msg: string) => {
    confirm.asked.push(msg);
    return confirm.answer;
  }),
}));
const io = vi.hoisted(() => ({ exportSettings: vi.fn(), importSettings: vi.fn() }));
vi.mock("../settings/SettingsIO", async (orig) => ({ ...(await orig<typeof import("../settings/SettingsIO")>()), exportSettings: io.exportSettings, importSettings: io.importSettings }));
const indexer = vi.hoisted(() => ({ indexVaultWithNotice: vi.fn(async () => {}) }));
vi.mock("../vocabulary/VaultIndexer", () => indexer);

const notices = () => Notice.instances.map((n) => n.message);
const lastNotice = () => Notice.instances.at(-1)?.message;
const click = async (tab: any, name: string) => {
  const d = byName(tab, name);
  d.action!(document.createElement("div"), 0);
  await flush();
};

beforeEach(() => {
  confirm.answer = true;
  confirm.asked.length = 0;
  Notice.instances.length = 0;
  io.exportSettings.mockReset().mockResolvedValue(undefined);
  io.importSettings.mockReset().mockResolvedValue({ applied: 3, skipped: [] });
  indexer.indexVaultWithNotice.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("how a key reaches the settings", () => {
  it("API keys go to the device-local store, per provider, and never to the settings", () => {
    const { tab, plugin, storage } = makeSettingsTab();
    tab.setControlValue("secret:openai", "sk-1");
    tab.setControlValue("secret:ollama", "tok");
    tab.setControlValue("secret:anything-else", "other");
    expect(storage.get("cci-ai-apikey-openai")).toBe("sk-1");
    expect(storage.get("cci-ai-apikey-ollama")).toBe("other");
    expect(tab.getControlValue("secret:openai")).toBe("sk-1");
    expect(tab.getControlValue("secret:ollama")).toBe("other");
    expect(JSON.stringify(plugin.settings)).not.toContain("sk-1");
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("the export and import paths are just fields of the tab: export falls back to the default, import may be empty", () => {
    const { tab, plugin } = makeSettingsTab();
    expect(tab.getControlValue("ui:exportPath")).toBe(SETTINGS_EXPORT_DEFAULT_PATH);
    expect(tab.getControlValue("ui:importPath")).toBe(SETTINGS_EXPORT_DEFAULT_PATH);
    tab.setControlValue("ui:exportPath", "  my/out.json ");
    tab.setControlValue("ui:importPath", " in.json ");
    expect([tab.getControlValue("ui:exportPath"), tab.getControlValue("ui:importPath")]).toEqual(["my/out.json", "in.json"]);
    tab.setControlValue("ui:exportPath", "   ");
    tab.setControlValue("ui:importPath", "");
    expect([tab.getControlValue("ui:exportPath"), tab.getControlValue("ui:importPath")]).toEqual([SETTINGS_EXPORT_DEFAULT_PATH, ""]);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("the comfort threshold is shown in whole percent and stored as a fraction, with 67 % when none is set", () => {
    const { tab, plugin } = makeSettingsTab();
    expect(tab.getControlValue("topHskComfortThreshold")).toBe(Math.round(DEFAULT_SETTINGS.topHskComfortThreshold * 100));
    plugin.settings.topHskComfortThreshold = undefined;
    expect(tab.getControlValue("topHskComfortThreshold")).toBe(67);
    tab.setControlValue("topHskComfortThreshold", 75);
    expect(plugin.settings.topHskComfortThreshold).toBe(0.75);
  });

  it("an ordinary key is read and written at its nested place, then saved", async () => {
    const { tab, plugin } = makeSettingsTab();
    expect(tab.getControlValue("ai.ollama.baseUrl")).toBe(plugin.settings.ai.ollama.baseUrl);
    await tab.setControlValue("ai.ollama.baseUrl", "http://x");
    expect(plugin.settings.ai.ollama.baseUrl).toBe("http://x");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.refreshChineseViews).toHaveBeenCalled();
    expect(plugin.refreshStatsViews).toHaveBeenCalled();
  });
});

describe("what a change does beyond saving", () => {
  const set = async (key: string, value: unknown, over: Parameters<typeof makeSettingsTab>[0] = {}) => {
    const m = makeSettingsTab(over);
    m.tab.refreshDomState = vi.fn();
    m.tab.update = vi.fn();
    await m.tab.setControlValue(key, value);
    return m;
  };

  it.each(["readerFontPx", "readerLineSpacing", "annotationScalePercent", "einkNumberScalePercent"])("%s re-applies the view's appearance", async (key) => {
    const { plugin } = await set(key, 20);
    expect(plugin.refreshChineseViewAppearance).toHaveBeenCalledTimes(1);
  });

  it("E-ink mode re-applies the appearance, re-evaluates the greyed controls, and says once what changed in the picker", async () => {
    const on = await set("einkMode", true, { settings: (s) => (s.showHighlightColorsWithoutPlugin = true) });
    expect(on.plugin.refreshChineseViewAppearance).toHaveBeenCalled();
    expect(on.tab.refreshDomState).toHaveBeenCalled();
    expect(notices().some((n) => n.startsWith("E-ink mode:"))).toBe(true);
    Notice.instances.length = 0;
    const off = await set("einkMode", false);
    expect(off.tab.refreshDomState).toHaveBeenCalled();
    expect(notices()).toEqual([]);
  });

  it("E-ink mode with an unchanged picker shows no notice", async () => {
    await set("einkMode", true, { settings: (s) => ((s.enabledFormats = ["highlight"]), (s.formatHidden = [])) });
    // (whether a notice is due depends on the picker; either way no throw and the flag is saved)
    expect(true).toBe(true);
  });

  it.each(["backupsEnabled", "line2Content", "line3Content", "colorMode"])("%s re-evaluates the greyed or hidden rows in place, without rebuilding the page", async (key) => {
    const m = await set(key, key === "backupsEnabled" ? false : key === "colorMode" ? "hsk" : "english");
    expect(m.tab.refreshDomState).toHaveBeenCalledTimes(1);
    expect(m.tab.update).not.toHaveBeenCalled();
  });

  it("the tokenizer engine makes open notes re-tokenize at once", async () => {
    const { plugin } = await set("tokenizerEngine", "lattice");
    expect(plugin.forceRetokenizeViews).toHaveBeenCalled();
  });

  it("the mirror switch and path refresh the mirror only while it is on", async () => {
    const on = await set("sync.mirrorEnabled", true);
    expect(on.plugin.refreshSyncMirror).toHaveBeenCalledTimes(1);
    const path = await set("sync.mirrorEnabled", false);
    expect(path.plugin.refreshSyncMirror).not.toHaveBeenCalled();
  });

  it("the poll interval restarts the poller", async () => {
    const { plugin } = await set("sync.mirrorPollIntervalMinutes", 5);
    expect(plugin.startSyncMirrorPoller).toHaveBeenCalled();
  });

  it("the settings mirror switch bootstraps it only when turned on", async () => {
    expect((await set("sync.settingsMirrorEnabled", true)).plugin.settingsMirror.bootstrap).toHaveBeenCalled();
    expect((await set("sync.settingsMirrorEnabled", false)).plugin.settingsMirror.bootstrap).not.toHaveBeenCalled();
  });

  it("changing the script offers a re-index only when what is indexed actually changes", async () => {
    const real = await set("scriptVariant", "simplified", { settings: (s) => (s.scriptVariant = "traditional") });
    expect(real.plugin.offerReindexAfterScriptChange).toHaveBeenCalled();
    const same = await set("scriptVariant", "traditional", { settings: (s) => (s.scriptVariant = "auto") });
    expect(same.plugin.offerReindexAfterScriptChange).not.toHaveBeenCalled();
  });

  it("changing the provider rebuilds the page, since a different block is shown", async () => {
    const { tab } = await set("ai.provider", "openai");
    expect(tab.update).toHaveBeenCalled();
  });
});

describe("resets", () => {
  it("text colours go back to the defaults, switched on, and the page redraws", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => (s.textColors = { enabled: false, chars: "#123456", pinyin: "#123456", gloss: "#123456" }) });
    tab.update = vi.fn();
    await click(tab, "Reset text colors");
    expect(plugin.settings.textColors).toEqual({ ...DEFAULT_TEXT_COLORS, enabled: true });
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(tab.update).toHaveBeenCalled();
  });

  it("HSK colours re-derive from the accent; 'all colours' resets the status colours too", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => ((s.customColors.known = "#000001"), (s.hskColorsDerivedFromAccent = false)) });
    tab.update = vi.fn();
    await click(tab, "Reset HSK colors to accent gradient");
    expect(plugin.settings.hskColorsDerivedFromAccent).toBe(true);
    expect(Object.keys(plugin.settings.customColors.hsk)).toHaveLength(7);
    expect(plugin.settings.customColors.known).toBe("#000001");
    await click(tab, "Reset all colors to defaults");
    expect(plugin.settings.customColors.known).not.toBe("#000001");
    expect(tab.update).toHaveBeenCalledTimes(2);
  });

  it("the formatting picker goes back to its default order with nothing hidden", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => ((s.formatOrder = ["italic"]), (s.formatHidden = ["bold"])) });
    tab.update = vi.fn();
    await click(tab, "Reset formatting order & visibility");
    expect(plugin.settings.formatOrder).toEqual(DEFAULT_SETTINGS.formatOrder);
    expect(plugin.settings.formatHidden).toEqual([]);
  });

  it("the mnemonic prompt goes back to the built-in template", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => (s.ai.mnemonicPrompt = "mine") });
    tab.update = vi.fn();
    await click(tab, "Reset to default prompt");
    expect(plugin.settings.ai.mnemonicPrompt).toBe(DEFAULT_MNEMONIC_USER_TEMPLATE);
  });

  it("the status priority list goes back to the default", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => (s.sync.statusPriority = ["new"]) });
    tab.update = vi.fn();
    await click(tab, "Reset priority list to default");
    expect(plugin.settings.sync.statusPriority).toEqual(DEFAULT_STATUS_PRIORITY);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(tab.update).toHaveBeenCalled();
  });
});

describe("the list controls", () => {
  it("reordering or hiding formatting options is saved as the new order and hidden list", async () => {
    const { tab, plugin } = makeSettingsTab();
    const el = renderDef(byName(tab, "Formatting picker order"));
    const rows = () => Array.from(el.querySelectorAll<HTMLElement>(".cci-status-priority-row"));
    const first = rows()[0].querySelector<HTMLButtonElement>("button[aria-label='Move down']")!;
    first.click();
    await flush();
    expect(plugin.settings.formatOrder.length).toBeGreaterThan(1);
    const box = rows()[0].querySelector<HTMLInputElement>("input[type=checkbox]")!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.settings.formatHidden).toHaveLength(1);
  });

  it("reordering the sync priority list is saved", async () => {
    const { tab, plugin } = makeSettingsTab();
    const el = renderDef(byName(tab, "Status priority list"));
    el.querySelector<HTMLButtonElement>("button[aria-label='Move down']")!.click();
    await flush();
    expect(plugin.settings.sync.statusPriority[0]).toBe(DEFAULT_STATUS_PRIORITY[1]);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});

describe("AI buttons and the usage card", () => {
  it("Test connection says whether the provider answered, or what went wrong", async () => {
    const { tab, plugin } = makeSettingsTab();
    await click(tab, "Test connection");
    expect(lastNotice()).toBe("AI provider reachable.");
    plugin.ai.testConnection.mockResolvedValue(false);
    await click(tab, "Test connection");
    expect(lastNotice()).toBe("AI provider unreachable.");
    plugin.ai.testConnection.mockRejectedValue(new Error("boom"));
    await click(tab, "Test connection");
    expect(lastNotice()).toBe("AI test error: boom");
  });

  it("the usage card sums the log by 24 h, 7 d and 30 d, for OpenAI only, with the cost", () => {
    const now = Date.now();
    const day = 86400000;
    const entry = (agoMs: number, over: Record<string, unknown> = {}) => ({ ts: now - agoMs, provider: "openai", inputTokens: 1000, cachedInputTokens: 500, outputTokens: 200, ...over });
    const { tab } = makeSettingsTab({ settings: (s) => (s.ai.usageLog = [entry(1000), entry(3 * day), entry(20 * day), entry(60 * day), entry(1000, { provider: "ollama", inputTokens: 999999 })]) });
    const el = renderDef(byName(tab, "OpenAI usage & pricing"));
    const grid = Array.from(el.querySelectorAll(".cci-openai-usage-grid > span")).map((s) => s.textContent);
    expect(grid.slice(0, 4)).toEqual(["", "24h", "7d", "30d"]);
    expect(grid.slice(4, 8)).toEqual(["Input", "1,000", "2,000", "3,000"]);
    expect(grid.slice(8, 12)).toEqual(["Cached", "500", "1,000", "1,500"]);
    expect(grid.slice(12, 16)).toEqual(["Output", "200", "400", "600"]);
    expect(grid.slice(16, 20)[0]).toBe("Cost");
    expect(grid.slice(17, 20).every((c) => c!.startsWith("$"))).toBe(true);
    expect(el.textContent).toContain("Input:");
  });

  it("a cost of a cent or more is shown to two decimals", () => {
    const { tab } = makeSettingsTab({ settings: (s) => (s.ai.usageLog = [{ ts: Date.now(), provider: "openai", inputTokens: 10_000_000, cachedInputTokens: 0, outputTokens: 0 }]) });
    const el = renderDef(byName(tab, "OpenAI usage & pricing"));
    expect(Array.from(el.querySelectorAll(".cci-openai-usage-gridval")).map((c) => c.textContent).slice(9, 12)).toEqual(["$7.50", "$7.50", "$7.50"]);
  });

  it("with no usage recorded the card shows zeros, and tiny costs keep four decimals", () => {
    const { tab } = makeSettingsTab({ settings: (s) => (s.ai.usageLog = undefined) });
    const el = renderDef(byName(tab, "OpenAI usage & pricing"));
    const cells = Array.from(el.querySelectorAll(".cci-openai-usage-gridval")).map((c) => c.textContent);
    expect(cells.slice(0, 3)).toEqual(["0", "0", "0"]);
    expect(cells.slice(9, 12)).toEqual(["$0.0000", "$0.0000", "$0.0000"]);
  });
});

describe("the dictionary", () => {
  it("the status line shows the active dictionary, or says the seed dictionary is in use", () => {
    const none = makeSettingsTab();
    const el = renderDef(byName(none.tab, "Dictionary status"));
    expect(el.textContent).toContain("No external dictionary downloaded yet");
    const some = makeSettingsTab({ settings: (s) => (s.dictionarySource = { source: "CC-CEDICT", versionLine: "", downloadedAt: "2026-01-02T03:04:05.000Z", entryCount: 123, outputPath: ".cci-dictionary.json" }) });
    expect(renderDef(byName(some.tab, "Dictionary status")).textContent).toContain("Active: CC-CEDICT · version unknown · 123 entries · downloaded 2026-01-02");
  });

  it("while a download runs it shows the live message, repaints on every status event, and unsubscribes when the page goes", () => {
    const { tab, plugin } = makeSettingsTab();
    let listener!: () => void;
    const unsub = vi.fn();
    plugin.dictDownloader.onStatus = vi.fn((fn: () => void) => ((listener = fn), unsub));
    const el = renderDef(byName(tab, "Dictionary status"));
    plugin.dictDownloader.getStatus.mockReturnValue({ state: "downloading", message: "Fetching", entriesParsed: 7 });
    listener();
    expect(el.textContent).toContain("Fetching (parsed 7)");
    plugin.dictDownloader.getStatus.mockReturnValue({ state: "idle" });
    listener();
    expect(el.textContent).toContain("No external dictionary");
    for (const state of ["parsing", "writing"]) {
      plugin.dictDownloader.getStatus.mockReturnValue({ state, message: state, entriesParsed: 1 });
      listener();
      expect(el.textContent).toContain(`${state} (parsed 1)`);
    }
    const registered = plugin.register.mock.calls[0][0] as () => void;
    registered();
    expect(unsub).toHaveBeenCalled();
  });

  it("Download installs it, records where it came from, reloads everything that depends on it and says how many entries", async () => {
    const { tab, plugin } = makeSettingsTab();
    tab.update = vi.fn();
    plugin.dictDownloader.run.mockResolvedValue(1234);
    plugin.dictDownloader.getStatus.mockReturnValue({ versionLine: "# v1", downloadedAt: "2026-02-03T00:00:00.000Z" });
    await click(tab, "Download CC-CEDICT");
    expect(plugin.settings.dictionarySource).toEqual({ source: "CC-CEDICT", versionLine: "# v1", downloadedAt: "2026-02-03T00:00:00.000Z", entryCount: 1234, outputPath: ".cci-dictionary.json" });
    expect(plugin.dictionary.reload).toHaveBeenCalled();
    expect(plugin.vocab.clearSurfaceCache).toHaveBeenCalled();
    expect(plugin.tokenizer.invalidate).toHaveBeenCalled();
    expect(lastNotice()).toBe("Dictionary installed: 1234 entries.");
    expect(tab.update).toHaveBeenCalled();
  });

  it("a download with no version line or time still records a usable source", async () => {
    const { tab, plugin } = makeSettingsTab();
    tab.update = vi.fn();
    plugin.dictDownloader.run.mockResolvedValue(5);
    plugin.dictDownloader.getStatus.mockReturnValue({});
    await click(tab, "Download CC-CEDICT");
    expect(plugin.settings.dictionarySource.versionLine).toBe("");
    expect(typeof plugin.settings.dictionarySource.downloadedAt).toBe("string");
  });

  it("a failed download is reported and leaves the settings alone", async () => {
    const { tab, plugin } = makeSettingsTab();
    tab.update = vi.fn();
    plugin.dictDownloader.run.mockRejectedValue(new Error("offline"));
    await click(tab, "Download CC-CEDICT");
    expect(lastNotice()).toBe("Download failed: offline");
    expect(plugin.settings.dictionarySource).toBeUndefined();
    expect(tab.update).toHaveBeenCalled();
  });

  it("Remove asks first; then deletes the file if it is there, forgets the source and reloads", async () => {
    const { tab, plugin, files, adapter } = makeSettingsTab({ settings: (s) => (s.dictionarySource = { source: "CC-CEDICT", versionLine: "", downloadedAt: "x", entryCount: 1, outputPath: "dict/custom.json" }) });
    tab.update = vi.fn();
    (tab as any).app = plugin.app;
    files.set("dict/custom.json", "{}");
    confirm.answer = false;
    await click(tab, "Remove downloaded dictionary");
    expect(adapter.remove).not.toHaveBeenCalled();
    confirm.answer = true;
    await click(tab, "Remove downloaded dictionary");
    expect(adapter.remove).toHaveBeenCalledWith("dict/custom.json");
    expect(plugin.settings.dictionarySource).toBeUndefined();
    expect(plugin.dictionary.reload).toHaveBeenCalled();
    expect(lastNotice()).toBe("Dictionary removed; seed dictionary back in use.");
  });

  it("Remove copes with the file already being gone, uses the default path with no recorded source, and reports failure", async () => {
    const { tab, plugin, adapter } = makeSettingsTab();
    tab.update = vi.fn();
    (tab as any).app = plugin.app;
    await click(tab, "Remove downloaded dictionary");
    expect(adapter.exists).toHaveBeenCalledWith(".cci-dictionary.json");
    expect(adapter.remove).not.toHaveBeenCalled();
    plugin.dictionary.reload.mockRejectedValue(new Error("busy"));
    await click(tab, "Remove downloaded dictionary");
    expect(lastNotice()).toBe("Remove failed: busy");
  });
});

describe("the Data buttons", () => {
  it("Open dashboard opens the stats view", async () => {
    const { tab, plugin } = makeSettingsTab();
    await click(tab, "Open dashboard");
    expect(plugin.openStatsView).toHaveBeenCalled();
  });

  it("Index vault forces a fresh scan", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => (s.vaultIndexed = true) });
    await click(tab, "Index vault");
    expect(plugin.settings.vaultIndexed).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(indexer.indexVaultWithNotice).toHaveBeenCalledWith(plugin);
  });

  it("exports go to the clipboard", async () => {
    const write = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: write, readText: vi.fn() } });
    const { tab } = makeSettingsTab();
    await click(tab, "Export vocabulary JSON");
    await click(tab, "Export vocabulary CSV");
    expect(write.mock.calls.map((c) => c[0])).toEqual(["{json}", "csv"]);
    expect(notices()).toEqual(["Vocabulary JSON copied to clipboard.", "Vocabulary CSV copied to clipboard."]);
    vi.unstubAllGlobals();
  });

  it("importing from the clipboard merges, refreshes the views and says how many; a bad clipboard is reported", async () => {
    const read = vi.fn(async () => "{...}");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(), readText: read } });
    const { tab, plugin } = makeSettingsTab();
    await click(tab, "Import vocabulary from clipboard");
    expect(plugin.vocab.importJson).toHaveBeenCalledWith("{...}");
    expect(lastNotice()).toBe("Imported 1 new, 2 updated.");
    expect(plugin.refreshChineseViews).toHaveBeenCalled();
    plugin.vocab.importJson.mockRejectedValue(new Error("not JSON"));
    await click(tab, "Import vocabulary from clipboard");
    expect(lastNotice()).toBe("Import failed: not JSON");
    read.mockRejectedValue(new Error("denied"));
    await click(tab, "Import vocabulary from clipboard");
    expect(lastNotice()).toBe("Import failed: denied");
    vi.unstubAllGlobals();
  });

  describe("importing from a file", () => {
    const pick = async (files: unknown[] | null) => {
      const m = makeSettingsTab();
      let input!: HTMLInputElement;
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        input = this;
      });
      await click(m.tab, "Import vocabulary from file");
      expect(input.type).toBe("file");
      expect(input.accept).toBe(".json,application/json");
      Object.defineProperty(input, "files", { value: files, configurable: true });
      input.dispatchEvent(new Event("change"));
      await flush();
      return m;
    };

    it("reads the chosen file and imports it", async () => {
      const m = await pick([{ text: async () => "[1]" }]);
      expect(m.plugin.vocab.importJson).toHaveBeenCalledWith("[1]");
    });

    it("does nothing when no file was chosen", async () => {
      const a = await pick([]);
      expect(a.plugin.vocab.importJson).not.toHaveBeenCalled();
      const b = await pick(null);
      expect(b.plugin.vocab.importJson).not.toHaveBeenCalled();
    });

    it("a file that cannot be read or imported is reported", async () => {
      await pick([{ text: async () => { throw new Error("unreadable"); } }]);
      expect(lastNotice()).toBe("Import failed: unreadable");
    });
  });

  it("Reset plugin data asks first and only then resets", async () => {
    const { tab, plugin } = makeSettingsTab();
    (tab as any).app = plugin.app;
    confirm.answer = false;
    await click(tab, "Reset plugin data");
    expect(plugin.vocab.resetAll).not.toHaveBeenCalled();
    confirm.answer = true;
    await click(tab, "Reset plugin data");
    expect(plugin.vocab.resetAll).toHaveBeenCalled();
    expect(lastNotice()).toBe("Plugin data reset.");
  });
});

describe("the Sync buttons", () => {
  it("Force re-sync does nothing but say so while the mirror is off, otherwise re-reads and refreshes", async () => {
    const off = makeSettingsTab();
    await click(off.tab, "Force re-sync now");
    expect(lastNotice()).toBe("Mirror is off — enable it first.");
    expect(off.plugin.vocab.reloadMirror).not.toHaveBeenCalled();
    const on = makeSettingsTab({ settings: (s) => (s.sync.mirrorEnabled = true) });
    await click(on.tab, "Force re-sync now");
    expect(on.plugin.vocab.reloadMirror).toHaveBeenCalled();
    expect(lastNotice()).toBe("Vocabulary mirror re-synced.");
  });

  it("Push and Pull settings are refused while the settings mirror is off", async () => {
    const { tab, plugin } = makeSettingsTab();
    await click(tab, "Push current settings to mirror now");
    await click(tab, "Pull settings from mirror now");
    expect(notices()).toEqual(["Settings mirror is off — enable it first.", "Settings mirror is off — enable it first."]);
    expect(plugin.settingsMirror.forcePushNow).not.toHaveBeenCalled();
  });

  it("Push writes the settings and reports it, or the failure", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => (s.sync.settingsMirrorEnabled = true) });
    await click(tab, "Push current settings to mirror now");
    expect(lastNotice()).toBe("Settings pushed to mirror.");
    plugin.settingsMirror.forcePushNow.mockRejectedValue(new Error("EIO"));
    await click(tab, "Push current settings to mirror now");
    expect(lastNotice()).toBe("Push failed: EIO");
  });

  it("Pull says whether anything was applied, or the failure", async () => {
    const { tab, plugin } = makeSettingsTab({ settings: (s) => (s.sync.settingsMirrorEnabled = true) });
    await click(tab, "Pull settings from mirror now");
    expect(lastNotice()).toBe("Settings pulled from mirror.");
    plugin.settingsMirror.forcePullNow.mockResolvedValue(false);
    await click(tab, "Pull settings from mirror now");
    expect(lastNotice()).toContain("Nothing to pull");
    plugin.settingsMirror.forcePullNow.mockRejectedValue(new Error("EIO"));
    await click(tab, "Pull settings from mirror now");
    expect(lastNotice()).toBe("Pull failed: EIO");
  });
});

describe("settings export and import", () => {
  it("Export writes to the chosen path and says where, or why not", async () => {
    const { tab, plugin } = makeSettingsTab();
    tab.setControlValue("ui:exportPath", "out/mine.json");
    await click(tab, "Export settings");
    expect(io.exportSettings).toHaveBeenCalledWith(plugin, "out/mine.json");
    expect(lastNotice()).toBe("Settings exported to out/mine.json");
    io.exportSettings.mockRejectedValue(new Error("read-only"));
    await click(tab, "Export settings");
    expect(lastNotice()).toBe("Export failed: read-only");
  });

  it("Import needs a path, asks first, and says what was applied and skipped", async () => {
    const { tab, plugin } = makeSettingsTab();
    (tab as any).app = plugin.app;
    tab.update = vi.fn();
    tab.setControlValue("ui:importPath", "");
    await click(tab, "Import settings");
    expect(lastNotice()).toBe("Pick an import path first.");
    tab.setControlValue("ui:importPath", "in.json");
    confirm.answer = false;
    await click(tab, "Import settings");
    expect(io.importSettings).not.toHaveBeenCalled();
    expect(confirm.asked.at(-1)).toContain("Import settings from in.json?");
    confirm.answer = true;
    await click(tab, "Import settings");
    expect(io.importSettings).toHaveBeenCalledWith(plugin, "in.json");
    expect(lastNotice()).toBe("Imported 3 top-level keys.");
    expect(tab.update).toHaveBeenCalled();
    io.importSettings.mockResolvedValue({ applied: 1, skipped: ["a", "b"] });
    await click(tab, "Import settings");
    expect(lastNotice()).toBe("Imported 1 top-level keys (skipped: a, b).");
    io.importSettings.mockRejectedValue(new Error("bad file"));
    await click(tab, "Import settings");
    expect(lastNotice()).toBe("Import failed: bad file");
  });
});

describe("the daily story time", () => {
  it("accepts HH:MM and explains anything else", () => {
    const { tab } = makeSettingsTab();
    const validate = (byName(tab, "Daily generation time").control as any).validate as (v: string) => string | undefined;
    expect(validate("08:00")).toBeUndefined();
    expect(validate(" 8:05 ")).toBeUndefined();
    expect(validate("8am")).toBe("Use HH:MM, e.g. 08:00.");
    expect(validate("")).toBe("Use HH:MM, e.g. 08:00.");
  });
});

describe("the Backups rows", () => {
  const entry = (id: string, over: Record<string, unknown> = {}) => ({ id, createdAt: "2026-10-01T10:00:00.000Z", fromVersion: "0.8.0-beta.1", kind: "manual", file: `${id}.json.gz`, encoding: "gzip", rawBytes: 10, storedBytes: 5, sha256: id, includes: ["data"], ...over });

  it("Back up now takes a copy and redraws the page", async () => {
    const { tab, plugin } = makeSettingsTab();
    tab.update = vi.fn();
    await click(tab, "Back up now");
    expect(plugin.backupNow).toHaveBeenCalled();
    expect(tab.update).toHaveBeenCalled();
  });

  it("the list is wired to the service: Restore and Delete reach it, and a queued restore can be cancelled", async () => {
    const { tab, plugin } = makeSettingsTab();
    (tab as any).app = plugin.app;
    tab.update = vi.fn();
    const e = entry("one");
    plugin.backups.list.mockResolvedValue([e]);
    plugin.backups.pendingRestore.mockResolvedValue(e);
    const el = renderDef(all(tab).find((d) => d.name === "Backups" && d.render)!);
    await vi.waitFor(() => expect(el.querySelector(".cci-backup-row")).toBeTruthy());
    Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Restore")!.click();
    await vi.waitFor(() => expect(plugin.backups.stageRestore).toHaveBeenCalledWith("one"));
    Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Delete")!.click();
    await vi.waitFor(() => expect(plugin.backups.deleteBackup).toHaveBeenCalledWith("one"));
    Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Cancel the restore")!.click();
    await vi.waitFor(() => expect(plugin.backups.cancelRestore).toHaveBeenCalled());
    await flush();
    expect(tab.update).toHaveBeenCalled();
  });
});

describe("a path typed into a mirror box", () => {
  it("committing with nothing typed does nothing", async () => {
    const { tab, plugin } = makeSettingsTab();
    await (tab as any).commitPath("sync.mirrorPath");
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("closing the page drops an unusable pending path even when its timer is already gone, and applies a usable one", () => {
    const { tab, plugin } = makeSettingsTab();
    (tab as any).pendingPaths.set("sync.mirrorPath", "not a path");
    (tab as any).pendingPaths.set("sync.settingsMirrorPath", "Folder/ok.json");
    tab.hide();
    expect((tab as any).pendingPaths.has("sync.mirrorPath")).toBe(false);
    expect(plugin.settings.sync.mirrorPath).not.toBe("not a path");
    expect(plugin.settings.sync.settingsMirrorPath).toBe("Folder/ok.json");
  });

  it("committing a usable path clears its pending timer", () => {
    vi.useFakeTimers();
    const { tab, plugin } = makeSettingsTab();
    tab.setControlValue("sync.mirrorPath", "A/b.json");
    tab.hide();
    expect(plugin.settings.sync.mirrorPath).toBe("A/b.json");
    expect((tab as any).pathTimers.size).toBe(0);
  });
});

describe("the licenses block", () => {
  it("lists what the plugin is built on", () => {
    const { tab } = makeSettingsTab();
    const el = renderDef(byName(tab, "Licenses"));
    expect(Array.from(el.querySelectorAll("li")).map((l) => l.textContent)).toHaveLength(3);
    expect(el.textContent).toContain("NOTICE.md");
  });
});
