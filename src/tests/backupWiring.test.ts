import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * #149, how backups are plugged into start-up. main.ts is a shell that cannot be loaded whole, so its methods are run
 * against a plain object with `CciPlugin.prototype.<method>.call(self)`, the same technique as the tap-to-format tests.
 */

const h = vi.hoisted(() => ({ choice: "later" as "restore" | "keep" | "later", infos: [] as unknown[], opened: 0 }));
vi.mock("../ui/RestoreBackupModal", () => ({
  RestoreBackupModal: class {
    constructor(_app: unknown, info: unknown, private onResolve: (c: string) => void) {
      h.infos.push(info);
    }
    open() {
      h.opened++;
      this.onResolve(h.choice);
    }
  },
}));

import CciPlugin from "../main";

type Fn = (...a: unknown[]) => unknown;
const proto = CciPlugin.prototype as unknown as Record<string, Fn>;
const call = <T>(name: string, self: object, ...args: unknown[]) => proto[name].call(self, ...args) as T;

beforeEach(() => {
  Notice.instances.length = 0;
  h.choice = "later";
  h.infos.length = 0;
  h.opened = 0;
});

describe("startupData: restore, then read, then snapshot, in that order, and never throwing", () => {
  function fakeSelf(over: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const backups = {
      applyPendingRestore: vi.fn(async () => (calls.push("restore"), { status: "none" })),
      startup: vi.fn(async () => (calls.push("snapshot"), { action: "upgrade", backedUp: null })),
    };
    const blob = { settings: { backupsKeep: 7 }, vocab: {} };
    const self: Record<string, unknown> = {
      makeBackupService: () => backups,
      announceRestore: vi.fn(),
      loadPluginData: vi.fn(async () => (calls.push("read"), blob)),
      startupSettings: undefined,
      pendingDowngrade: null,
      ...over,
    };
    return { self, calls, backups, blob };
  }

  it("applies a queued restore BEFORE data.json is read, and snapshots AFTER it is read and BEFORE anything can write", async () => {
    const { self, calls, blob } = fakeSelf();
    const out = await call<Promise<unknown>>("startupData", self);
    expect(calls).toEqual(["restore", "read", "snapshot"]);
    expect(out).toBe(blob);
    expect(self.startupSettings).toBe(blob.settings);
  });

  it("remembers a downgrade for the prompt that follows the sync bootstrap", async () => {
    const down = { from: "0.9.0-beta.2", to: "0.9.0", candidate: null };
    const { self } = fakeSelf();
    (self.makeBackupService as () => { startup: Fn }) = () => ({ startup: async () => ({ action: "downgrade", backedUp: null, downgrade: down }), applyPendingRestore: async () => ({ status: "none" }) });
    await call("startupData", self);
    expect(self.pendingDowngrade).toBe(down);
  });

  it("a throwing restore or snapshot step never stops the data being returned", async () => {
    const { self, blob } = fakeSelf();
    const boom = { applyPendingRestore: async () => { throw new Error("restore boom"); }, startup: async () => { throw new Error("startup boom"); } };
    self.makeBackupService = () => boom;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(call("startupData", self)).resolves.toBe(blob);
    expect(self.pendingDowngrade).toBeNull();
  });

  it("announces a restore that was applied, and says nothing otherwise", () => {
    call("announceRestore", {}, { status: "none" });
    call("announceRestore", {}, { status: "failed" });
    expect(Notice.instances).toHaveLength(0);
    call("announceRestore", {}, { status: "applied", entry: { createdAt: "2026-10-01T00:00:00.000Z" } });
    expect(Notice.instances).toHaveLength(1);
    expect(Notice.instances[0].message).toMatch(/restored your data from the backup of .* Settings → Backups/);
  });
});

describe("onloadInner order (a text pin: a snapshot is only worth anything if nothing writes first)", () => {
  const src = readFileSync("src/main.ts", "utf8");
  const body = src.slice(src.indexOf("private async onloadInner"));

  it("calls startupData() before every call that can write data.json", () => {
    const at = body.indexOf("await this.startupData()");
    expect(at).toBeGreaterThan(-1);
    for (const writer of ["this.updateDataBlob(", "this.saveSettingsSilently(", "this.vocab.load(", "this.bootstrapVault(", "this.loadPluginData("]) {
      const w = body.indexOf(writer);
      expect(w, `${writer} must come after startupData()`).toBeGreaterThan(at);
    }
  });

  it("onloadInner itself never reads data.json: it takes the blob startupData() returns", () => {
    const start = src.indexOf("private async onloadInner");
    const end = src.indexOf("\n  }\n", start);
    const method = src.slice(start, end);
    expect(method).toContain("await this.startupData()");
    expect(method).not.toContain("this.loadPluginData(");
  });
});

