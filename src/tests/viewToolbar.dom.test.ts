// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { ViewToolbar } from "../view/ViewToolbar";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * #119: ViewToolbar under a DOM. It is plain DOM (no CodeMirror, no layout), so happy-dom hosts it with the shared
 * Obsidian DOM fixture and a plain-object plugin. What is pinned here is behaviour that used to be reachable only by
 * opening the app: the menu's open / close / reopen cycle (0.7.7 shipped a dead tap), the script rows acting as radios,
 * and which rows exist for which colour mode.
 */

installObsidianDom();

function makePlugin(settings: Record<string, unknown> = {}, startMode = "read") {
  let mode = startMode;
  const plugin: any = {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    app: {},
    saveSettings: vi.fn(async () => {}),
    activeViewMode: vi.fn(() => mode),
    setActiveViewMode: vi.fn((m: string) => void (mode = m)),
    offerReindexAfterScriptChange: vi.fn(),
    computeNoteStats: vi.fn(() => ({ total: 0, known: 0, partial: 0, unknown: 0, newCount: 0 })),
    currentNoteKey: vi.fn(() => null),
  };
  return plugin;
}

function mount(settings: Record<string, unknown> = {}, startMode = "read") {
  const plugin = makePlugin(settings, startMode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const toolbar = new ViewToolbar(plugin, container, onChange, () => "");
  return { plugin, container, onChange, toolbar };
}

const menu = () => document.body.querySelector<HTMLElement>(".cci-overflow-menu");
const trigger = (c: HTMLElement) => c.querySelector<HTMLElement>(".cci-overflow-btn-trigger")!;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("ViewToolbar under a DOM (#119)", () => {
  it("renders the marking buttons and toggles a mode on click", () => {
    const { container, plugin } = mount();
    const known = container.querySelector<HTMLElement>('[data-mode="mark-known"]')!;
    expect(known).toBeTruthy();
    known.click();
    expect(plugin.setActiveViewMode).toHaveBeenLastCalledWith("mark-known");
    known.click();
    expect(plugin.setActiveViewMode).toHaveBeenLastCalledWith("read");
  });

  it("opens the overflow menu, closes it on an outside click, and the NEXT tap reopens it (no dead tap)", () => {
    const { container } = mount();
    trigger(container).click();
    expect(menu()).toBeTruthy();
    vi.runOnlyPendingTimers(); // the outside-click listener is registered on a timer
    document.body.click();
    expect(menu()).toBeNull();
    trigger(container).click();
    expect(menu(), "a menu closed by an outside click must reopen on the next tap").toBeTruthy();
  });

  it("tapping the trigger again closes the menu, and it opens a third time", () => {
    const { container } = mount();
    trigger(container).click();
    trigger(container).click();
    expect(menu()).toBeNull();
    trigger(container).click();
    expect(menu()).toBeTruthy();
  });

  it("the script rows behave as radios: picking one leaves exactly one ticked", async () => {
    const { container, plugin } = mount({ scriptVariant: "auto" });
    trigger(container).click();
    const rows = Array.from(menu()!.querySelectorAll<HTMLElement>(".cci-overflow-item")).filter((r) =>
      /Automatic|Traditional characters|Simplified characters/.test(r.textContent ?? "")
    );
    expect(rows).toHaveLength(3);
    const ticked = () => rows.map((r) => r.querySelector<HTMLInputElement>("input")!.checked);
    expect(ticked()).toEqual([true, false, false]);

    rows[1].click(); // Traditional
    await vi.waitFor(() => expect(plugin.settings.scriptVariant).toBe("traditional"));
    expect(ticked()).toEqual([false, true, false]);

    rows[1].click(); // the already-active row must not untick itself
    await vi.runAllTimersAsync();
    expect(ticked()).toEqual([false, true, false]);
  });

  it("shows status-colour rows by default and HSK rows in HSK colour mode", () => {
    const status = mount({ colorMode: "status" });
    trigger(status.container).click();
    expect(menu()!.textContent).toContain("Color known");
    expect(menu()!.textContent).not.toContain("HSK 3");
    document.body.innerHTML = "";

    const hsk = mount({ colorMode: "hsk" });
    trigger(hsk.container).click();
    expect(menu()!.textContent).toContain("HSK 3");
    expect(menu()!.textContent).not.toContain("Color known");
  });

  it("the E-ink level-number slider exists only with E-ink mode on AND HSK colours", () => {
    const has = (settings: Record<string, unknown>) => {
      document.body.innerHTML = "";
      const { container } = mount(settings);
      trigger(container).click();
      return (menu()!.textContent ?? "").includes("Level-number size");
    };
    expect(has({ einkMode: true, colorMode: "hsk" })).toBe(true);
    expect(has({ einkMode: true, colorMode: "status" })).toBe(false);
    expect(has({ einkMode: false, colorMode: "hsk" })).toBe(false);
  });
});

describe("ViewToolbar format picker under a DOM (#119)", () => {
  const formatsBtn = (c: HTMLElement) => Array.from(c.querySelectorAll("button")).find((b) => b.textContent === "Formats ▾")!;
  const labels = () => Array.from(menu()?.querySelectorAll(".cci-overflow-item span:not(.cci-format-swatch)") ?? []).map((s) => s.textContent);

  it("the Formats menu has the same open / outside-click / reopen cycle", () => {
    const { container } = mount({}, "format");
    formatsBtn(container).click();
    expect(menu()).toBeTruthy();
    vi.runOnlyPendingTimers();
    document.body.click();
    expect(menu()).toBeNull();
    formatsBtn(container).click();
    expect(menu(), "a menu closed by an outside click must reopen on the next tap").toBeTruthy();
  });

  it("offers coloured highlights normally and only the plain highlight in E-ink mode (the call-site wiring, #112)", () => {
    const normal = mount({ einkMode: false, showHighlightColorsWithoutPlugin: true }, "format");
    formatsBtn(normal.container).click();
    expect(labels().some((l) => l?.startsWith("Highlight: "))).toBe(true);
    document.body.innerHTML = "";

    const eink = mount({ einkMode: true, showHighlightColorsWithoutPlugin: true }, "format");
    formatsBtn(eink.container).click();
    expect(labels().some((l) => l?.startsWith("Highlight: "))).toBe(false);
    expect(labels()).toContain("Highlight");
  });

  it("ticking a format arms it and saves", async () => {
    const { container, plugin } = mount({ enabledFormats: [] }, "format");
    formatsBtn(container).click();
    const bold = Array.from(menu()!.querySelectorAll<HTMLElement>(".cci-overflow-item")).find((r) => r.textContent === "Bold")!;
    bold.click();
    await vi.runAllTimersAsync();
    expect(plugin.settings.enabledFormats).toEqual(["bold"]);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});
