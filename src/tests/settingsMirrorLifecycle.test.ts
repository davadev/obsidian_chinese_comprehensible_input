import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";

/**
 * The parts of SettingsMirror the #123 / #124 tests do not reach: bootstrap, the
 * debounced write, the fresh-install guard, the atomic-write fallback, per-key
 * resolution, and what never travels between devices.
 *
 * Same hand-rolled adapter as settingsMirror.test.ts; the conflict modal is mocked so
 * a test can see what it was asked and answer it.
 */

const h = vi.hoisted(() => ({
  opened: [] as Array<{ conflicts: Array<{ keyPath: string; local: unknown; remote: unknown }>; resolve: (c: Map<string, string>) => void }>,
}));

vi.mock("../ui/SettingsConflictModal", () => ({
  SettingsConflictModal: class {
    constructor(
      _app: unknown,
      private conflicts: Array<{ keyPath: string; local: unknown; remote: unknown }>,
      private onResolve: (c: Map<string, string>) => void
    ) {}
    open() {
      h.opened.push({ conflicts: this.conflicts, resolve: this.onResolve });
    }
  },
}));

import { SettingsMirror } from "../settings/SettingsMirror";

const PATH = "Chinese Learning/settings.json";

function make(over: Partial<CciSettings> = {}, sync: Partial<CciSettings["sync"]> = {}) {
  const files = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p) || p === "Chinese Learning"),
    mkdir: vi.fn(async () => {}),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    rename: vi.fn(async (a: string, b: string) => {
      files.set(b, files.get(a) ?? "");
      files.delete(a);
    }),
    remove: vi.fn(async (p: string) => {
      files.delete(p);
    }),
  };
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      ...over,
      sync: { ...DEFAULT_SETTINGS.sync, settingsMirrorEnabled: true, settingsMirrorPath: PATH, ...sync },
    } as CciSettings,
    app: { vault: { adapter }, setting: undefined as unknown },
    hasUserTouchedSettings: vi.fn(async () => true),
    saveSettingsSilently: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
  };
  const mirror = new SettingsMirror(plugin as never);
  return { mirror, plugin, adapter, files };
}

const envelope = (settings: unknown, updatedAt = "2026-06-15T10:00:00.000Z") =>
  JSON.stringify({ schemaVersion: 1, updatedAt, settings });

const waitForModal = () =>
  vi.waitFor(() => {
    if (h.opened.length === 0) throw new Error("conflict modal not open yet");
  });

