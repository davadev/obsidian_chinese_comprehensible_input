// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { bind, settings } from "./__mocks__/mainHarness";

/**
 * The plugin's background work: the once-a-day story (all its gates, the cross-device check, the retry throttle), the
 * start-up bootstrap (dictionary download, warm-up, first index), the mirror bootstrap after layout, what happens on
 * unload, the crash counter's reset, and the command list. These run unattended, so each gate that stops them from
 * running twice, or at the wrong time, or against a failing provider, is pinned.
 */

installObsidianDom();

const indexer = vi.hoisted(() => ({ indexVaultWithNotice: vi.fn(async () => {}) }));
vi.mock("../vocabulary/VaultIndexer", () => indexer);

beforeEach(() => {
  Notice.instances.length = 0;
  indexer.indexVaultWithNotice.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NOON = () => new Date(2026, 9, 10, 12, 0, 0);
const file = (basename: string) => Object.assign(new TFile(), { basename, path: `${basename}.md` });
const folder = (children: unknown[]) => Object.assign(new TFolder(), { children });

describe("the daily story", () => {
  function story(opts: { rawTime?: boolean; enabled?: boolean; time?: string; blob?: Record<string, unknown>; folderChildren?: unknown[] | null; ai?: boolean; after?: Array<unknown[]> } = {}) {
    vi.setSystemTime(NOON());
    const blob: Record<string, any> = { ...(opts.blob ?? {}) };
    const folderQueue: Array<unknown[] | null> = [opts.folderChildren === undefined ? [] : opts.folderChildren, ...(opts.after ?? [])];
    const o: any = bind({
      settings: settings((s) => ((s.story.autoGenerateEnabled = opts.enabled ?? true), (s.story.autoGenerateTime = opts.rawTime ? opts.time : (opts.time ?? "08:00")), (s.ai.enabled = opts.ai ?? true), (s.story.folder = "Stories"))),
      loadPluginData: vi.fn(async () => blob),
      updateDataBlob: vi.fn(async (m: (b: any) => void) => m(blob)),
      app: {
        vault: {
          getAbstractFileByPath: vi.fn(() => {
            const next = folderQueue.length > 1 ? folderQueue.shift()! : folderQueue[0];
            return next === null ? null : folder(next as unknown[]);
          }),
        },
      },
      story: { generatePreview: vi.fn(async () => ({ story: {} })), commitPreviewAsNote: vi.fn(async () => file("saved")) },
    });
    return { o, blob };
  }
  const run = async (o: any) => {
    const p = o.tickAutoStory();
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 1000);
    await p;
  };

  it("does nothing unless switched on", async () => {
    const { o } = story({ enabled: false });
    await run(o);
    expect(o.loadPluginData).not.toHaveBeenCalled();
    const noStorySettings = bind({ settings: { story: undefined } }) as any;
    await expect(noStorySettings.tickAutoStory()).resolves.toBeUndefined();
  });

  it("does nothing once today's story is done, or before the configured time", async () => {
    const done = story({ blob: { __autoStoryLastSuccessDate: "2026-10-10" } });
    await run(done.o);
    expect(done.o.story.generatePreview).not.toHaveBeenCalled();
    const early = story({ time: "13:30" });
    await run(early.o);
    expect(early.o.story.generatePreview).not.toHaveBeenCalled();
    expect(early.o.updateDataBlob).not.toHaveBeenCalled();
  });

  it("an unreadable or missing time means 08:00", async () => {
    for (const time of ["garbage", "", undefined as unknown as string]) {
      const { o } = story({ time, rawTime: true });
      await run(o);
      expect(o.story.generatePreview, String(time)).toHaveBeenCalled();
    }
    const half = story({ time: "13:xx" });
    await run(half.o);
    expect(half.o.story.generatePreview).not.toHaveBeenCalled();
  });

  it("waits out the 30-minute retry throttle after an attempt", async () => {
    const recent = story({ blob: { __autoStoryLastAttemptAt: new Date(NOON().getTime() - 10 * 60_000).toISOString() } });
    await run(recent.o);
    expect(recent.o.story.generatePreview).not.toHaveBeenCalled();
    const old = story({ blob: { __autoStoryLastAttemptAt: new Date(NOON().getTime() - 31 * 60_000).toISOString() } });
    await run(old.o);
    expect(old.o.story.generatePreview).toHaveBeenCalled();
  });

  it("a story another device already wrote today (found in the vault) counts as done, without a second one", async () => {
    const { o, blob } = story({ folderChildren: [file("2026-10-10 - 好故事")] });
    await run(o);
    expect(blob.__autoStoryLastSuccessDate).toBe("2026-10-10");
    expect(o.story.generatePreview).not.toHaveBeenCalled();
  });

  it("only a note whose name starts with today's date counts; other children and a missing folder do not", async () => {
    const other = story({ folderChildren: [file("2026-10-09 - old"), folder([]), file("notes")] });
    await run(other.o);
    expect(other.o.story.generatePreview).toHaveBeenCalled();
    const missing = story({ folderChildren: null });
    await run(missing.o);
    expect(missing.o.story.generatePreview).toHaveBeenCalled();
  });

  it("marks the attempt, but generates nothing when AI is off", async () => {
    const { o, blob } = story({ ai: false });
    await run(o);
    expect(blob.__autoStoryLastAttemptAt).toBe(NOON().toISOString());
    expect(o.story.generatePreview).not.toHaveBeenCalled();
  });

  it("pauses before generating, and drops out if a story landed from another device meanwhile", async () => {
    const { o, blob } = story({ folderChildren: [], after: [[file("2026-10-10 - arrived")]] });
    const p = o.tickAutoStory();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(o.story.generatePreview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await p;
    expect(o.story.generatePreview).not.toHaveBeenCalled();
    expect(blob.__autoStoryLastSuccessDate).toBe("2026-10-10");
  });

  it("generates, keeps the story as a note, records the day and says so", async () => {
    const { o, blob } = story();
    await run(o);
    const s = o.settings.story;
    expect(o.story.generatePreview).toHaveBeenCalledWith({ dueCount: s.defaultDueCount, lengthChars: s.defaultLengthChars, style: s.defaultStyle, targetHsk: "auto", includeGlossary: s.includeGlossary });
    expect(o.story.commitPreviewAsNote).toHaveBeenCalled();
    expect(blob.__autoStoryLastSuccessDate).toBe("2026-10-10");
    expect(Notice.instances.at(-1)!.message).toBe("Daily Chinese story generated.");
  });

  it("a failed generation is logged and not recorded as done, so the throttle lets it retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { o, blob } = story();
    o.story.generatePreview.mockRejectedValue(new Error("provider down"));
    await run(o);
    expect(warn).toHaveBeenCalledWith("CCI auto-story: generation failed", expect.any(Error));
    expect(blob.__autoStoryLastSuccessDate).toBeUndefined();
    expect(blob.__autoStoryLastAttemptAt).toBeDefined();
  });
});

describe("start-up bootstrap", () => {
  const boot = (over: (s: any) => void = () => {}, extra: Record<string, unknown> = {}) => {
    const o: any = bind({
      settings: settings((s) => ((s.autoDownloadDictionary = true), (s.vaultIndexed = false), over(s))),
      dictionary: { isOnDisk: vi.fn(async () => false), reload: vi.fn(async () => {}), ensureLoaded: vi.fn(async () => {}) },
      dictDownloader: { run: vi.fn(async () => 1) },
      vocab: { clearSurfaceCache: vi.fn() },
      ...extra,
    });
    return o;
  };

  it("downloads a missing dictionary, tells the user, reloads what depends on it, then indexes the vault", async () => {
    const o = boot();
    await o.bootstrapVault();
    expect(o.dictDownloader.run).toHaveBeenCalled();
    expect(o.dictionary.reload).toHaveBeenCalled();
    expect(o.vocab.clearSurfaceCache).toHaveBeenCalled();
    const n = Notice.instances[0];
    expect(n.message).toBe("Chinese plugin: dictionary ready.");
    const hide = vi.spyOn(n, "hide");
    vi.advanceTimersByTime(3000);
    expect(hide).toHaveBeenCalled();
    expect(indexer.indexVaultWithNotice).toHaveBeenCalledWith(o);
  });

  it("a failed download is reported, hidden after a while, and stops there (no index of a vault without a dictionary)", async () => {
    const o = boot();
    o.dictDownloader.run.mockRejectedValue(new Error("offline"));
    await o.bootstrapVault();
    const n = Notice.instances[0];
    expect(n.message).toBe("Chinese plugin: dictionary download failed — offline");
    const hide = vi.spyOn(n, "hide");
    vi.advanceTimersByTime(6000);
    expect(hide).toHaveBeenCalled();
    expect(indexer.indexVaultWithNotice).not.toHaveBeenCalled();
  });

  it("an installed dictionary, or auto-download switched off, is just loaded", async () => {
    const onDisk = boot((s) => (s.vaultIndexed = true), {});
    onDisk.dictionary.isOnDisk.mockResolvedValue(true);
    await onDisk.bootstrapVault();
    expect(onDisk.dictionary.ensureLoaded).toHaveBeenCalled();
    expect(onDisk.dictDownloader.run).not.toHaveBeenCalled();
    expect(indexer.indexVaultWithNotice).not.toHaveBeenCalled();
    const off = boot((s) => ((s.autoDownloadDictionary = false), (s.vaultIndexed = false)));
    await off.bootstrapVault();
    expect(off.dictionary.isOnDisk).not.toHaveBeenCalled();
    expect(off.dictionary.ensureLoaded).toHaveBeenCalled();
    expect(indexer.indexVaultWithNotice).toHaveBeenCalledTimes(1);
  });

  it("anything unexpected is logged, never thrown into load", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const o = boot((s) => (s.autoDownloadDictionary = false));
    o.dictionary.ensureLoaded.mockRejectedValue(new Error("corrupt"));
    await expect(o.bootstrapVault()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith("CCI bootstrap failed", expect.any(Error));
  });
});

describe("the mirror bootstrap after layout", () => {
  it("merges the mirror and redraws", async () => {
    const o: any = bind({ vocab: { bootstrapMirrorAfterLoad: vi.fn(async () => {}) }, refreshChineseViews: vi.fn(), refreshStatsViews: vi.fn() });
    await o.bootstrapVocabMirror();
    expect(o.refreshChineseViews).toHaveBeenCalled();
    expect(o.refreshStatsViews).toHaveBeenCalled();
  });

  it("a failure is logged and the user told the plugin still works, with how to retry", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const o: any = bind({ vocab: { bootstrapMirrorAfterLoad: vi.fn(async () => { throw new Error("stalled"); }) }, refreshChineseViews: vi.fn(), refreshStatsViews: vi.fn() });
    await o.bootstrapVocabMirror();
    expect(err).toHaveBeenCalledWith("CCI sync: mirror bootstrap failed", expect.any(Error));
    expect(Notice.instances.at(-1)!.message).toContain("mirror sync failed — stalled.");
    expect(Notice.instances.at(-1)!.message).toContain("Force re-sync now");
    expect(Notice.instances.at(-1)!.duration).toBe(8000);
  });

  it("an error with no message, or one whose message cannot be read, still gets through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const plain: any = bind({ vocab: { bootstrapMirrorAfterLoad: vi.fn(async () => { throw "just a string"; }) } });
    await plain.bootstrapVocabMirror();
    expect(Notice.instances.at(-1)!.message).toContain("just a string");
    const nasty = new Error("x");
    Object.defineProperty(nasty, "message", { get() { throw new Error("unreadable"); } });
    const o: any = bind({ vocab: { bootstrapMirrorAfterLoad: vi.fn(async () => { throw nasty; }) } });
    await expect(o.bootstrapVocabMirror()).resolves.toBeUndefined();
  });
});

