// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { fakeApp } from "./__mocks__/mainHarness";
import { DEFAULT_SETTINGS } from "../settings/defaults";
installObsidianDom();
vi.mock("../vocabulary/VaultIndexer", () => ({ indexVaultWithNotice: vi.fn(async () => {}) }));
import CciPlugin from "../main";
const MANIFEST = { id: "chinese-comprehensible-input", name: "CCI", version: "0.9.3", dir: ".obsidian/plugins/chinese-comprehensible-input" };
function load(data: unknown) {
  const env = fakeApp();
  Platform.isMobile = false;
  const plugin = new CciPlugin(env.app, MANIFEST as never) as any;
  plugin.data = data;
  return { plugin, ...env };
}
/**
 * Loading the settings completes every plain group from the defaults, key by key, and hands out copies. Found by the
 * bug-hunt skill: a fresh install shared `srs`, `sync`, `exposure`, `story` (and the lists) with DEFAULT_SETTINGS, so a
 * change in the first session edited the defaults; and a saved group missing a key left it undefined instead of its default.
 */
describe("settings load: groups and lists", () => {
  it("a fresh install gets copies of every group and list, never the defaults object itself", async () => {
    const { plugin } = load(null);
    await plugin.onload();
    for (const k of ["srs", "sync", "exposure", "story", "showHskColors", "progressChartSeries", "hskCoverageBuckets"]) {
      expect(plugin.settings[k] === (DEFAULT_SETTINGS as any)[k], k).toBe(false);
      expect(plugin.settings[k], k).toEqual((DEFAULT_SETTINGS as any)[k]);
    }
    for (const k of ["enabledFormats", "formatOrder", "formatHidden", "topicRadarTopics"]) {
      expect(plugin.settings[k] === (DEFAULT_SETTINGS as any)[k], k).toBe(false);
    }
    expect(plugin.settings.sync.statusPriority).not.toBe(DEFAULT_SETTINGS.sync.statusPriority);
    plugin.settings.srs.initialEase = 9;
    plugin.settings.sync.statusPriority.push("sentinel");
    expect(DEFAULT_SETTINGS.srs.initialEase).toBe(2.5);
    expect(DEFAULT_SETTINGS.sync.statusPriority).not.toContain("sentinel");
  });
  it("a saved group that lacks keys gets their defaults and keeps what it has", async () => {
    const { plugin } = load({ settings: { srs: { initialEase: 2.1 }, sync: { mirrorEnabled: true }, exposure: {}, story: { folder: "X" } } });
    await plugin.onload();
    expect(plugin.settings.srs.popupOnDueIsFailedRecall).toBe(true);
    expect(plugin.settings.sync.settingsMirrorPath).toBe(DEFAULT_SETTINGS.sync.settingsMirrorPath);
    expect(plugin.settings.exposure.maxOncePerNotePerSession).toBe(true);
    expect(plugin.settings.story.defaultDueCount).toBe(12);
    expect(plugin.settings.srs.initialEase).toBe(2.1);
    expect(plugin.settings.sync.mirrorEnabled).toBe(true);
    expect(plugin.settings.story.folder).toBe("X");
  });
  it("a group that is not an object (a hand-edited blob) is replaced by the defaults", async () => {
    const { plugin } = load({ settings: { srs: "oops", sync: ["x"], exposure: null } });
    await plugin.onload();
    expect(plugin.settings.srs).toEqual(DEFAULT_SETTINGS.srs);
    expect(plugin.settings.sync).toEqual(DEFAULT_SETTINGS.sync);
    expect(plugin.settings.exposure).toEqual(DEFAULT_SETTINGS.exposure);
  });
});
