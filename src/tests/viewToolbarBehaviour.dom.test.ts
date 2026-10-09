// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { ViewToolbar } from "../view/ViewToolbar";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * #119, second half: everything ViewToolbar does that viewToolbar.dom.test.ts does not already pin: each marking
 * mode and its banner, the tri-state highlighter button, the colour-mode pills, the note-stats badge, every row of
 * the overflow menu (each one writes its own setting, saves, and tells the view), the sliders, and the buttons that
 * leave for other screens. The DOM has no layout, so nothing here is about geometry (that is `npm run check:layout`).
 */

installObsidianDom();

type Stats = { total: number; known: number; partial: number; unknown: number; newCount: number; topHsk?: string };

function makePlugin(settings: Record<string, unknown> = {}, startMode = "read", stats: Stats | Error = { total: 0, known: 0, partial: 0, unknown: 0, newCount: 0 }) {
  let mode = startMode;
  const plugin: any = {
    settings: { ...DEFAULT_SETTINGS, showHskColors: { ...DEFAULT_SETTINGS.showHskColors }, ...settings },
    app: {},
    pendingCustomSurface: "",
    pendingFormatStart: null,
    pendingFormatStartSurface: null,
    saveSettings: vi.fn(async () => {}),
    activeViewMode: vi.fn(() => mode),
    setActiveViewMode: vi.fn((m: string) => void (mode = m)),
    offerReindexAfterScriptChange: vi.fn(),
    computeNoteStats: vi.fn(async () => {
      if (stats instanceof Error) throw stats;
      return stats;
    }),
    currentNoteKey: vi.fn(() => "note.md"),
    openStatsForNote: vi.fn(async () => {}),
    openStatsView: vi.fn(async () => {}),
    openGenerateStoryModal: vi.fn(),
  };
  return plugin;
}

function mount(opts: { settings?: Record<string, unknown>; mode?: string; stats?: Stats | Error; docText?: string; commit?: boolean; surface?: string } = {}) {
  const plugin = makePlugin(opts.settings, opts.mode, opts.stats);
  plugin.pendingCustomSurface = opts.surface ?? "";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const onCommit = opts.commit === false ? undefined : vi.fn();
  const toolbar = new ViewToolbar(plugin, container, onChange, () => opts.docText ?? "你好", onCommit);
  return { plugin, container, onChange, onCommit, toolbar };
}

const flush = () => vi.runAllTimersAsync();
const menu = () => document.body.querySelector<HTMLElement>(".cci-overflow-menu");
const openOverflow = (c: HTMLElement) => c.querySelector<HTMLElement>(".cci-overflow-btn-trigger")!.click();
const row = (label: string | RegExp) =>
  Array.from(menu()!.querySelectorAll<HTMLElement>(".cci-overflow-item")).find((r) =>
    typeof label === "string" ? r.textContent === label : label.test(r.textContent ?? "")
  )!;
const box = (r: HTMLElement) => r.querySelector<HTMLInputElement>("input")!;
const btn = (c: ParentNode, text: string) => Array.from(c.querySelectorAll("button")).find((b) => b.textContent === text)!;
const sliderRow = (label: string) =>
  Array.from(menu()!.querySelectorAll<HTMLElement>(".cci-overflow-slider")).find((r) => (r.textContent ?? "").startsWith(label))!;
const slider = (label: string) => sliderRow(label).querySelector<HTMLInputElement>("input[type=range]")!;
function drag(input: HTMLInputElement, value: number) {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  Platform.isMobile = false;
});

describe("marking modes and their banners", () => {
  it.each([
    ["mark-known", "Marking KNOWN", "is-known"],
    ["mark-unknown", "Marking UNKNOWN", "is-unknown"],
    ["mark-partial", "Marking PARTIAL", "is-partial"],
  ])("%s shows its banner, and Exit returns to reading", (mode, text, cls) => {
    const { container, plugin } = mount({ mode });
    const banner = container.querySelector(".cci-banner")!;
    expect(banner.textContent).toContain(text);
    expect(banner.classList.contains(cls)).toBe(true);
    btn(banner, "Exit").click();
    expect(plugin.setActiveViewMode).toHaveBeenCalledWith("read");
  });

  it("the active mode's button is highlighted, and refresh() follows a mode change", () => {
    const { container, plugin, toolbar } = mount();
    const known = container.querySelector<HTMLElement>('[data-mode="mark-known"]')!;
    expect(known.classList.contains("is-active")).toBe(false);
    plugin.setActiveViewMode("mark-known");
    toolbar.refresh();
    expect(known.classList.contains("is-active")).toBe(true);
    expect(container.querySelector('[data-mode="edit"]')!.classList.contains("is-active")).toBe(false);
  });

  it("on mobile there is no Edit button (the header action is the entry point)", () => {
    Platform.isMobile = true;
    const { container } = mount();
    expect(container.querySelector('[data-mode="edit"]')).toBeNull();
    expect(container.querySelector('[data-mode="mark-known"]')).toBeTruthy();
  });

  it("without a commit callback there is no 'custom word' button", () => {
    expect(mount({ commit: false }).container.querySelector('[data-mode="select-word"]')).toBeNull();
    expect(mount().container.querySelector('[data-mode="select-word"]')).toBeTruthy();
  });
});

