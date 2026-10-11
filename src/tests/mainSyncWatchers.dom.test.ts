// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { bind, settings, workspace } from "./__mocks__/mainHarness";
import { VIEW_TYPE_CHINESE } from "../constants";

/**
 * How the plugin notices that another device changed the vocabulary or settings mirror: the vault's modify and create
 * events (including the conflict files a sync tool writes), the adaptive poller (fast while a Chinese view is open,
 * the configured interval otherwise), and the one-shot checks tied to focus and view changes. A missed or looping
 * check here means a device silently stops syncing, or hammers the disk, so each path is pinned.
 */

installObsidianDom();
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Handler = (file: { path: string }) => Promise<void>;

function watchers(over: (s: any) => void = () => {}, extra: Record<string, unknown> = {}) {
  const handlers: Record<string, Handler> = {};
  const o: any = bind({
    settings: settings((s) => ((s.sync.mirrorEnabled = true), (s.sync.mirrorPath = "Chinese Learning/vocabulary.json"), (s.sync.settingsMirrorEnabled = true), (s.sync.settingsMirrorPath = "Chinese Learning/cci-settings.json"), over(s))),
    app: { vault: { on: vi.fn((name: string, fn: Handler) => ((handlers[name] = fn), fn)) }, workspace: workspace() },
    registerEvent: vi.fn(),
    registerInterval: vi.fn(),
    vocab: { absorbExternalMirrorChange: vi.fn(async () => false), reloadMirror: vi.fn(async () => {}) },
    settingsMirror: { absorbExternalChange: vi.fn(async () => false), bootstrap: vi.fn(async () => {}) },
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    mirrorPollTimer: null,
    mirrorPollMode: "slow",
    ...extra,
  });
  o.registerSyncMirrorWatchers();
  return { o, handlers };
}