describe("backupContext", () => {
  const ctx = (self: object) => call<{ enabled: boolean; keep: number; vocabMirrorPath: string | null; settingsMirrorPath: string | null }>("backupContext", self);

  it("uses the defaults before anything is loaded", () => {
    expect(ctx({})).toEqual({ enabled: true, keep: 5, vocabMirrorPath: null, settingsMirrorPath: null });
  });

  it("reads the start-up settings until live settings exist, and live settings win afterwards", () => {
    const early = { startupSettings: { backupsEnabled: false, backupsKeep: 9 } };
    expect(ctx(early)).toMatchObject({ enabled: false, keep: 9 });
    expect(ctx({ ...early, settings: { ...DEFAULT_SETTINGS, backupsKeep: 3 } })).toMatchObject({ enabled: true, keep: 3 });
  });

  it("clamps a hand-edited keep value to 1..50 and ignores garbage", () => {
    for (const [v, want] of [[0, 1], [-4, 1], [1000, 50], [2.9, 2], [NaN, 5], ["7", 5]] as const) {
      expect(ctx({ startupSettings: { backupsKeep: v } }).keep, String(v)).toBe(want);
    }
  });

  it("includes a mirror path only while that mirror is switched on", () => {
    const sync = { ...DEFAULT_SETTINGS.sync, mirrorEnabled: true, mirrorPath: "CL/v.json", settingsMirrorEnabled: false, settingsMirrorPath: "CL/s.json" };
    expect(ctx({ settings: { ...DEFAULT_SETTINGS, sync } })).toMatchObject({ vocabMirrorPath: "CL/v.json", settingsMirrorPath: null });
    expect(ctx({ settings: { ...DEFAULT_SETTINGS, sync: { ...sync, mirrorEnabled: false, settingsMirrorEnabled: true } } })).toMatchObject({
      vocabMirrorPath: null,
      settingsMirrorPath: "CL/s.json",
    });
  });
});

describe("promptDowngradeRestore", () => {
  const entry = (includes: string[]) => ({ id: "b1", createdAt: "2026-10-01T10:00:00.000Z", includes });
  function self(downgrade: unknown) {
    const backups = {
      keepCurrent: vi.fn(async () => {}),
      stageRestore: vi.fn(async () => ({ ok: true, message: "Restore queued. Restart Obsidian (or turn the plugin off and on) to finish." })),
    };
    return { s: { pendingDowngrade: downgrade, backups, app: {} }, backups };
  }
  const run = (s: object) => call<Promise<void>>("promptDowngradeRestore", s);

  it("does nothing when there was no downgrade", async () => {
    const { s, backups } = self(null);
    await run(s);
    expect(h.opened).toBe(0);
    expect(backups.keepCurrent).not.toHaveBeenCalled();
  });

  it("with nothing to restore, tells the user once and stops asking", async () => {
    const { s, backups } = self({ from: "0.9.0-beta.2", to: "0.9.0", candidate: null });
    await run(s);
    expect(h.opened).toBe(0);
    expect(Notice.instances[0].message).toContain("no earlier backup to restore");
    expect(backups.keepCurrent).toHaveBeenCalledTimes(1);
  });

  it("Restore queues the restore and tells the user to restart (a notice that stays)", async () => {
    h.choice = "restore";
    const { s, backups } = self({ from: "0.9.0-beta.2", to: "0.9.0", candidate: entry(["data"]) });
    await run(s);
    expect(backups.stageRestore).toHaveBeenCalledWith("b1");
    expect(backups.keepCurrent).not.toHaveBeenCalled();
    expect(Notice.instances.at(-1)!.message).toContain("Restart Obsidian");
    expect(Notice.instances.at(-1)!.duration).toBe(0);
  });

  it("a restore that could not be queued says so for a limited time", async () => {
    h.choice = "restore";
    const { s, backups } = self({ from: "a", to: "b", candidate: entry(["data"]) });
    backups.stageRestore.mockResolvedValue({ ok: false, message: "The backup file is missing." });
    await run(s);
    expect(Notice.instances.at(-1)!.duration).toBe(15_000);
  });

  it("Keep current data records the lower version; Decide later changes nothing", async () => {
    h.choice = "keep";
    const keep = self({ from: "a", to: "b", candidate: entry(["data"]) });
    await run(keep.s);
    expect(keep.backups.keepCurrent).toHaveBeenCalledTimes(1);
    expect(keep.backups.stageRestore).not.toHaveBeenCalled();

    h.choice = "later";
    const later = self({ from: "a", to: "b", candidate: entry(["data"]) });
    await run(later.s);
    expect(later.backups.keepCurrent).not.toHaveBeenCalled();
    expect(later.backups.stageRestore).not.toHaveBeenCalled();
  });

  it("passes the versions and date to the dialog, and flags the sync caveat only when sync files are in the backup", async () => {
    const plain = self({ from: "0.9.0-beta.2", to: "0.9.0", candidate: entry(["data"]) });
    await run(plain.s);
    const synced = self({ from: "0.9.0-beta.2", to: "0.9.0", candidate: entry(["data", "vocabMirror"]) });
    await run(synced.s);
    expect(h.infos[0]).toMatchObject({ from: "0.9.0-beta.2", to: "0.9.0", includesSyncFiles: false });
    expect((h.infos[0] as { backupDate: Date }).backupDate.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(h.infos[1]).toMatchObject({ includesSyncFiles: true });
  });

  it("asks once per start: the pending downgrade is consumed", async () => {
    const { s } = self({ from: "a", to: "b", candidate: entry(["data"]) });
    await run(s);
    await run(s);
    expect(h.opened).toBe(1);
  });
});

describe("backupNow", () => {
  const run = (snapshot: unknown) => call<Promise<void>>("backupNow", { backups: { snapshot: async () => snapshot } });

  it("says what happened for each outcome", async () => {
    await run({ entry: { storedBytes: 1_572_864 } });
    await run({ entry: null, skipped: "unchanged" });
    await run({ entry: null, skipped: "no-data" });
    await run({ entry: null, failed: "disk full" }); // already reported by the service
    expect(Notice.instances.map((n) => n.message)).toEqual([
      "Chinese plugin: backed up your data (1.5 MB).",
      "Chinese plugin: nothing has changed since the last backup, so there is nothing new to save.",
      "Chinese plugin: there is no saved data to back up yet.",
    ]);
  });
});
