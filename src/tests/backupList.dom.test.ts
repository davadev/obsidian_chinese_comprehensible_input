// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { KIND_LABEL, renderBackupList, type BackupListHost } from "../settings/BackupList";
import type { BackupEntry } from "../data/backupPolicy";

/**
 * #149: the list in Settings > Backups. It is the only place a person can see what has been saved and undo a restore,
 * so what each row says and what its button does is checked, not just that something renders.
 */

installObsidianDom();

let n = 0;
const entry = (over: Partial<BackupEntry> = {}): BackupEntry => ({
  id: `id${++n}`,
  createdAt: "2026-10-01T10:00:00.000Z",
  fromVersion: "0.9.0",
  kind: "version-change",
  file: `f${n}.json.gz`,
  encoding: "gzip",
  rawBytes: 5_000_000,
  storedBytes: 1_572_864,
  sha256: "x",
  includes: ["data"],
  ...over,
});

function host(entries: BackupEntry[], pending: BackupEntry | null = null) {
  const h: BackupListHost & { restored: BackupEntry[]; cancelled: number; deleted: Array<[BackupEntry, boolean]> } = {
    restored: [],
    cancelled: 0,
    deleted: [],
    list: async () => entries,
    pending: async () => pending,
    onRestore: async (e) => void h.restored.push(e),
    onCancelPending: async () => void h.cancelled++,
    onDelete: async (e, wayBack) => void h.deleted.push([e, wayBack]),
  };
  return h;
}
const mount = async (h: BackupListHost) => {
  const el = document.createElement("div");
  await renderBackupList(el, h);
  return el;
};
const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".cci-backup-row"));

describe("renderBackupList", () => {
  it("says so when there are no backups yet, and how one gets made", async () => {
    const el = await mount(host([]));
    expect(rows(el)).toHaveLength(0);
    expect(el.textContent).toContain("No backups yet");
    expect(el.textContent).toContain("Back up now");
  });

  it("shows one row per backup, in the order given, with date, source version, kind and size", async () => {
    const a = entry({ createdAt: "2026-10-02T09:00:00.000Z", fromVersion: "0.9.0-beta.2", kind: "version-change" });
    const b = entry({ createdAt: "2026-10-01T09:00:00.000Z", fromVersion: "0.9.0", kind: "manual", storedBytes: 48_000 });
    const el = await mount(host([a, b]));
    const r = rows(el);
    expect(r).toHaveLength(2);
    expect(r[0].textContent).toContain(new Date(a.createdAt).toLocaleString());
    expect(r[0].textContent).toContain("Data from 0.9.0-beta.2");
    expect(r[0].textContent).toContain(KIND_LABEL["version-change"]);
    expect(r[0].textContent).toContain("1.5 MB");
    expect(r[1].textContent).toContain("Data from 0.9.0");
    expect(r[1].textContent).toContain("backed up by hand");
    expect(r[1].textContent).toContain("47 KB");
  });

  it("names data from before this feature as 'an earlier version', not the internal 'unknown'", async () => {
    const el = await mount(host([entry({ fromVersion: "unknown" })]));
    expect(el.textContent).toContain("Data from an earlier version");
    expect(el.textContent).not.toContain("unknown");
  });

  it("flags backups that include sync files, and ones that are not compressed", async () => {
    const el = await mount(host([entry({ includes: ["data", "vocabMirror"], encoding: "none" })]));
    expect(el.textContent).toContain("with sync files");
    expect(el.textContent).toContain("not compressed");
    const plain = await mount(host([entry()]));
    expect(plain.textContent).not.toContain("with sync files");
    expect(plain.textContent).not.toContain("not compressed");
  });

  it("every kind has a human label", () => {
    for (const k of ["version-change", "manual", "pre-restore", "downgrade-safety"] as const) expect(KIND_LABEL[k].length).toBeGreaterThan(3);
  });

  it("a row's Restore button hands exactly that backup to the host", async () => {
    const a = entry(), b = entry();
    const h = host([a, b]);
    const el = await mount(h);
    rows(el)[1].querySelector("button")!.click();
    expect(h.restored).toEqual([b]);
  });

  it("a row's Delete button hands exactly that backup to the host", async () => {
    const a = entry({ fromVersion: "0.9.0-beta.1" }), b = entry({ fromVersion: "0.9.0-beta.2" });
    const h = host([a, b]);
    const el = await mount(h);
    const buttons = rows(el)[1].querySelectorAll("button");
    expect(Array.from(buttons).map((x) => x.textContent)).toEqual(["Restore", "Delete"]);
    buttons[1].click();
    expect(h.deleted).toEqual([[b, false]]);
  });

  it("marks the newest stable-origin backup as the way back, on screen and to the host", async () => {
    const beta = entry({ createdAt: "2026-10-03T10:00:00.000Z", fromVersion: "0.9.0-beta.2" });
    const stableNew = entry({ createdAt: "2026-10-02T10:00:00.000Z", fromVersion: "0.8.0" });
    const stableOld = entry({ createdAt: "2026-10-01T10:00:00.000Z", fromVersion: "0.7.9" });
    const h = host([beta, stableNew, stableOld]);
    const el = await mount(h);
    const r = rows(el);
    expect(r[0].textContent).not.toContain("way back");
    expect(r[1].textContent).toContain("your way back to the stable release");
    expect(r[2].textContent).not.toContain("way back");
    r[1].querySelectorAll("button")[1].click();
    r[2].querySelectorAll("button")[1].click();
    expect(h.deleted.map(([e, wayBack]) => [e.id, wayBack])).toEqual([[stableNew.id, true], [stableOld.id, false]]);
  });

  it("a queued restore is shown above the list with a way to withdraw it", async () => {
    const queued = entry({ createdAt: "2026-10-01T10:00:00.000Z" });
    const h = host([queued], queued);
    const el = await mount(h);
    const bar = el.querySelector(".cci-backup-pending")!;
    expect(bar.textContent).toContain("A restore is queued");
    expect(bar.textContent).toContain(new Date(queued.createdAt).toLocaleString());
    expect(bar.textContent).toContain("Restart Obsidian");
    bar.querySelector("button")!.click();
    expect(h.cancelled).toBe(1);
  });

  it("shows no queued-restore bar when nothing is queued", async () => {
    expect((await mount(host([entry()]))).querySelector(".cci-backup-pending")).toBeNull();
  });

  it("two renders that overlap (the page redrawn while the first is still reading the index) show each row once", async () => {
    // Seen on an iPhone: every backup appeared twice. Both renders cleared the element before their data arrived, so
    // both then appended.
    const el = document.createElement("div");
    const h = host([entry(), entry()]);
    const gate = new Promise<void>((r) => setTimeout(r, 5));
    const slow: BackupListHost = { ...h, list: async () => (await gate, h.list()) };
    await Promise.all([renderBackupList(el, slow), renderBackupList(el, slow), renderBackupList(el, h)]);
    expect(rows(el)).toHaveLength(2);
    expect(el.querySelectorAll(".cci-backup-list")).toHaveLength(1);
  });

  it("redrawing replaces the old content instead of stacking it", async () => {
    const el = document.createElement("div");
    const h = host([entry(), entry()]);
    await renderBackupList(el, h);
    await renderBackupList(el, h);
    expect(rows(el)).toHaveLength(2);
  });
});

void vi;