describe("custom-word selection banner", () => {
  it("prompts when nothing is selected and disables Create entry", () => {
    const { container } = mount({ mode: "select-word" });
    expect(container.querySelector(".is-select-word")!.textContent).toContain("Tap one or more characters");
    expect(btn(container, "Create entry").disabled).toBe(true);
  });

  it("with a selection, Create entry hands the surface to the view and returns to reading", () => {
    const { container, plugin, onCommit } = mount({ mode: "select-word", surface: "苹果" });
    const create = btn(container, "Create entry");
    expect(container.querySelector(".is-select-word")!.textContent).toContain("Selected: 苹果");
    expect(create.disabled).toBe(false);
    create.click();
    expect(onCommit).toHaveBeenCalledWith("苹果");
    expect(plugin.setActiveViewMode).toHaveBeenLastCalledWith("read");
  });

  it("Cancel leaves the mode without committing", () => {
    const { container, plugin, onCommit } = mount({ mode: "select-word" });
    btn(container, "Cancel").click();
    expect(onCommit).not.toHaveBeenCalled();
    expect(plugin.setActiveViewMode).toHaveBeenCalledWith("read");
  });

  it("Create entry does nothing when the selection was cleared after the banner was drawn", () => {
    const { container, plugin, onCommit } = mount({ mode: "select-word", surface: "苹果" });
    plugin.pendingCustomSurface = ""; // cleared between drawing the banner and tapping the button
    btn(container, "Create entry").click();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("the highlighter button cycles off -> add (blue) -> remove (red) -> off", () => {
  const hl = (c: HTMLElement) => c.querySelector<HTMLElement>(".cci-format-btn")!;

  it("steps through the three states", async () => {
    const { container, plugin, toolbar } = mount();
    expect(hl(container).classList.contains("cci-format-add")).toBe(false);

    hl(container).click();
    await flush();
    expect(plugin.settings.formatReverseMode).toBe(false);
    expect(plugin.setActiveViewMode).toHaveBeenLastCalledWith("format");
    toolbar.refresh();
    expect(hl(container).classList.contains("cci-format-add")).toBe(true);
    expect(hl(container).getAttribute("title")).toContain("add");

    hl(container).click();
    await flush();
    expect(plugin.settings.formatReverseMode).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(hl(container).classList.contains("cci-format-remove")).toBe(true);
    expect(hl(container).getAttribute("title")).toContain("remove");

    hl(container).click();
    await flush();
    expect(plugin.setActiveViewMode).toHaveBeenLastCalledWith("read");
  });
});

describe("format banner text", () => {
  const text = (c: HTMLElement) => c.querySelector(".cci-banner.is-format span")!.textContent;

  it("names the armed formats and the verb", () => {
    expect(text(mount({ mode: "format", settings: { enabledFormats: ["bold"] } }).container)).toBe(
      "Formatting (Bold) — tap start word, then end word to add formatting"
    );
  });

  it("says 'clear' when nothing is armed, and 'remove' in reverse mode", () => {
    expect(text(mount({ mode: "format", settings: { enabledFormats: [] } }).container)).toContain("Formatting (clear)");
    expect(text(mount({ mode: "format", settings: { enabledFormats: ["bold"], formatReverseMode: true } }).container)).toContain(
      "remove the selected formatting"
    );
  });

  it("after the first tap confirms which start was registered", () => {
    const m = mount({ mode: "format", settings: { enabledFormats: ["bold"] } });
    m.plugin.pendingFormatStart = 3;
    m.plugin.pendingFormatStartSurface = " 你好 ";
    m.toolbar.refresh();
    expect(text(m.container)).toBe("Start “你好” selected — tap the end word to add formatting");
    m.plugin.pendingFormatStartSurface = null;
    m.toolbar.refresh();
    expect(text(m.container)).toContain("Start selected");
  });

  it("Exit leaves format mode", () => {
    const { container, plugin } = mount({ mode: "format" });
    btn(container, "Exit").click();
    expect(plugin.setActiveViewMode).toHaveBeenCalledWith("read");
  });
});

describe("colour-mode pills", () => {
  const pill = (c: HTMLElement, v: string) => c.querySelector<HTMLElement>(`[data-color-mode="${v}"]`)!;

  it("switching to HSK saves, repaints both pills and tells the view", async () => {
    const { container, plugin, onChange } = mount({ settings: { colorMode: "status" } });
    expect(pill(container, "status").classList.contains("is-active")).toBe(true);
    pill(container, "hsk").click();
    await flush();
    expect(plugin.settings.colorMode).toBe("hsk");
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(pill(container, "hsk").getAttribute("aria-pressed")).toBe("true");
    expect(pill(container, "status").getAttribute("aria-pressed")).toBe("false");
    expect(pill(container, "status").classList.contains("is-active")).toBe(false);
  });

  it("tapping the already-active pill does nothing", async () => {
    const { container, plugin, onChange } = mount({ settings: { colorMode: "status" } });
    pill(container, "status").click();
    await flush();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("note stats badge", () => {
  const badge = (c: HTMLElement) => c.querySelector<HTMLElement>(".cci-note-stats-row")!;

  it("shows percentages, a tooltip and a 'high' state when most words are known", async () => {
    const { container } = mount({ stats: { total: 10, known: 9, partial: 0, unknown: 1, newCount: 0, topHsk: "4" } });
    await flush();
    expect(badge(container).textContent).toBe("Known 90% · Partial 0% · Unknown 10% · New 0% · Top HSK 4");
    expect(badge(container).getAttribute("data-state")).toBe("high");
    expect(badge(container).getAttribute("title")).toContain("90% of 10 words known");
  });

  it.each([
    [{ total: 10, known: 6, partial: 2, unknown: 1, newCount: 1 }, "mid"],
    [{ total: 10, known: 1, partial: 2, unknown: 3, newCount: 4 }, "low"],
  ])("%j -> state %s (and no Top HSK segment)", async (stats, state) => {
    const { container } = mount({ stats });
    await flush();
    expect(badge(container).getAttribute("data-state")).toBe(state);
    expect(badge(container).textContent).not.toContain("Top HSK");
  });

  it("reports an empty note, whether the text is empty or the tokenizer finds no words", async () => {
    const empty = mount({ docText: "" });
    await flush();
    expect(badge(empty.container).textContent).toBe("No Chinese words in this note");
    expect(badge(empty.container).getAttribute("data-state")).toBe("empty");
    expect(empty.plugin.computeNoteStats).not.toHaveBeenCalled();
    document.body.innerHTML = "";

    const none = mount({ stats: { total: 0, known: 0, partial: 0, unknown: 0, newCount: 0 } });
    await flush();
    expect(badge(none.container).getAttribute("data-state")).toBe("empty");
  });

  it("leaves the placeholder when the tokenizer is not ready", async () => {
    const { container } = mount({ stats: new Error("no dictionary") });
    await flush();
    expect(badge(container).textContent).toBe("Loading note stats...");
  });

  it("tapping the badge opens the stats for this note", async () => {
    const { container, plugin } = mount();
    badge(container).click();
    expect(plugin.openStatsForNote).toHaveBeenCalledWith("note.md");
  });
});

describe("overflow menu rows each write their own setting", () => {
  it("status colour rows toggle showKnown / Partial / Unknown / New colour", async () => {
    const { container, plugin, onChange } = mount({
      settings: { colorMode: "status", showKnownColor: false, showPartialColor: true, showUnknownColor: true, showNewColor: false },
    });
    openOverflow(container);
    expect(box(row("Color known")).checked).toBe(false);
    for (const [label, key, now] of [
      ["Color known", "showKnownColor", true],
      ["Color partial", "showPartialColor", false],
      ["Color unknown", "showUnknownColor", false],
      ["Color new (untracked)", "showNewColor", true],
    ] as const) {
      row(label).click();
      await flush();
      expect(plugin.settings[key], key).toBe(now);
    }
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("HSK rows toggle their own level only", async () => {
    const { container, plugin } = mount({ settings: { colorMode: "hsk" } });
    openOverflow(container);
    const before = { ...plugin.settings.showHskColors };
    row("HSK 3").click();
    await flush();
    expect(plugin.settings.showHskColors["3"]).toBe(!before["3"]);
    for (const k of ["1", "2", "4", "5", "6", "7"]) expect(plugin.settings.showHskColors[k], k).toBe(before[k]);
  });

  it("the hint above the colour rows names the mode", () => {
    openOverflow(mount({ settings: { colorMode: "hsk" } }).container);
    expect(menu()!.textContent).toContain("Show / hide HSK levels");
    document.body.innerHTML = "";
    openOverflow(mount({ settings: { colorMode: "status" } }).container);
    expect(menu()!.textContent).toContain("Show / hide status colors");
  });

  it("display-mode radios set defaultDisplayMode, and name the rows' content (#56)", async () => {
    const { container, plugin, onChange } = mount({
      settings: { defaultDisplayMode: "two-line", line2Content: "english", line3Content: "mnemonic" },
    });
    openOverflow(container);
    expect(menu()!.textContent).toContain("2-line (English)");
    expect(menu()!.textContent).toContain("3-line (mnemonic + English)");
    expect(box(row(/^2-line/)).checked).toBe(true);

    row(/^3-line/).click();
    await flush();
    expect(plugin.settings.defaultDisplayMode).toBe("three-line");
    row("None (no inline annotation)").click();
    await flush();
    expect(plugin.settings.defaultDisplayMode).toBe("none");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("known-word popups toggles its flag", async () => {
    const { container, plugin } = mount({ settings: { knownWordPopups: true } });
    openOverflow(container);
    row("Known-word popups").click();
    await flush();
    expect(plugin.settings.knownWordPopups).toBe(false);
  });

  it("changing the script offers a reindex when the indexed set changes, and not for auto -> auto", async () => {
    const { container, plugin } = mount({ settings: { scriptVariant: "simplified" } });
    openOverflow(container);
    row("Traditional characters").click();
    await flush();
    expect(plugin.settings.scriptVariant).toBe("traditional");
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.offerReindexAfterScriptChange).toHaveBeenCalledTimes(1);

    row("Traditional characters").click(); // already active: no second offer
    await flush();
    expect(plugin.offerReindexAfterScriptChange).toHaveBeenCalledTimes(1);
  });
});

describe("overflow menu sliders", () => {
  it.each([
    ["Font size", 30, "readerFontPx", "30px"],
    ["Line spacing", 0.5, "readerLineSpacing", "0.50×"],
    ["Annotation size", 150, "annotationScalePercent", "150%"],
  ])("%s writes %s to %s, relabels, saves and tells the view", async (label, value, key, shown) => {
    const { container, plugin, onChange } = mount();
    openOverflow(container);
    drag(slider(label), value);
    await flush();
    expect(plugin.settings[key]).toBe(value);
    expect(sliderRow(label).querySelector(".cci-slider-value")!.textContent).toBe(shown);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("each slider starts at the saved value, falling back to the default when unset", () => {
    const { container } = mount({ settings: { readerFontPx: 28, readerLineSpacing: undefined, annotationScalePercent: undefined } });
    openOverflow(container);
    expect(slider("Font size").value).toBe("28");
    expect(slider("Line spacing").value).toBe("1");
    expect(slider("Annotation size").value).toBe("100");
  });

  it("the E-ink level-number slider is clamped on the way in and writes einkNumberScalePercent", async () => {
    const { container, plugin, onChange } = mount({ settings: { einkMode: true, colorMode: "hsk", einkNumberScalePercent: 9999 } });
    openOverflow(container);
    const s = slider("Level-number size");
    expect(Number(s.value)).toBeLessThanOrEqual(Number(s.max));
    drag(s, Number(s.min));
    await flush();
    expect(plugin.settings.einkNumberScalePercent).toBe(Number(s.min));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("overflow menu buttons and closing", () => {
  it("Stats closes the menu and opens the stats view", () => {
    const { container, plugin } = mount();
    openOverflow(container);
    btn(menu()!, "Stats").click();
    expect(menu()).toBeNull();
    expect(plugin.openStatsView).toHaveBeenCalled();
  });

  it("Generate story closes the menu and opens the modal", () => {
    const { container, plugin } = mount();
    openOverflow(container);
    btn(menu()!, "Generate story").click();
    expect(menu()).toBeNull();
    expect(plugin.openGenerateStoryModal).toHaveBeenCalled();
  });

  it("a resize closes the menu (its position is a snapshot), and the next tap reopens it", () => {
    const { container } = mount();
    openOverflow(container);
    window.dispatchEvent(new Event("resize"));
    expect(menu()).toBeNull();
    openOverflow(container);
    expect(menu()).toBeTruthy();
  });

  it("a click inside the menu does not close it", () => {
    const { container } = mount();
    openOverflow(container);
    vi.runOnlyPendingTimers();
    menu()!.querySelector<HTMLElement>(".cci-overflow-hint")!.click();
    expect(menu()).toBeTruthy();
  });

  it("closing before the deferred listener registers leaves no orphaned document listener", () => {
    const { container } = mount();
    const add = vi.spyOn(document, "addEventListener");
    openOverflow(container);
    window.dispatchEvent(new Event("resize")); // closes before the 0ms timer
    vi.runOnlyPendingTimers();
    expect(add.mock.calls.filter(([type]) => type === "click")).toHaveLength(0);
  });
});
