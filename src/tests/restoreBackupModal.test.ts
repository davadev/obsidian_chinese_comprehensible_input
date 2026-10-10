import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #149: the question asked after a downgrade. A wrong answer here either throws away a person's recent work
 * ("Restore" when they meant to keep) or never offers the way back, so each button's outcome is checked, the dismissal
 * paths all mean "Decide later", and the wording that carries the warnings is pinned.
 * No DOM library: a tiny element fake records what the modal creates (same approach as settingsConflictModalDom.test.ts).
 */

interface Btn {
  text: string;
  cta: boolean;
  click: () => void;
}
const h = vi.hoisted(() => ({ buttons: [] as Array<{ text: string; cta: boolean; click: () => void }> }));

vi.mock("obsidian", async (orig) => {
  const real = await orig<typeof import("obsidian")>();
  class Setting {
    constructor(_el: unknown) {}
    addButton(cb: (b: unknown) => void) {
      const b: Btn = { text: "", cta: false, click: () => {} };
      const api = {
        setButtonText(t: string) {
          b.text = t;
          return api;
        },
        setCta() {
          b.cta = true;
          return api;
        },
        onClick(fn: () => void) {
          b.click = fn;
          return api;
        },
      };
      cb(api);
      h.buttons.push(b);
      return this;
    }
  }
  return { ...real, Setting };
});
vi.mock("../ui/modalLayer", () => ({ liftModal: vi.fn() }));

import { RestoreBackupModal, type RestoreBackupInfo, type RestoreChoice } from "../ui/RestoreBackupModal";

class El {
  children: El[] = [];
  tag = "";
  text = "";
  cls = "";
  empty() {
    this.children = [];
  }
  createEl(tag: string, o?: { text?: string; cls?: string }) {
    const e = new El();
    e.tag = tag;
    e.text = o?.text ?? "";
    e.cls = o?.cls ?? "";
    this.children.push(e);
    return e;
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
}

const INFO: RestoreBackupInfo = { from: "0.9.0-beta.2", to: "0.9.0", backupDate: new Date("2026-10-01T10:00:00.000Z"), includesSyncFiles: false };

function open(info: RestoreBackupInfo = INFO) {
  h.buttons.length = 0;
  const choices: RestoreChoice[] = [];
  const modal = new RestoreBackupModal({} as never, info, (c) => choices.push(c));
  const contentEl = new El();
  (modal as unknown as { contentEl: El }).contentEl = contentEl;
  (modal as unknown as { close: () => void }).close = vi.fn(() => modal.onClose());
  modal.onOpen();
  return { modal, contentEl, choices };
}
const button = (text: string) => h.buttons.find((b) => b.text === text)!;

beforeEach(() => {
  h.buttons.length = 0;
});

describe("RestoreBackupModal", () => {
  it("offers exactly three buttons, with Restore as the default", () => {
    open();
    expect(h.buttons.map((b) => b.text)).toEqual(["Restore", "Keep current data", "Decide later"]);
    expect(h.buttons.filter((b) => b.cta).map((b) => b.text)).toEqual(["Restore"]);
  });

  it.each([
    ["Restore", "restore"],
    ["Keep current data", "keep"],
    ["Decide later", "later"],
  ])("%s resolves with '%s' exactly once", (label, want) => {
    const { choices } = open();
    button(label).click();
    button("Restore").click(); // a second click after closing must be ignored
    expect(choices).toEqual([want]);
  });

  it("every way of dismissing it without choosing means 'Decide later'", () => {
    const { modal, choices } = open();
    modal.onClose(); // Esc, a click outside, or the close button all end here
    expect(choices).toEqual(["later"]);
    modal.onClose();
    expect(choices).toEqual(["later"]);
  });

  it("an answer followed by the close that follows it is not reported twice", () => {
    const { choices } = open();
    button("Keep current data").click();
    expect(choices).toEqual(["keep"]);
  });

  it("states the versions, the date, what will be lost, that the current data is saved first, and the restart", () => {
    const { contentEl } = open();
    const text = contentEl.all().map((e) => e.text).join("\n");
    expect(text).toContain("You went back from 0.9.0-beta.2 to 0.9.0");
    expect(text).toContain("Restore your data from before 0.9.0-beta.2");
    expect(text).toContain(INFO.backupDate.toLocaleString());
    expect(text).toContain("Anything you did in 0.9.0-beta.2, such as words you marked, will be lost");
    expect(text).toContain("Your current data is saved first");
    expect(text).toContain("restart Obsidian");
  });

  it("shows the sync caveat only when this device's sync files are part of the backup", () => {
    const without = open().contentEl.all().map((e) => e.text).join("\n");
    expect(without).not.toContain("another device");
    const withSync = open({ ...INFO, includesSyncFiles: true }).contentEl.all();
    const warn = withSync.find((e) => e.text.includes("another device"));
    expect(warn?.cls).toBe("cci-settings-warn");
    expect(warn?.text).toContain("Pause sync and restore the same copy there too");
  });
});
