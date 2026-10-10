import { beforeEach, describe, expect, it, vi } from "vitest";
import { CciSettingsTab } from "../settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { installCreateFragmentStub } from "./__mocks__/obsidianDom";

/**
 * #149: the Backups group in Settings. The controls are bound to the two per-device keys, the "keep" number is greyed
 * out while backups are off, and switching the toggle re-evaluates that without rebuilding the page.
 */

type Def = { type?: string; heading?: string; name?: string; items?: Def[]; control?: { type: string; key: string; min?: number; max?: number; disabled?: () => boolean } };

function makeTab() {
  const plugin: any = {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    app: { vault: { configDir: ".obsidian" } },
    saveSettings: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    refreshChineseViewAppearance: vi.fn(),
    loadLocalStorage: vi.fn(() => null),
  };
  const tab = new CciSettingsTab(plugin.app, plugin) as unknown as {
    getSettingDefinitions(): Def[];
    setControlValue(key: string, v: unknown): Promise<void>;
    refreshDomState(): void;
    update(): void;
  };
  return { tab, plugin };
}

beforeEach(() => {
  installCreateFragmentStub();
});

describe("Backups settings group", () => {
  const group = (tab: { getSettingDefinitions(): Def[] }) => tab.getSettingDefinitions().find((d) => d.heading === "Backups")!;
  const controls = (g: Def) => (g.items ?? []).filter((i) => i.control);

  it("exists, under its own heading, with a toggle and a number bound to the two per-device keys", () => {
    const { tab } = makeTab();
    const g = group(tab);
    expect(g).toBeTruthy();
    expect(controls(g).map((i) => [i.control!.type, i.control!.key])).toEqual([
      ["toggle", "backupsEnabled"],
      ["number", "backupsKeep"],
    ]);
  });

  it("keeps at least one and at most fifty, and the number is greyed out while backups are off", () => {
    const { tab, plugin } = makeTab();
    const keep = controls(group(tab)).find((i) => i.control!.key === "backupsKeep")!.control!;
    expect(keep.min).toBe(1);
    expect(keep.max).toBe(50);
    expect(keep.disabled!()).toBe(false);
    plugin.settings.backupsEnabled = false;
    expect(keep.disabled!()).toBe(true);
  });

  it("defaults: on, keep five", () => {
    expect(DEFAULT_SETTINGS.backupsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.backupsKeep).toBe(5);
  });

  it("switching the toggle saves and re-evaluates the greyed state without rebuilding the page", async () => {
    const { tab, plugin } = makeTab();
    const domState = vi.spyOn(tab, "refreshDomState").mockImplementation(() => undefined);
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await tab.setControlValue("backupsEnabled", false);
    expect(plugin.settings.backupsEnabled).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(domState).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("states the limits plainly: only versions with this feature can restore, and sync can bring data back", () => {
    const { tab } = makeTab();
    const g = group(tab);
    const proses: string[] = [];
    for (const i of g.items ?? []) {
      const r = i as unknown as { render?: (s: unknown) => void };
      if (!r.render) continue;
      const created: string[] = [];
      const el: Record<string, unknown> = { empty() {}, addClass() {}, createEl: (_t: string, o: { text: string }) => created.push(o.text) };
      r.render({ settingEl: el });
      proses.push(...created);
    }
    const text = proses.join(" ");
    expect(text).toContain("never stored in your vault");
    expect(text).toContain("0.7.9 or earlier");
    expect(text).toContain("some of it can reappear");
  });
});
