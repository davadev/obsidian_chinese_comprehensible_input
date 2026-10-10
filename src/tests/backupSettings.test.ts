import { beforeEach, describe, expect, it, vi } from "vitest";
import { CciSettingsTab } from "../settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { installCreateFragmentStub } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings

const confirm = vi.hoisted(() => ({ answer: true, asked: [] as Array<{ msg: string; label: string | undefined }> }));
vi.mock("../ui/confirmInput", () => ({
  confirmAsync: vi.fn(async (_app: unknown, msg: string, label?: string) => {
    confirm.asked.push({ msg, label });
    return confirm.answer;
  }),
}));

/**
 * #149: the Backups group in Settings. The controls are bound to the two per-device keys, the "keep" number is greyed
 * out while backups are off, and switching the toggle re-evaluates that without rebuilding the page.
 */

type Def = { type?: string; heading?: string; name?: string; items?: Def[]; control?: { type: string; key: string; min?: number; max?: number; disabled?: () => boolean } };

function makeTab() {
  const plugin: any = {
    backups: {
      stageRestore: vi.fn(async () => ({ ok: true, message: "Restore queued. Restart Obsidian (or turn the plugin off and on) to finish." })),
      cancelRestore: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      pendingRestore: vi.fn(async () => null),
    },
    backupNow: vi.fn(async () => {}),
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    app: { vault: { configDir: ".obsidian" } },
    saveSettings: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    refreshChineseViewAppearance: vi.fn(),
    loadLocalStorage: vi.fn(() => null),
  };
  const tab = new CciSettingsTab(plugin.app, plugin) as unknown as {
    restoreFromList(entry: { id: string; createdAt: string; fromVersion: string }): Promise<void>;
    backupNowFromSettings(): Promise<void>;
    getSettingDefinitions(): Def[];
    setControlValue(key: string, v: unknown): Promise<void>;
    refreshDomState(): void;
    update(): void;
  };
  return { tab, plugin };
}

beforeEach(() => {
  installCreateFragmentStub();
  confirm.answer = true;
  confirm.asked.length = 0;
  Notice.instances.length = 0;
});

/** Backups live on their own page inside the Data group, next to export / import / reset. */
const backupsPage = (tab: { getSettingDefinitions(): Def[] }) =>
  tab.getSettingDefinitions().find((d) => d.heading === "Data")!.items!.find((i) => i.type === "page" && i.name === "Backups")!;