describe("SettingsMirror lifecycle", () => {
  beforeEach(() => {
    h.opened.length = 0;
    (globalThis as unknown as { document: unknown }).document = {
      body: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } },
    };
    (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = vi.fn(() => ({
      getPropertyValue: () => "",
    }));
    (globalThis as unknown as { window: unknown }).window = globalThis;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("path()", () => {
    it("is null when the mirror is off or has no path", () => {
      expect(make({}, { settingsMirrorEnabled: false }).mirror.path()).toBeNull();
      expect(make({}, { settingsMirrorPath: "" }).mirror.path()).toBeNull();
      expect(make().mirror.path()).toBe(PATH);
    });

    it("does nothing at all when off", async () => {
      const { mirror, adapter } = make({}, { settingsMirrorEnabled: false });
      await mirror.bootstrap();
      mirror.scheduleWrite();
      await mirror.flushNow();
      await mirror.forcePushNow();
      expect(await mirror.absorbExternalChange()).toBe(false);
      expect(await mirror.forcePullNow()).toBe(false);
      expect(adapter.exists).not.toHaveBeenCalled();
      expect(adapter.write).not.toHaveBeenCalled();
    });
  });

  describe("bootstrap", () => {
    it("applies an existing mirror file to this device", async () => {
      const { mirror, plugin, files } = make();
      files.set(PATH, envelope({ readerFontPx: 31 }));
      await mirror.bootstrap();
      expect(plugin.settings.readerFontPx).toBe(31);
      expect(plugin.saveSettingsSilently).toHaveBeenCalledWith({ remote: true });
      expect(plugin.refreshChineseViews).toHaveBeenCalled();
    });

    it("does nothing when there is no file yet", async () => {
      const { mirror, plugin } = make();
      await mirror.bootstrap();
      expect(plugin.saveSettingsSilently).not.toHaveBeenCalled();
    });

    it("swallows a read failure instead of failing plugin load", async () => {
      const { mirror, adapter, files } = make();
      files.set(PATH, envelope({}));
      adapter.read.mockRejectedValueOnce(new Error("io"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(mirror.bootstrap()).resolves.toBeUndefined();
    });
  });

  describe("absorbing", () => {
    it("ignores a file that is not JSON, or has no settings", async () => {
      const { mirror, files, plugin } = make();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      files.set(PATH, "{ not json");
      expect(await mirror.absorbExternalChange()).toBe(false);
      files.set(PATH, JSON.stringify({ schemaVersion: 1 }));
      expect(await mirror.absorbExternalChange()).toBe(false);
      files.set(PATH, "null");
      expect(await mirror.absorbExternalChange()).toBe(false);
      expect(plugin.saveSettingsSilently).not.toHaveBeenCalled();
    });

    it("returns false (and logs) when the read throws", async () => {
      const { mirror, adapter, files } = make();
      files.set(PATH, envelope({}));
      adapter.read.mockRejectedValueOnce(new Error("io"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await mirror.absorbExternalChange()).toBe(false);
      expect(err).toHaveBeenCalled();
    });

    it("is a no-op while a conflict prompt is open, and forcePullNow too", async () => {
      const { mirror, files } = make({ readerFontPx: 26 });
      files.set(PATH, envelope({ readerFontPx: 30 }));
      const pending = mirror.absorbExternalChange();
      await waitForModal();
      expect(await mirror.absorbExternalChange()).toBe(false);
      expect(await mirror.forcePullNow()).toBe(false);
      h.opened[0].resolve(new Map());
      await pending;
    });

    it("forcePullNow is false when the file does not exist", async () => {
      expect(await make().mirror.forcePullNow()).toBe(false);
    });

    it("a fresh device (nothing touched) takes the remote wholesale", async () => {
      const { mirror, plugin, files } = make({ readerFontPx: 26 });
      plugin.hasUserTouchedSettings.mockResolvedValue(false);
      files.set(PATH, envelope({ readerFontPx: 30 }));
      expect(await mirror.absorbExternalChange()).toBe(true);
      expect(plugin.settings.readerFontPx).toBe(30);
      expect(h.opened).toHaveLength(0);
    });

    it("applies an envelope older than the last one, and says so (clock skew), never rejecting it", async () => {
      const { mirror, plugin, files } = make();
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      await mirror.absorbExternalChange();
      // A different key: the same key with a different value would be a (correct) conflict.
      files.set(PATH, envelope({ annotationScalePercent: 80 }, "2026-06-15T10:01:00.000Z"));
      expect(await mirror.absorbExternalChange()).toBe(true);
      expect(plugin.settings.annotationScalePercent).toBe(80);
      expect(debug).toHaveBeenCalledTimes(1);
      expect(String(debug.mock.calls[0][0])).toMatch(/clock skew/);
    });

    it("re-renders the settings tab when it is ours, and tolerates one that throws", async () => {
      const { mirror, plugin, files } = make();
      class CciSettingsTab {
        update = vi.fn();
      }
      const tab = new CciSettingsTab();
      plugin.app.setting = { activeTab: tab };
      files.set(PATH, envelope({ readerFontPx: 30 }));
      await mirror.absorbExternalChange();
      expect(tab.update).toHaveBeenCalledTimes(1);

      tab.update.mockImplementation(() => {
        throw new Error("render");
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      files.set(PATH, envelope({ annotationScalePercent: 80 }));
      expect(await mirror.absorbExternalChange()).toBe(true);
    });

    it("does not re-render someone else's settings tab", async () => {
      const { mirror, plugin, files } = make();
      const other = { update: vi.fn() };
      plugin.app.setting = { activeTab: other };
      files.set(PATH, envelope({ readerFontPx: 30 }));
      await mirror.absorbExternalChange();
      expect(other.update).not.toHaveBeenCalled();
    });
  });

  describe("per-key resolution", () => {
    const D = DEFAULT_SETTINGS;

    it("takes the remote value where local is still the default, keeps local where remote is the default", async () => {
      const { mirror, plugin, files } = make({ annotationScalePercent: 80 });
      // readerFontPx: local default, remote changed -> take remote
      // annotationScalePercent: local changed, remote default -> keep local
      files.set(PATH, envelope({ readerFontPx: D.readerFontPx + 4, annotationScalePercent: D.annotationScalePercent }));
      expect(await mirror.absorbExternalChange()).toBe(true);
      expect(plugin.settings.readerFontPx).toBe(D.readerFontPx + 4);
      expect(plugin.settings.annotationScalePercent).toBe(80);
      expect(h.opened).toHaveLength(0);
    });

    it("asks only about keys where both sides changed and disagree, with both values", async () => {
      const { mirror, files } = make({ readerFontPx: 26, annotationScalePercent: 80 });
      files.set(PATH, envelope({ readerFontPx: 30, annotationScalePercent: 80 }));
      const pending = mirror.absorbExternalChange();
      await waitForModal();
      expect(h.opened[0].conflicts).toEqual([{ keyPath: "readerFontPx", local: 26, remote: 30 }]);
      h.opened[0].resolve(new Map());
      await pending;
    });

    it("applies the user's choices: remote wins where chosen, local elsewhere, non-conflicting keys still land", async () => {
      const { mirror, plugin, files } = make({ readerFontPx: 26, annotationScalePercent: 80 });
      files.set(PATH, envelope({ readerFontPx: 30, annotationScalePercent: 120, lineSpacing: 1.4 }));
      const pending = mirror.absorbExternalChange();
      await waitForModal();
      h.opened[0].resolve(new Map([["readerFontPx", "remote"]]));
      expect(await pending).toBe(true);
      expect(plugin.settings.readerFontPx).toBe(30);
      expect(plugin.settings.annotationScalePercent).toBe(80);
      expect((plugin.settings as unknown as Record<string, unknown>).lineSpacing).toBe(1.4);
    });
  });

  describe("what never travels between devices", () => {
    it("does not write E-ink mode or the other per-device keys", async () => {
      const { mirror, files } = make({ einkMode: true, einkNumberScalePercent: 70 });
      await mirror.forcePushNow();
      const written = JSON.parse(files.get(PATH)!).settings as Record<string, unknown>;
      for (const k of ["einkMode", "einkNumberScalePercent", "traditionalPromptDismissed", "vaultIndexed"])
        expect(written, k).not.toHaveProperty(k);
      expect(written).toHaveProperty("readerFontPx");
    });

    it("ignores E-ink mode in an incoming envelope: another device's choice never flips this screen", async () => {
      const { mirror, plugin, files } = make({ einkMode: false, einkNumberScalePercent: 100 });
      files.set(PATH, envelope({ einkMode: true, einkNumberScalePercent: 50, readerFontPx: 30 }));
      await mirror.absorbExternalChange();
      expect(plugin.settings.einkMode).toBe(false);
      expect(plugin.settings.einkNumberScalePercent).toBe(100);
      expect(plugin.settings.readerFontPx).toBe(30);
    });
  });

  describe("writing", () => {
    it("scheduleWrite debounces: many calls, one write", async () => {
      vi.useFakeTimers();
      const { mirror, adapter } = make();
      mirror.scheduleWrite();
      mirror.scheduleWrite();
      mirror.scheduleWrite();
      expect(adapter.write).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(adapter.write.mock.calls.filter(([p]) => String(p).endsWith(".tmp"))).toHaveLength(1);
    });

    it("flushNow cancels the pending timer and writes immediately", async () => {
      vi.useFakeTimers();
      const { mirror, adapter, files } = make();
      mirror.scheduleWrite();
      await mirror.flushNow();
      expect(files.has(PATH)).toBe(true);
      const writes = adapter.write.mock.calls.length;
      await vi.runAllTimersAsync();
      expect(adapter.write.mock.calls.length).toBe(writes); // the timer was cancelled
    });

    it("does not push defaults before the user has touched any setting, unless forced", async () => {
      const { mirror, plugin, files } = make();
      plugin.hasUserTouchedSettings.mockResolvedValue(false);
      await mirror.flushNow();
      expect(files.has(PATH)).toBe(false);
      await mirror.forcePushNow();
      expect(files.has(PATH)).toBe(true);
    });

    it("creates the folder when it is missing", async () => {
      const { mirror, adapter } = make({}, { settingsMirrorPath: "New Folder/settings.json" });
      await mirror.forcePushNow();
      expect(adapter.mkdir).toHaveBeenCalledWith("New Folder");
    });

    it("writes a file at the vault root without trying to make a folder", async () => {
      const { mirror, adapter, files } = make({}, { settingsMirrorPath: "settings.json" });
      await mirror.forcePushNow();
      expect(adapter.mkdir).not.toHaveBeenCalled();
      expect(files.has("settings.json")).toBe(true);
    });

    it("replaces an existing mirror by removing it before the rename, as adapters that refuse to overwrite need", async () => {
      const { mirror, adapter, files } = make();
      files.set(PATH, "old");
      adapter.rename.mockImplementation(async (a: string, b: string) => {
        if (files.has(b)) throw new Error("target exists");
        files.set(b, files.get(a) ?? "");
        files.delete(a);
      });
      await mirror.forcePushNow();
      expect(JSON.parse(files.get(PATH)!).schemaVersion).toBe(1);
      // the staging path was the only thing written: no fallback direct write happened
      expect(adapter.write.mock.calls.map(([p]) => p)).toEqual([`${PATH}.tmp`]);
    });

    it("falls back to a direct write when the atomic rename fails, and cleans up the temp file", async () => {
      const { mirror, adapter, files } = make();
      adapter.rename.mockRejectedValueOnce(new Error("rename unsupported"));
      await mirror.forcePushNow();
      expect(files.has(PATH)).toBe(true);
      expect(files.has(`${PATH}.tmp`)).toBe(false);
    });

    it("survives the cleanup itself failing, and a total write failure, without throwing", async () => {
      const { mirror, adapter, files } = make();
      adapter.rename.mockRejectedValueOnce(new Error("rename"));
      adapter.remove.mockRejectedValue(new Error("remove"));
      await expect(mirror.forcePushNow()).resolves.toBeUndefined();
      expect(files.has(PATH)).toBe(true);

      adapter.write.mockRejectedValue(new Error("disk full"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(mirror.forcePushNow()).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    });

    it("a failed scheduled write is logged, not thrown into the timer", async () => {
      vi.useFakeTimers();
      const { mirror, plugin } = make();
      plugin.hasUserTouchedSettings.mockRejectedValue(new Error("boom"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      mirror.scheduleWrite();
      await vi.runAllTimersAsync();
      expect(err).toHaveBeenCalled();
    });
  });
});
