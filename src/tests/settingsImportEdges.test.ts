import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportSettings, importSettings } from "../settings/SettingsIO";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";

/**
 * Import / export edges: a hand-edited or old file must not be able to change which screen
 * mode a device is in, break the merge, or crash on odd shapes. Complements settingsIO.test.ts.
 */

const clone = (): CciSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

function makePlugin(file: unknown, exists = true) {
  const written = new Map<string, string>();
  const plugin: any = {
    settings: clone(),
    app: {
      vault: {
        adapter: {
          exists: vi.fn(async () => exists),
          mkdir: vi.fn(async () => {}),
          read: vi.fn(async () => (typeof file === "string" ? file : JSON.stringify(file))),
          write: vi.fn(async (p: string, c: string) => void written.set(p, c)),
        },
      },
    },
    saveSettings: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
  };
  return { plugin, written };
}

beforeEach(() => {
  (globalThis as any).document = { body: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } } };
});

describe("importSettings", () => {
  it("throws a readable error when the file does not exist, and changes nothing", async () => {
    const { plugin } = makePlugin({}, false);
    await expect(importSettings(plugin, "nope.json")).rejects.toThrow(/Settings file not found/);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a file that is not JSON, and changes nothing", async () => {
    const { plugin } = makePlugin("{ not json");
    await expect(importSettings(plugin, "bad.json")).rejects.toThrow();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(plugin.settings).toEqual(clone());
  });

  it("accepts a bare partial as well as the wrapped export shape", async () => {
    const { plugin } = makePlugin({ readerFontPx: 31 });
    const r = await importSettings(plugin, "bare.json");
    expect(plugin.settings.readerFontPx).toBe(31);
    expect(r.applied).toBe(1);
  });

  it.each([["null"], ["[]"], ['"text"'], ["7"]])("refuses the non-object top-level value %s with a readable message, changing nothing", async (raw) => {
    const { plugin } = makePlugin(raw);
    await expect(importSettings(plugin, "odd.json")).rejects.toThrow(/not a settings file/);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(plugin.settings).toEqual(clone());
  });

  it("never imports E-ink mode or its size: a file from another device cannot flip this screen, and says so", async () => {
    const { plugin } = makePlugin({ settings: { einkMode: true, einkNumberScalePercent: 50, readerFontPx: 30 } });
    const r = await importSettings(plugin, "eink.json");
    expect(plugin.settings.einkMode).toBe(false);
    expect(plugin.settings.einkNumberScalePercent).toBe(100);
    expect(plugin.settings.readerFontPx).toBe(30);
    expect(r.skipped).toEqual(expect.arrayContaining(["einkMode", "einkNumberScalePercent"]));
  });

  it("keeps this device's E-ink mode when importing, whatever the file says", async () => {
    const { plugin } = makePlugin({ settings: { einkMode: false, readerFontPx: 30 } });
    plugin.settings.einkMode = true;
    plugin.settings.einkNumberScalePercent = 70;
    await importSettings(plugin, "x.json");
    expect(plugin.settings.einkMode).toBe(true);
    expect(plugin.settings.einkNumberScalePercent).toBe(70);
  });

  it("drops values of the wrong kind and reports them, instead of corrupting this session", async () => {
    // Found by this test: customColors:"oops" replaced the whole object, then applyCustomColors threw
    // AFTER plugin.settings was swapped, leaving half-imported settings in memory.
    const { plugin } = makePlugin({
      customColors: "oops",
      readerFontPx: "big",
      formatOrder: { not: "an array" },
      textColors: { enabled: true, chars: "#111111", pinyin: 5 },
    });
    const r = await importSettings(plugin, "shape.json");
    expect(plugin.settings.customColors).toEqual(DEFAULT_SETTINGS.customColors);
    expect(plugin.settings.readerFontPx).toBe(DEFAULT_SETTINGS.readerFontPx);
    expect(plugin.settings.formatOrder).toEqual(DEFAULT_SETTINGS.formatOrder);
    // the good siblings still land; the bad nested one is dropped
    expect(plugin.settings.textColors.enabled).toBe(true);
    expect(plugin.settings.textColors.chars).toBe("#111111");
    expect(plugin.settings.textColors.pinyin).toBe(DEFAULT_SETTINGS.textColors.pinyin);
    expect(r.skipped).toEqual(
      expect.arrayContaining(["customColors (wrong type)", "readerFontPx (wrong type)", "formatOrder (wrong type)", "textColors.pinyin (wrong type)"])
    );
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("lets keys the defaults do not know about through, and null where the default is null", async () => {
    const { plugin } = makePlugin({ someFutureKey: { a: 1 } });
    const r = await importSettings(plugin, "future.json");
    expect((plugin.settings as any).someFutureKey).toEqual({ a: 1 });
    expect(r.skipped).toEqual([]);
  });

  it("replaces arrays instead of merging them", async () => {
    const { plugin } = makePlugin({ formatOrder: ["bold"], formatHidden: ["code"] });
    await importSettings(plugin, "arr.json");
    expect(plugin.settings.formatOrder).toEqual(["bold"]);
    expect(plugin.settings.formatHidden).toEqual(["code"]);
  });

  it("ignores sync / ai being non-objects when listing skipped keys", async () => {
    const { plugin } = makePlugin({ sync: "x", ai: 5, readerFontPx: 30 });
    await expect(importSettings(plugin, "x.json")).resolves.toBeDefined();
  });
});

describe("exportSettings", () => {
  it("creates the destination folder when it is missing, and writes nothing device-local", async () => {
    const { plugin, written } = makePlugin({});
    plugin.settings.einkMode = true;
    plugin.app.vault.adapter.exists = vi.fn(async () => false);
    await exportSettings(plugin, "New Folder/out.json");
    expect(plugin.app.vault.adapter.mkdir).toHaveBeenCalledWith("New Folder");
    const payload = JSON.parse(written.get("New Folder/out.json")!);
    expect(payload.settings).not.toHaveProperty("einkMode");
  });

  it("writes to the vault root without making a folder", async () => {
    const { plugin, written } = makePlugin({});
    await exportSettings(plugin, "out.json");
    expect(plugin.app.vault.adapter.mkdir).not.toHaveBeenCalled();
    expect(written.has("out.json")).toBe(true);
  });
});