describe("the crash counter", () => {
  const withState = (state: unknown) => {
    const files = new Map<string, string>();
    if (state !== undefined) files.set(".obsidian/plugins/cci/crash-state.json", typeof state === "string" ? state : JSON.stringify(state));
    const adapter = {
      exists: vi.fn(async (p: string) => files.has(p)),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, t: string) => void files.set(p, t)),
    };
    const o: any = bind({ manifest: { id: "cci", dir: ".obsidian/plugins/cci" }, app: { vault: { configDir: ".obsidian", adapter } } });
    return { o, adapter, files };
  };

  it("is reset to zero once the plugin has run well, writing only when there is something to reset", async () => {
    const dirty = withState({ counter: 3, autoDisabled: false });
    await dirty.o.resetCrashCounter();
    expect(JSON.parse(dirty.files.get(".obsidian/plugins/cci/crash-state.json")!)).toEqual({ counter: 0, autoDisabled: false });
    const clean = withState({ counter: 0, autoDisabled: false });
    await clean.o.resetCrashCounter();
    expect(clean.adapter.write).not.toHaveBeenCalled();
    const flagged = withState({ counter: 0, autoDisabled: true });
    await flagged.o.resetCrashCounter();
    expect(flagged.adapter.write).toHaveBeenCalled();
  });

  it("a counter that cannot be read or written never raises (the file helpers fail open)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = withState({ counter: 2, autoDisabled: false });
    bad.adapter.write.mockRejectedValue(new Error("EIO"));
    await expect(bad.o.resetCrashCounter()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("CCI crash-state write failed", expect.any(Error));
    bad.adapter.read.mockRejectedValue(new Error("EIO"));
    bad.adapter.exists.mockResolvedValue(true);
    await expect(bad.o.resetCrashCounter()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("CCI crash-state read failed; treating as clean", expect.any(Error));
  });

  it("and not even a broken manifest can make it throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const o: any = bind({ manifest: undefined, app: { vault: { configDir: ".obsidian", adapter: {} } } });
    await expect(o.resetCrashCounter()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("CCI crash-counter reset failed", expect.any(Error));
  });
});

