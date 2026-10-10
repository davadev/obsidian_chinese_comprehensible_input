import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { CciSettingsTab } from "../settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { installCreateFragmentStub } from "./__mocks__/obsidianDom";

/**
 * The mirror path box used to save, and write the whole mirror, on every keystroke, leaving files and folders named after
 * half-typed paths in the vault (`vocabulary.`, `vocabulary.json nowledgebase/`). A typed path is now held until the typing
 * stops, and only a usable .json path is ever applied.
 */

function makeTab() {
  const plugin: any = {
    settings: JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true } })),
    app: { vault: { configDir: ".obsidian" } },
    saveSettings: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    refreshChineseViewAppearance: vi.fn(),
    refreshSyncMirror: vi.fn(async () => {}),
    startSyncMirrorPoller: vi.fn(),
    settingsMirror: { bootstrap: vi.fn(async () => {}) },
    loadLocalStorage: vi.fn(() => null),
  };
  const tab = new CciSettingsTab(plugin.app, plugin) as unknown as {
    getControlValue(k: string): unknown;
    setControlValue(k: string, v: unknown): void | Promise<void>;
    hide(): void;
  };
  return { tab, plugin };
}

const KEY = "sync.mirrorPath";
const FINAL = "Chinese Learning/my-vocabulary.json";

beforeEach(() => {
  installCreateFragmentStub();
  vi.useFakeTimers();
  Notice.instances.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("typing into the mirror path box", () => {
  it("nothing is saved or written while the typing goes on, however many keystrokes", async () => {
    const { tab, plugin } = makeTab();
    const before = plugin.settings.sync.mirrorPath;
    for (let i = 1; i <= FINAL.length; i++) {
      void tab.setControlValue(KEY, FINAL.slice(0, i));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(plugin.settings.sync.mirrorPath).toBe(before);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(plugin.refreshSyncMirror).not.toHaveBeenCalled();
  });

  it("the box keeps showing what is being typed, not the older value in use", () => {
    const { tab } = makeTab();
    void tab.setControlValue(KEY, "Half/typed");
    expect(tab.getControlValue(KEY)).toBe("Half/typed");
  });

  it("when the typing stops, the finished path is applied once, saved once, and the mirror follows it", async () => {
    const { tab, plugin } = makeTab();
    for (let i = 1; i <= FINAL.length; i++) void tab.setControlValue(KEY, FINAL.slice(0, i));
    await vi.advanceTimersByTimeAsync(1_600);
    expect(plugin.settings.sync.mirrorPath).toBe(FINAL);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.refreshSyncMirror).toHaveBeenCalledTimes(1);
    expect(tab.getControlValue(KEY)).toBe(FINAL);
  });

  it("a path that is not a usable .json path is not applied, the reason is shown, and the box keeps what was typed", async () => {
    const { tab, plugin } = makeTab();
    const before = plugin.settings.sync.mirrorPath;
    void tab.setControlValue(KEY, "Knowledgebase/Languages/vocabulary.");
    await vi.advanceTimersByTimeAsync(1_600);
    expect(plugin.settings.sync.mirrorPath).toBe(before);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(Notice.instances.at(-1)!.message).toContain("was not saved");
    expect(tab.getControlValue(KEY)).toBe("Knowledgebase/Languages/vocabulary.");
  });

  it("closing Settings straight after typing applies a finished path at once, and drops an unfinished one", async () => {
    const good = makeTab();
    void good.tab.setControlValue(KEY, FINAL);
    good.tab.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(good.plugin.settings.sync.mirrorPath).toBe(FINAL);

    const bad = makeTab();
    const before = bad.plugin.settings.sync.mirrorPath;
    void bad.tab.setControlValue(KEY, "Half/typed.");
    bad.tab.hide();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(bad.plugin.settings.sync.mirrorPath).toBe(before);
    expect(bad.tab.getControlValue(KEY)).toBe(before); // the unfinished text is gone; the box shows the value in use
  });

  it("the settings-mirror path box behaves the same way, and its commit refreshes nothing it should not", async () => {
    const { tab, plugin } = makeTab();
    void tab.setControlValue("sync.settingsMirrorPath", "Chinese Learning/my-settings.json");
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(plugin.settings.sync.settingsMirrorPath).toBe("Chinese Learning/my-settings.json");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("other settings are still saved immediately", async () => {
    const { tab, plugin } = makeTab();
    await tab.setControlValue("sync.mirrorPollIntervalMinutes", 7);
    expect(plugin.settings.sync.mirrorPollIntervalMinutes).toBe(7);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("surrounding spaces in the finished path are trimmed", async () => {
    const { tab, plugin } = makeTab();
    void tab.setControlValue(KEY, `  ${FINAL}  `);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(plugin.settings.sync.mirrorPath).toBe(FINAL);
  });
});