describe("the vault's modify event", () => {
  it("a change to the vocabulary mirror is absorbed, and the views redraw only if it brought something new", async () => {
    const { o, handlers } = watchers();
    await handlers.modify({ path: "Chinese Learning/vocabulary.json" });
    expect(o.vocab.absorbExternalMirrorChange).toHaveBeenCalledTimes(1);
    expect(o.refreshChineseViews).not.toHaveBeenCalled();
    o.vocab.absorbExternalMirrorChange.mockResolvedValue(true);
    await handlers.modify({ path: "Chinese Learning/vocabulary.json" });
    expect(o.refreshChineseViews).toHaveBeenCalledTimes(1);
    expect(o.refreshStatsViews).toHaveBeenCalledTimes(1);
    expect(o.settingsMirror.absorbExternalChange).not.toHaveBeenCalled();
  });

  it("a change to the settings mirror is absorbed by the settings mirror, written with different slashes or not", async () => {
    const { o, handlers } = watchers();
    await handlers.modify({ path: "Chinese Learning/cci-settings.json" });
    expect(o.settingsMirror.absorbExternalChange).toHaveBeenCalledTimes(1);
    expect(o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
  });

  it("any other file, and either mirror while it is switched off, is ignored", async () => {
    const { o, handlers } = watchers();
    await handlers.modify({ path: "Notes/other.md" });
    expect(o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
    expect(o.settingsMirror.absorbExternalChange).not.toHaveBeenCalled();
    const off = watchers((s) => ((s.sync.mirrorEnabled = false), (s.sync.settingsMirrorEnabled = false)));
    await off.handlers.modify({ path: "Chinese Learning/vocabulary.json" });
    await off.handlers.modify({ path: "Chinese Learning/cci-settings.json" });
    expect(off.o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
    expect(off.o.settingsMirror.absorbExternalChange).not.toHaveBeenCalled();
  });

  it("with no mirror path configured nothing matches", async () => {
    const { o, handlers } = watchers((s) => ((s.sync.mirrorPath = ""), (s.sync.settingsMirrorPath = "")));
    await handlers.modify({ path: "" });
    await handlers.modify({ path: "x.json" });
    expect(o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
    expect(o.settingsMirror.absorbExternalChange).not.toHaveBeenCalled();
  });

  it("works when the sync settings are missing altogether", async () => {
    const { handlers } = watchers((s) => (s.sync = undefined));
    await expect(handlers.modify({ path: "a.json" })).resolves.toBeUndefined();
    await expect(handlers.create({ path: "a.json" })).resolves.toBeUndefined();
  });
});

describe("the vault's create event", () => {
  it("the mirror appearing, or a conflict copy of it next to it, re-reads the mirror and redraws", async () => {
    const { o, handlers } = watchers();
    for (const path of ["Chinese Learning/vocabulary.json", "Chinese Learning/vocabulary.conflict-2026-06-12.json", "Chinese Learning/vocabulary.macbook.CONFLICT.json"]) {
      o.vocab.reloadMirror.mockClear();
      await handlers.create({ path });
      expect(o.vocab.reloadMirror, path).toHaveBeenCalledTimes(1);
    }
    expect(o.refreshChineseViews).toHaveBeenCalledTimes(3);
  });

  it("files that only look similar are not conflict copies: another folder, no 'conflict', not json, another name", async () => {
    const { o, handlers } = watchers();
    for (const path of ["Other/vocabulary.conflict.json", "Chinese Learning/vocabulary.json.bak", "Chinese Learning/vocabulary.conflict.txt", "Chinese Learning/other.conflict.json", "Chinese Learning/vocabulary-backup.json"]) {
      await handlers.create({ path });
    }
    expect(o.vocab.reloadMirror).not.toHaveBeenCalled();
  });

  it("a mirror at the vault root has conflict copies at the vault root", async () => {
    const { o, handlers } = watchers((s) => (s.sync.mirrorPath = "vocabulary.json"));
    await handlers.create({ path: "vocabulary.conflict.json" });
    await handlers.create({ path: "Sub/vocabulary.conflict.json" });
    expect(o.vocab.reloadMirror).toHaveBeenCalledTimes(1);
  });

  it("the settings mirror appearing is bootstrapped; anything else is ignored", async () => {
    const { o, handlers } = watchers();
    await handlers.create({ path: "Chinese Learning/cci-settings.json" });
    expect(o.settingsMirror.bootstrap).toHaveBeenCalledTimes(1);
    await handlers.create({ path: "Notes/a.md" });
    expect(o.settingsMirror.bootstrap).toHaveBeenCalledTimes(1);
    const off = watchers((s) => ((s.sync.mirrorEnabled = false), (s.sync.settingsMirrorEnabled = false)));
    await off.handlers.create({ path: "Chinese Learning/vocabulary.json" });
    expect(off.o.vocab.reloadMirror).not.toHaveBeenCalled();
  });

  it("both handlers are registered with Obsidian, so they are removed with the plugin", () => {
    const { o } = watchers();
    expect(o.registerEvent).toHaveBeenCalledTimes(2);
    expect(o.app.vault.on.mock.calls.map((c: unknown[]) => c[0])).toEqual(["modify", "create"]);
  });
});

describe("how often the mirror is polled", () => {
  const poll = (over: (s: any) => void, open = false) => {
    const { o } = watchers(over, { app: { vault: { on: vi.fn() }, workspace: workspace(open ? { [VIEW_TYPE_CHINESE]: [{ view: {} }] } : {}) } });
    return o.syncPollerMs() as number;
  };

  it("every 3 seconds while a Chinese view is open", () => {
    expect(poll(() => {}, true)).toBe(3000);
  });

  it("otherwise by the configured minutes, never faster than 30 seconds, and 0 means off", () => {
    expect(poll((s) => (s.sync.mirrorPollIntervalMinutes = 5))).toBe(300_000);
    expect(poll((s) => (s.sync.mirrorPollIntervalMinutes = 0.1))).toBe(30_000);
    expect(poll((s) => (s.sync.mirrorPollIntervalMinutes = 0))).toBe(0);
    expect(poll((s) => (s.sync.mirrorPollIntervalMinutes = -3))).toBe(0);
  });

  it("an unset interval means five minutes, and so does missing sync settings", () => {
    expect(poll((s) => (s.sync.mirrorPollIntervalMinutes = undefined))).toBe(300_000);
    expect(poll((s) => (s.sync = undefined))).toBe(300_000);
  });
});

describe("the poller", () => {
  const start = (over: (s: any) => void = () => {}, extra: Record<string, unknown> = {}) => {
    const { o } = watchers(over, extra);
    o.startSyncMirrorPoller();
    return o;
  };

  it("ticks at the interval, absorbing the vocabulary mirror and the settings mirror, and is registered for cleanup", async () => {
    const o = start((s) => (s.sync.mirrorPollIntervalMinutes = 1));
    expect(o.registerInterval).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(o.vocab.absorbExternalMirrorChange).toHaveBeenCalledTimes(1);
    expect(o.settingsMirror.absorbExternalChange).toHaveBeenCalledTimes(1);
    o.vocab.absorbExternalMirrorChange.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(o.refreshChineseViews).toHaveBeenCalledTimes(1);
  });

  it("with either mirror switched off its absorb is skipped", async () => {
    const o = start((s) => ((s.sync.mirrorPollIntervalMinutes = 1), (s.sync.mirrorEnabled = false), (s.sync.settingsMirrorEnabled = false)));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
    expect(o.settingsMirror.absorbExternalChange).not.toHaveBeenCalled();
  });

  it("a failing absorb is logged and the next tick still runs", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const o = start((s) => (s.sync.mirrorPollIntervalMinutes = 1));
    o.vocab.absorbExternalMirrorChange.mockRejectedValue(new Error("vocab boom"));
    o.settingsMirror.absorbExternalChange.mockRejectedValue(new Error("settings boom"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(err).toHaveBeenCalledWith("CCI sync: mirror poll failed", expect.any(Error));
    expect(err).toHaveBeenCalledWith("CCI settings mirror poll failed", expect.any(Error));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(o.vocab.absorbExternalMirrorChange).toHaveBeenCalledTimes(2);
  });

  it("restarting replaces the old timer instead of stacking another", async () => {
    const o = start((s) => (s.sync.mirrorPollIntervalMinutes = 1));
    o.startSyncMirrorPoller();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(o.vocab.absorbExternalMirrorChange).toHaveBeenCalledTimes(1);
  });

  it("an interval of 0 starts no timer at all", async () => {
    const o = start((s) => (s.sync.mirrorPollIntervalMinutes = 0));
    expect(o.registerInterval).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
  });

  it("switches between fast and slow when a Chinese view opens or closes, and only then", () => {
    let open = false;
    const o = start((s) => (s.sync.mirrorPollIntervalMinutes = 5), {});
    o.app.workspace.getLeavesOfType = vi.fn(() => (open ? [{ view: {} }] : []));
    const spy = vi.spyOn(o, "startSyncMirrorPoller");
    o.restartSyncPollerIfModeChanged();
    expect(spy).not.toHaveBeenCalled();
    open = true;
    o.restartSyncPollerIfModeChanged();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(o.mirrorPollMode).toBe("fast");
    o.restartSyncPollerIfModeChanged();
    expect(spy).toHaveBeenCalledTimes(1);
    open = false;
    o.restartSyncPollerIfModeChanged();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("the one-shot checks", () => {
  it("the vocabulary check absorbs once if the mirror is on, redraws on a change, and logs a failure", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { o } = watchers();
    await o.checkMirrorOnce();
    expect(o.refreshChineseViews).not.toHaveBeenCalled();
    o.vocab.absorbExternalMirrorChange.mockResolvedValue(true);
    await o.checkMirrorOnce();
    expect(o.refreshChineseViews).toHaveBeenCalledTimes(1);
    o.vocab.absorbExternalMirrorChange.mockRejectedValue(new Error("x"));
    await o.checkMirrorOnce();
    expect(err).toHaveBeenCalledWith("CCI sync: mirror check failed", expect.any(Error));
    const off = watchers((s) => (s.sync.mirrorEnabled = false));
    await off.o.checkMirrorOnce();
    expect(off.o.vocab.absorbExternalMirrorChange).not.toHaveBeenCalled();
    const none = watchers((s) => (s.sync = undefined));
    await expect(none.o.checkMirrorOnce()).resolves.toBeUndefined();
  });

  it("the settings check does the same for the settings mirror", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { o } = watchers();
    await o.checkSettingsMirrorOnce();
    expect(o.settingsMirror.absorbExternalChange).toHaveBeenCalledTimes(1);
    o.settingsMirror.absorbExternalChange.mockRejectedValue(new Error("y"));
    await o.checkSettingsMirrorOnce();
    expect(err).toHaveBeenCalledWith("CCI settings mirror check failed", expect.any(Error));
    const off = watchers((s) => (s.sync.settingsMirrorEnabled = false));
    await off.o.checkSettingsMirrorOnce();
    expect(off.o.settingsMirror.absorbExternalChange).not.toHaveBeenCalled();
    const none = watchers((s) => (s.sync = undefined));
    await expect(none.o.checkSettingsMirrorOnce()).resolves.toBeUndefined();
  });
});
