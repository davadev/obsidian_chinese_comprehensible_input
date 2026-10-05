import { describe, it, expect, vi } from "vitest";

/**
 * The conflict dialog's own rendering and button wiring (the dismissal path is in
 * settingsConflictModal.test.ts). A conflict dialog that shows the wrong value on a button,
 * or a "Keep all local" that applies remote, silently overwrites a setting, so each button's
 * outcome is checked, not just that something renders.
 *
 * No DOM library: a tiny element fake records what the modal creates and lets the test click.
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

import { SettingsConflictModal, type SettingsConflict } from "../ui/SettingsConflictModal";

class El {
  children: El[] = [];
  text = "";
  cls = "";
  classes = new Set<string>();
  listeners: Record<string, () => void> = {};
  classList = {
    toggle: (c: string, on: boolean) => (on ? this.classes.add(c) : this.classes.delete(c)),
  };
  empty() {
    this.children = [];
  }
  private make(o?: { text?: string; cls?: string }) {
    const e = new El();
    e.text = o?.text ?? "";
    e.cls = o?.cls ?? "";
    this.children.push(e);
    return e;
  }
  createEl(_tag: string, o?: { text?: string; cls?: string }) {
    return this.make(o);
  }
  createDiv(o?: { text?: string; cls?: string }) {
    return this.make(o);
  }
  addEventListener(ev: string, fn: () => void) {
    this.listeners[ev] = fn;
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
}

const conflicts: SettingsConflict[] = [
  { keyPath: "readerFontPx", local: 22, remote: 26 },
  { keyPath: "customColors", local: { a: 1 }, remote: null },
  { keyPath: "note", local: "x".repeat(80), remote: "short" },
];

function open() {
  h.buttons.length = 0;
  const onResolve = vi.fn();
  const modal = new SettingsConflictModal({} as never, conflicts, onResolve);
  const contentEl = new El();
  Object.assign(modal, { contentEl, containerEl: {} });
  modal.onOpen();
  const rows = contentEl.children.find((c) => c.cls === "cci-conflict-list")!.children;
  return { modal, onResolve, rows, contentEl };
}
const btn = (name: string) => h.buttons.find((b) => b.text === name)!;

describe("SettingsConflictModal rendering", () => {
  it("shows a heading and one row per conflict with the key, and both values on the buttons", () => {
    const { rows, contentEl } = open();
    expect(contentEl.children[0].text).toBe("Settings sync conflict");
    expect(rows).toHaveLength(3);
    expect(rows[0].children.map((c) => c.text)).toEqual(["readerFontPx", "Local: 22", "Remote: 26"]);
    // objects are JSON, null is "null", long strings are cut with an ellipsis
    expect(rows[1].children.map((c) => c.text)).toEqual(["customColors", 'Local: {"a":1}', "Remote: null"]);
    expect(rows[2].children[1].text).toMatch(/^Local: x{57}…$/);
  });

  it("starts with remote chosen for every row", () => {
    const { rows } = open();
    for (const r of rows) {
      expect(r.children[2].classes.has("mod-cta")).toBe(true);
      expect(r.children[1].classes.has("mod-cta")).toBe(false);
    }
  });

  it("clicking a side highlights it, and only it", () => {
    const { rows } = open();
    rows[0].children[1].listeners.click(); // Local
    expect(rows[0].children[1].classes.has("mod-cta")).toBe(true);
    expect(rows[0].children[2].classes.has("mod-cta")).toBe(false);
    rows[0].children[2].listeners.click(); // back to Remote
    expect(rows[0].children[2].classes.has("mod-cta")).toBe(true);
    expect(rows[0].children[1].classes.has("mod-cta")).toBe(false);
  });

  it("offers three buttons, with 'Apply choices' as the call to action", () => {
    open();
    expect(h.buttons.map((b) => b.text)).toEqual(["Keep all local", "Use all remote", "Apply choices"]);
    expect(btn("Apply choices").cta).toBe(true);
    expect(btn("Keep all local").cta).toBe(false);
  });
});

describe("SettingsConflictModal buttons", () => {
  const outcome = (onResolve: ReturnType<typeof vi.fn>) =>
    Object.fromEntries(onResolve.mock.calls[0][0] as Map<string, string>);

  it("'Keep all local' resolves every key as local", () => {
    const { onResolve } = open();
    btn("Keep all local").click();
    expect(outcome(onResolve)).toEqual({ readerFontPx: "local", customColors: "local", note: "local" });
  });

  it("'Use all remote' resolves every key as remote, even after per-row clicks to local", () => {
    const { onResolve, rows } = open();
    rows[0].children[1].listeners.click();
    btn("Use all remote").click();
    expect(outcome(onResolve)).toEqual({ readerFontPx: "remote", customColors: "remote", note: "remote" });
  });

  it("'Apply choices' resolves with exactly the per-row picks", () => {
    const { onResolve, rows } = open();
    rows[1].children[1].listeners.click(); // customColors -> local
    btn("Apply choices").click();
    expect(outcome(onResolve)).toEqual({ readerFontPx: "remote", customColors: "local", note: "remote" });
  });

  it("resolves once, however many buttons are hit", () => {
    const { onResolve } = open();
    btn("Apply choices").click();
    btn("Keep all local").click();
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("re-opening redraws the list instead of stacking a second one", () => {
    const { modal, contentEl } = open();
    modal.onOpen();
    expect(contentEl.children.filter((c) => c.cls === "cci-conflict-list")).toHaveLength(1);
  });
});