describe("unloading", () => {
  it("resets the crash counter, then flushes the vocabulary and both mirrors, in that order", async () => {
    const calls: string[] = [];
    const o: any = bind({
      resetCrashCounter: vi.fn(async () => void calls.push("reset")),
      vocab: { flushSave: vi.fn(async () => void calls.push("save")), flushMirrorNow: vi.fn(async () => void calls.push("mirror")) },
      settingsMirror: { flushNow: vi.fn(async () => void calls.push("settings")) },
    });
    o.onunload();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(calls).toEqual(["reset", "save", "mirror", "settings"]);
  });

  it("a settings mirror that fails to flush, or does not exist, does not break unloading", async () => {
    const failing: any = bind({
      resetCrashCounter: vi.fn(async () => {}),
      vocab: { flushSave: vi.fn(async () => {}), flushMirrorNow: vi.fn(async () => {}) },
      settingsMirror: { flushNow: vi.fn(async () => { throw new Error("x"); }) },
    });
    expect(() => failing.onunload()).not.toThrow();
    const none: any = bind({ resetCrashCounter: vi.fn(async () => {}), vocab: { flushSave: vi.fn(async () => {}), flushMirrorNow: vi.fn(async () => {}) }, settingsMirror: undefined });
    expect(() => none.onunload()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("the commands", () => {
  it("are registered by id, and each does what its name says", () => {
    const commands: Record<string, { name: string; callback: () => unknown }> = {};
    const o: any = bind({
      viewMode: "read",
      addCommand: vi.fn((c: { id: string; name: string; callback: () => unknown }) => void (commands[c.id] = c)),
      backupNow: vi.fn(async () => {}),
      openCurrentInChineseView: vi.fn(async () => {}),
      openGenerateStoryModal: vi.fn(),
      openStatsView: vi.fn(async () => {}),
      setActiveViewMode: vi.fn(),
    });
    o.registerCommands();
    expect(Object.keys(commands)).toEqual(["backup-now", "open-current-in-chinese-view", "generate-review-story", "open-vocab-stats", "toggle-mark-known", "toggle-mark-unknown", "clear-marking-mode"]);
    expect(commands["backup-now"].name).toBe("Back up plugin data now");
    commands["backup-now"].callback();
    commands["open-current-in-chinese-view"].callback();
    commands["generate-review-story"].callback();
    commands["open-vocab-stats"].callback();
    expect([o.backupNow, o.openCurrentInChineseView, o.openGenerateStoryModal, o.openStatsView].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
    commands["toggle-mark-known"].callback();
    expect(o.setActiveViewMode).toHaveBeenLastCalledWith("mark-known");
    o.viewMode = "mark-known";
    commands["toggle-mark-known"].callback();
    expect(o.setActiveViewMode).toHaveBeenLastCalledWith("read");
    o.viewMode = "read";
    commands["toggle-mark-unknown"].callback();
    expect(o.setActiveViewMode).toHaveBeenLastCalledWith("mark-unknown");
    o.viewMode = "mark-unknown";
    commands["toggle-mark-unknown"].callback();
    expect(o.setActiveViewMode).toHaveBeenLastCalledWith("read");
    commands["clear-marking-mode"].callback();
    expect(o.setActiveViewMode).toHaveBeenLastCalledWith("read");
  });
});