describe("Backups settings page", () => {
  const group = backupsPage;
  const controls = (g: Def) => (g.items ?? []).filter((i) => i.control);

  it("exists as a page in the Data group, with a toggle and a number bound to the two per-device keys", () => {
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
      if (!r.render || i.name) continue; // prose rows have no name; the list row draws into a real element
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

describe("Backups page: actions", () => {
  const entry = { id: "b1", createdAt: "2026-10-01T10:00:00.000Z", fromVersion: "0.9.0" };

  it("has a 'Back up now' action and the backup list", () => {
    const { tab } = makeTab();
    const g = backupsPage(tab);
    const names = (g.items ?? []).map((i) => i.name);
    expect(names).toContain("Back up now");
    expect(names).toContain("Backups");
  });

  it("Back up now takes the backup and redraws the page so the new row appears", async () => {
    const { tab, plugin } = makeTab();
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await tab.backupNowFromSettings();
    expect(plugin.backupNow).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("Restore asks first, says what will be lost and when it takes effect, then queues it with a notice that stays", async () => {
    const { tab, plugin } = makeTab();
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await tab.restoreFromList(entry);
    expect(confirm.asked).toHaveLength(1);
    expect(confirm.asked[0].label).toBe("Restore");
    expect(confirm.asked[0].msg).toContain(new Date(entry.createdAt).toLocaleString());
    expect(confirm.asked[0].msg).toContain("written by 0.9.0");
    expect(confirm.asked[0].msg).toContain("Anything you changed since will be lost");
    expect(confirm.asked[0].msg).toContain("restart Obsidian");
    expect(plugin.backups.stageRestore).toHaveBeenCalledWith("b1");
    expect(Notice.instances.at(-1)!.duration).toBe(0);
    expect(update).toHaveBeenCalled();
  });

  it("declining the confirmation queues nothing", async () => {
    confirm.answer = false;
    const { tab, plugin } = makeTab();
    await tab.restoreFromList(entry);
    expect(plugin.backups.stageRestore).not.toHaveBeenCalled();
    expect(Notice.instances).toHaveLength(0);
  });

  it("a restore that could not be queued says so for a limited time", async () => {
    const { tab, plugin } = makeTab();
    plugin.backups.stageRestore.mockResolvedValue({ ok: false, message: "The backup file is missing, so it cannot be restored." });
    vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await tab.restoreFromList(entry);
    expect(Notice.instances.at(-1)!.duration).toBe(15_000);
  });

  it("describes data from before this feature as 'an earlier version'", async () => {
    const { tab } = makeTab();
    vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await tab.restoreFromList({ ...entry, fromVersion: "unknown" });
    expect(confirm.asked[0].msg).toContain("written by an earlier version");
    expect(confirm.asked[0].msg).not.toContain("unknown");
  });
});

describe("Backups page: placement", () => {
  it("is not a top-level group of its own any more", () => {
    const { tab } = makeTab();
    expect(tab.getSettingDefinitions().some((d) => d.heading === "Backups")).toBe(false);
  });

  it("sits in the Data group, as a page with a description, so the list does not lengthen the main page", () => {
    const { tab } = makeTab();
    const page = backupsPage(tab) as Def & { desc?: string };
    expect(page.desc).toMatch(/copies/i);
  });
});

describe("Backups page: Delete", () => {
  const entry = { id: "b1", createdAt: "2026-10-01T10:00:00.000Z", fromVersion: "0.9.0" };
  type DeleteTab = { deleteFromList(e: typeof entry, wayBack: boolean): Promise<void>; update(): void };

  it("asks first, deletes that backup, tells the user and redraws", async () => {
    const { tab, plugin } = makeTab();
    plugin.backups.deleteBackup = vi.fn(async () => ({ ok: true, message: "Backup deleted." }));
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await (tab as unknown as DeleteTab).deleteFromList(entry, false);
    expect(confirm.asked[0].label).toBe("Delete");
    expect(confirm.asked[0].msg).toContain(new Date(entry.createdAt).toLocaleString());
    expect(confirm.asked[0].msg).toContain("cannot be undone");
    expect(confirm.asked[0].msg).not.toContain("way back");
    expect(plugin.backups.deleteBackup).toHaveBeenCalledWith("b1");
    expect(Notice.instances.at(-1)!.duration).toBe(4000);
    expect(update).toHaveBeenCalled();
  });

  it("warns plainly when it is the way back to the stable release", async () => {
    const { tab, plugin } = makeTab();
    plugin.backups.deleteBackup = vi.fn(async () => ({ ok: true, message: "Backup deleted." }));
    vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await (tab as unknown as DeleteTab).deleteFromList(entry, true);
    expect(confirm.asked[0].msg).toContain("your way back to that release");
  });

  it("declining deletes nothing", async () => {
    confirm.answer = false;
    const { tab, plugin } = makeTab();
    plugin.backups.deleteBackup = vi.fn();
    await (tab as unknown as DeleteTab).deleteFromList(entry, false);
    expect(plugin.backups.deleteBackup).not.toHaveBeenCalled();
    expect(Notice.instances).toHaveLength(0);
  });

  it("a delete that failed says so for a limited time", async () => {
    const { tab, plugin } = makeTab();
    plugin.backups.deleteBackup = vi.fn(async () => ({ ok: false, message: "Could not delete the backup (EIO)." }));
    vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await (tab as unknown as DeleteTab).deleteFromList(entry, false);
    expect(Notice.instances.at(-1)!.duration).toBe(15_000);
  });
});

describe("Backups list: robustness", () => {
  it("a list that cannot be read shows a message instead of throwing out of the settings render", async () => {
    const { tab, plugin } = makeTab();
    plugin.backups.list.mockRejectedValue(new Error("EIO"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const drawn: string[] = [];
    const el = { empty() {}, createDiv: (o: { text: string }) => drawn.push(o.text) };
    await (tab as unknown as { renderBackups(e: unknown): Promise<void> }).renderBackups(el);
    expect(drawn).toEqual(["The list of backups could not be read."]);
  });

  it("and survives having nothing at all to draw into", async () => {
    const { tab, plugin } = makeTab();
    plugin.backups.list.mockRejectedValue(new Error("EIO"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect((tab as unknown as { renderBackups(e: unknown): Promise<void> }).renderBackups({})).resolves.toBeUndefined();
  });
});
