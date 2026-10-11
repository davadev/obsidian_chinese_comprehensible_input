// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { WordPopup } from "../ui/WordPopup";
import { makeKey } from "../dictionary/normalizeChinese";

/**
 * The card that opens when a word is tapped: what it shows (headword as tapped, pinyin, the other script when it is
 * unambiguous, definitions, grammar, mnemonic, counts), the marking controls that write to the vocabulary, and the
 * dictionary actions (ignore, edit, enhance with AI, revert). Where it goes on the screen and when it closes matter
 * on a phone, so those are checked too.
 */

installObsidianDom();

const modals = vi.hoisted(() => ({ mnemonic: [] as any[], edit: [] as any[] }));
vi.mock("../ui/MnemonicModal", () => ({
  MnemonicModal: class {
    constructor(...args: unknown[]) {
      modals.mnemonic.push(args);
    }
    open() {
      modals.mnemonic.at(-1)!.push("opened");
    }
  },
}));
vi.mock("../ui/EditDictionaryModal", () => ({
  EditDictionaryModal: class {
    constructor(...args: unknown[]) {
      modals.edit.push(args);
    }
    open() {
      modals.edit.at(-1)!.push("opened");
    }
  },
}));

const ENTRY = { simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["to study", "to learn"], hsk: { source: "2.0", levels: ["2"] } };
const today = () => new Date().toISOString().slice(0, 10);
const rec = (over: Record<string, unknown> = {}): any => ({
  key: "学习|xue2xi2",
  surfaces: ["学习"],
  simplified: "学习",
  traditional: "學習",
  pinyin: "xué xí",
  definitions: ["to study"],
  hsk: { source: "2.0", levels: ["2"] },
  status: "unknown",
  seenCount: 4,
  recentSeenAt: [],
  dailySeenCounts: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

interface Setup {
  rec?: any;
  settings?: (s: any) => void;
  entries?: any[];
  raw?: any[];
  overrides?: Record<string, any>;
  custom?: Record<string, any>;
  stored?: any;
}
function make(o: Setup = {}) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.exposure.popupCountsAsExposure = false;
  settings.mnemonicsFirst = false;
  settings.scriptVariant = "auto";
  o.settings?.(settings);
  const record = o.rec ?? rec();
  const entries = o.entries ?? [ENTRY];
  const raw = o.raw ?? entries;
  const plugin: any = {
    settings,
    app: { name: "app" },
    vocab: {
      ensure: vi.fn(() => record),
      bySurface: vi.fn(() => (o.stored === undefined ? record : o.stored)),
      setAxes: vi.fn(),
    },
    exposure: { commit: vi.fn() },
    srs: { applyPopupSignal: vi.fn() },
    currentNoteKey: vi.fn(() => "note.md"),
    dictionary: {
      lookup: vi.fn((s: string) => (s === "学习" || s === "學習" ? entries : [])),
      lookupRaw: vi.fn((s: string) => (s === "学习" || s === "學習" ? raw : [])),
      distinctTraditionalForms: () => 1,
    },
    dictionaryOverrides: o.overrides ?? {},
    dictionaryCustomWords: o.custom ?? {},
    markWordIgnored: vi.fn(),
    refreshChineseViews: vi.fn(),
    setDictionaryOverride: vi.fn(async () => {}),
    deleteDictionaryOverride: vi.fn(async () => {}),
    enhance: { enhance: vi.fn(async () => ({ definitions: ["new def"], grammar: "verb", pinyin: "xué xi" })) },
  };
  const popup = new WordPopup(plugin);
  const anchor = document.createElement("span");
  document.body.appendChild(anchor);
  return { popup, plugin, anchor, record, settings };
}
const el = () => document.body.querySelector<HTMLElement>(".cci-popup");
const text = (sel: string) => el()!.querySelector(sel)?.textContent;
const btn = (label: string) => Array.from(el()!.querySelectorAll("button")).find((b) => b.textContent === label)!;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  Notice.instances.length = 0;
  modals.mnemonic.length = 0;
  modals.edit.length = 0;
  Platform.isMobile = false;
});
afterEach(() => {
  document.body.innerHTML = "";
  Platform.isMobile = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("opening", () => {
  it("shows the word as tapped, its pinyin, definitions and counts", () => {
    const { popup, anchor } = make({ rec: rec({ seenCount: 7, lastSeenAt: "2026-05-04T10:00:00.000Z", srs: { dueAt: "2026-06-01T00:00:00.000Z" } }) });
    popup.open("学习", anchor, new Event("click"));
    expect(text(".cci-popup-head")).toBe("学习");
    expect(text(".cci-popup-pinyin")).toBe("xué xí");
    expect(Array.from(el()!.querySelectorAll(".cci-popup-defs > div")).map((d) => d.textContent)).toEqual(["• to study", "• to learn"]);
    const meta = Array.from(el()!.querySelectorAll(".cci-popup-meta")).at(-1)!.textContent!;
    expect(meta).toContain("HSK:2");
    expect(meta).toContain("Seen:7");
    expect(meta).toContain("Last:2026-05-04");
    expect(meta).toContain("Status:unknown");
    expect(meta).toContain("Due:2026-06-01");
  });

  it("shows the headword exactly as tapped, even when that is the other script", () => {
    const { popup, anchor } = make();
    popup.open("學習", anchor, new Event("click"));
    expect(text(".cci-popup-head")).toBe("學習");
  });

  it("falls back to the record's own entry when the tapped form has none, and to its stored definitions without an entry", () => {
    const a = make({ rec: rec({ surfaces: ["学习"] }) });
    a.plugin.dictionary.lookup = vi.fn((s: string) => (s === "学习" ? [ENTRY] : []));
    a.popup.open("學", a.anchor, new Event("click"));
    expect(text(".cci-popup-pinyin")).toBe("xué xí");
    document.body.innerHTML = "";
    const b = make({ entries: [], rec: rec({ definitions: ["stored one"], pinyin: undefined }) });
    b.popup.open("学习", b.anchor, new Event("click"));
    expect(text(".cci-popup-defs")).toContain("• stored one");
    expect(el()!.querySelector(".cci-popup-pinyin")).toBeNull();
  });

  it("a word with no definitions anywhere shows an empty list, and no HSK or last-seen when it has none", () => {
    const { popup, anchor } = make({ entries: [], rec: rec({ definitions: undefined, hsk: undefined, lastSeenAt: undefined }) });
    popup.open("学习", anchor, new Event("click"));
    expect(el()!.querySelector(".cci-popup-defs")!.children).toHaveLength(0);
    const meta = Array.from(el()!.querySelectorAll(".cci-popup-meta")).at(-1)!.textContent!;
    expect(meta).not.toContain("HSK:");
    expect(meta).toContain("Last:—");
    expect(meta).toContain("Due:—");
  });

  it("shows the other script's form when it is unambiguous, and the grammar note", () => {
    const { popup, anchor } = make({ entries: [{ ...ENTRY, grammar: "Verb + object" }], settings: (s) => (s.scriptVariant = "simplified") });
    popup.open("学习", anchor, new Event("click"));
    expect(el()!.textContent).toContain("Traditional:");
    expect(el()!.textContent).toContain("學習");
    expect(text(".cci-popup-grammar")).toBe("Grammar: Verb + object");
  });

  it("closes the card that was already open, and drops focus first", () => {
    const { popup, anchor } = make();
    popup.open("学习", anchor, new Event("click"));
    popup.open("学习", anchor, new Event("click"), "  我学习。  ");
    expect(document.body.querySelectorAll(".cci-popup")).toHaveLength(1);
  });

  it("counts the tap as an exposure only when that setting is on, and always reports the popup to the SRS", () => {
    const off = make();
    off.popup.open("学习", off.anchor, new Event("click"));
    expect(off.plugin.exposure.commit).not.toHaveBeenCalled();
    expect(off.plugin.srs.applyPopupSignal).toHaveBeenCalledWith("学习");
    document.body.innerHTML = "";
    const on = make({ settings: (s) => (s.exposure.popupCountsAsExposure = true) });
    on.popup.open("学习", on.anchor, new Event("click"));
    expect(on.plugin.exposure.commit).toHaveBeenCalledWith("学习", "note.md");
  });
});

describe("where it goes, and when it closes", () => {
  it("on a phone it is a bottom sheet and is not positioned", () => {
    Platform.isMobile = true;
    const { popup, anchor } = make();
    popup.open("学习", anchor, new Event("click"));
    expect(el()!.classList.contains("cci-bottom-sheet")).toBe(true);
    expect(el()!.style.top).toBe("");
  });

  it("on desktop it sits just below the word, kept inside the window", () => {
    const { popup, anchor } = make();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 300, bottom: 100 } as DOMRect);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    popup.open("学习", anchor, new Event("click"));
    expect([el()!.style.top, el()!.style.left]).toEqual(["106px", "300px"]);
    popup.close();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 900, bottom: 790 } as DOMRect);
    popup.open("学习", anchor, new Event("click"));
    expect([el()!.style.top, el()!.style.left]).toEqual(["588px", "672px"]);
    popup.close();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: -50, bottom: 10 } as DOMRect);
    popup.open("学习", anchor, new Event("click"));
    expect(el()!.style.left).toBe("8px");
  });

  it("a click outside closes it, a click inside does not, and the listener only arms after the opening tap", () => {
    vi.useFakeTimers();
    const { popup, anchor } = make();
    popup.open("学习", anchor, new Event("click"));
    document.body.click();
    expect(el()).toBeTruthy(); // the opening tap itself
    vi.runOnlyPendingTimers();
    el()!.click();
    expect(el()).toBeTruthy();
    document.body.click();
    expect(el()).toBeNull();
  });

  it("a click that is not on an element (the window itself) also closes it", () => {
    vi.useFakeTimers();
    const { popup, anchor } = make();
    popup.open("学习", anchor, new Event("click"));
    vi.runOnlyPendingTimers();
    document.dispatchEvent(new Event("click"));
    expect(el()).toBeNull();
  });

  it("closing before the opening timer fires arms nothing; closing twice is harmless", () => {
    vi.useFakeTimers();
    const { popup, anchor } = make();
    const add = vi.spyOn(document, "addEventListener");
    popup.open("学习", anchor, new Event("click"));
    popup.close();
    vi.runOnlyPendingTimers();
    expect(add.mock.calls.filter((c) => c[0] === "click")).toHaveLength(0);
    expect(() => popup.close()).not.toThrow();
  });

  it("the outside-click handler does nothing once the card is gone", () => {
    vi.useFakeTimers();
    const { popup, anchor } = make();
    popup.open("学习", anchor, new Event("click"));
    vi.runOnlyPendingTimers();
    const handler = (popup as any).outsideHandler as (e: MouseEvent) => void;
    (popup as any).el = null;
    expect(() => handler(new MouseEvent("click"))).not.toThrow();
  });
});

describe("the mnemonic on the card", () => {
  const withMnemonic = (mnemonic: any, first = false) => {
    const m = make({ rec: rec({ mnemonic }), settings: (s) => (s.mnemonicsFirst = first) });
    m.popup.open("学习", m.anchor, new Event("click"));
    return m;
  };

  it("shows nothing for a word without one", () => {
    withMnemonic(undefined);
    expect(el()!.querySelector(".cci-popup-mnemonic")).toBeNull();
    expect(withMnemonic({ text: "  ", story: " " }) && el()!.querySelector(".cci-popup-mnemonic")).toBeNull();
  });

  it("a line only: shown with no expander", () => {
    withMnemonic({ text: "📖🧠" });
    expect(text(".cci-popup-mnemonic-line")).toBe("🧠 📖🧠");
    expect(el()!.querySelector(".cci-popup-mnemonic-toggle")).toBeNull();
  });

  it("a story only previews the story, without an expander when it already is the whole story", () => {
    withMnemonic({ story: "short story" });
    expect(text(".cci-popup-mnemonic-line")).toBe("🧠 short story");
    expect(el()!.querySelector(".cci-popup-mnemonic-toggle")).toBeNull();
  });

  it("a long story-only mnemonic is clamped in the preview and expandable", () => {
    const long = "故".repeat(80);
    withMnemonic({ story: long });
    expect(text(".cci-popup-mnemonic-line")!.length).toBeLessThan(long.length);
    expect(el()!.querySelector(".cci-popup-mnemonic-toggle")).toBeTruthy();
  });

  it("a line and a story: the arrow shows and hides the story, and does not close the card", () => {
    withMnemonic({ text: "📖", story: "The longer story." });
    const toggle = el()!.querySelector<HTMLElement>(".cci-popup-mnemonic-toggle")!;
    const story = el()!.querySelector<HTMLElement>(".cci-popup-mnemonic-story")!;
    expect(story.isShown()).toBe(false);
    toggle.click();
    expect(story.isShown()).toBe(true);
    expect(toggle.textContent).toBe("▴");
    toggle.click();
    expect(story.isShown()).toBe(false);
    expect(toggle.textContent).toBe("▾");
    expect(el()).toBeTruthy();
  });

  it("goes above or below the definitions as set", () => {
    const order = (first: boolean) => {
      withMnemonic({ text: "📖" }, first);
      const kids = Array.from(el()!.querySelector(".cci-popup-defs")!.children).map((c) => c.className || c.textContent);
      document.body.innerHTML = "";
      return kids.findIndex((k) => String(k).includes("cci-popup-mnemonic"));
    };
    expect(order(true)).toBe(0);
    expect(order(false)).toBeGreaterThan(0);
  });
});

describe("marking by knowledge", () => {
  it("shows what is known and, on a change, writes the three flags back and redraws", () => {
    const { popup, anchor, plugin, record } = make({ rec: rec({ status: "meaningKnownPinyinUnknown", axes: { chars: true, pinyin: false, meaning: true } }) });
    popup.open("学习", anchor, new Event("click"));
    const boxes = () => Array.from(el()!.querySelectorAll<HTMLInputElement>(".cci-popup-axis input"));
    expect(boxes().map((b) => b.checked)).toEqual([true, false, true]);
    boxes()[1].checked = true;
    boxes()[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(plugin.vocab.setAxes).toHaveBeenCalledWith("学习", { chars: true, pinyin: true, meaning: true });
    expect(plugin.refreshChineseViews).toHaveBeenCalled();
    void record;
  });

  it("derives the boxes from the status when the record has no axes, and starts blank for a status that has none", () => {
    const known = make({ rec: rec({ status: "known", axes: undefined }) });
    known.popup.open("学习", known.anchor, new Event("click"));
    expect(Array.from(el()!.querySelectorAll<HTMLInputElement>(".cci-popup-axis input")).map((b) => b.checked)).toEqual([true, true, true]);
    document.body.innerHTML = "";
    const ignored = make({ rec: rec({ status: "ignored", axes: undefined }) });
    ignored.popup.open("学习", ignored.anchor, new Event("click"));
    expect(Array.from(el()!.querySelectorAll<HTMLInputElement>(".cci-popup-axis input")).map((b) => b.checked)).toEqual([false, false, false]);
  });

  it("builds on the stored record, or the shown one when the store lost it, and redraws from the stored one", () => {
    const m = make({ stored: undefined, rec: rec({ axes: { chars: false, pinyin: false, meaning: false } }) });
    m.popup.open("学习", m.anchor, new Event("click"));
    m.plugin.vocab.bySurface.mockReturnValueOnce(undefined);
    const box = el()!.querySelector<HTMLInputElement>(".cci-popup-axis input")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(m.plugin.vocab.setAxes).toHaveBeenCalledWith("学习", { chars: true, pinyin: false, meaning: false });
  });

  it("does not redraw when the word is gone from the store", () => {
    const m = make({ rec: rec({ axes: { chars: false, pinyin: false, meaning: false } }) });
    m.popup.open("学习", m.anchor, new Event("click"));
    m.plugin.vocab.bySurface.mockReturnValue(undefined);
    const first = el()!.querySelector(".cci-popup-axis input");
    first!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el()!.querySelector(".cci-popup-axis input")).toBe(first); // not re-rendered
  });
});

describe("the 14-day bars", () => {
  it("one bar per day, scaled to the busiest day", () => {
    const { popup, anchor } = make({ rec: rec({ dailySeenCounts: { [today()]: 4, [new Date(Date.now() - 86400000).toISOString().slice(0, 10)]: 2 } }) });
    popup.open("学习", anchor, new Event("click"));
    const bars = Array.from(el()!.querySelectorAll("svg.cci-sparkline rect"));
    expect(bars).toHaveLength(14);
    const heights = bars.map((b) => Number(b.getAttribute("height")));
    expect(heights.at(-1)).toBe(28);
    expect(heights.at(-2)).toBe(14);
    expect(heights.slice(0, 12).every((h) => h === 0)).toBe(true);
  });

  it("a word never seen draws flat bars rather than dividing by zero", () => {
    const { popup, anchor } = make();
    popup.open("学习", anchor, new Event("click"));
    expect(Array.from(el()!.querySelectorAll("svg rect")).every((b) => b.getAttribute("height") === "0")).toBe(true);
  });
});

describe("actions", () => {
  it("Ignore marks the word ignored and redraws", () => {
    const { popup, anchor, plugin } = make();
    popup.open("学习", anchor, new Event("click"));
    btn("Ignore").click();
    expect(plugin.markWordIgnored).toHaveBeenCalledWith("学习");
    expect(plugin.vocab.bySurface).toHaveBeenCalledWith("学习");
  });

  it("Mnemonic opens the editor with the sentence, then closes the card (it would sit above the modal)", async () => {
    const { popup, anchor, plugin, record } = make();
    popup.open("学习", anchor, new Event("click"), "我学习。");
    btn("Mnemonic").click();
    await vi.waitFor(() => expect(modals.mnemonic).toHaveLength(1));
    expect(modals.mnemonic[0].slice(0, 4)).toEqual([plugin.app, plugin, record, "我学习。"]);
    expect(modals.mnemonic[0].at(-1)).toBe("opened");
    await flush();
    expect(el()).toBeNull();
  });

  describe("Edit", () => {
    const edit = async (o: Setup) => {
      const m = make(o);
      m.popup.open("学习", m.anchor, new Event("click"));
      btn("Edit").click();
      await vi.waitFor(() => expect(modals.edit).toHaveLength(1));
      await flush();
      return { ...m, props: modals.edit[0][2] };
    };

    it("a native word opens the override editor on the raw entry, with the merged values", async () => {
      const merged = { ...ENTRY, pinyin: "edited", pinyinTaiwan: "tw", definitions: ["mine"] };
      const raw = { ...ENTRY };
      const { props } = await edit({ entries: [merged], raw: [raw] });
      expect(props).toMatchObject({ mode: "override", surface: "学习", originalEntry: raw, initial: { traditional: "學習", pinyin: "edited", pinyinTaiwan: "tw", definitions: ["mine"], hskLevel: "2" } });
      expect(el()).toBeNull();
    });

    it("an entry without HSK has no level, and with no raw entry the merged one is the original", async () => {
      const bare = { simplified: "学习", traditional: "學習", pinyin: "p", definitions: ["d"] };
      const { props } = await edit({ entries: [bare], raw: [] });
      expect(props.originalEntry).toBe(bare);
      expect(props.initial.hskLevel).toBeUndefined();
    });

    it("a custom word opens the custom editor as an existing word", async () => {
      const custom = { 学习: { traditional: "學習", pinyin: "xx", definitions: ["c"], hsk: { source: "user", levels: ["4"] } } };
      const { props } = await edit({ custom });
      expect(props).toMatchObject({ mode: "custom", surface: "学习", isExistingCustom: true, initial: { traditional: "學習", pinyin: "xx", definitions: ["c"], hskLevel: "4" } });
    });

    it("a custom word with no HSK level has none in the form", async () => {
      const { props } = await edit({ custom: { 学习: { pinyin: "xx", definitions: [] } } });
      expect(props.initial.hskLevel).toBeUndefined();
    });

    it("a word the dictionary does not know opens a blank custom entry with the record's pinyin", async () => {
      const { props } = await edit({ entries: [], raw: [], rec: rec({ pinyin: "stored py" }) });
      expect(props).toMatchObject({ mode: "custom", surface: "学习", initial: { pinyin: "stored py" } });
      expect(props.isExistingCustom).toBeUndefined();
    });
  });
});

describe("Enhance and Revert", () => {
  const open = (o: Setup = {}, sentence: string | undefined = "我学习。") => {
    const m = make({ settings: (s) => (s.ai.enabled = true), ...o });
    m.popup.open("学习", m.anchor, new Event("click"), sentence);
    return m;
  };
  const has = (label: string) => Array.from(el()!.querySelectorAll("button")).some((b) => b.textContent === label);

  it("Enhance needs AI on, a sentence from the tap, and a native entry", () => {
    open();
    expect(has("Enhance")).toBe(true);
    document.body.innerHTML = "";
    open({ settings: (s) => (s.ai.enabled = false) });
    expect(has("Enhance")).toBe(false);
    document.body.innerHTML = "";
    open({}, "   ");
    expect(has("Enhance")).toBe(false);
    document.body.innerHTML = "";
    const m = make({ settings: (st) => (st.ai.enabled = true) });
    m.popup.open("学习", m.anchor, new Event("click")); // no sentence given at all
    expect(has("Enhance")).toBe(false);
    document.body.innerHTML = "";
    open({ entries: [], raw: [] });
    expect(has("Enhance")).toBe(false);
  });

  it("sends the entry and sentence, keeps what an earlier override held, saves the AI's wording and redraws", async () => {
    const key = makeKey("学习", "xué xí");
    const m = open({ overrides: { [key]: { traditional: "T", pinyin: "old", hsk: { source: "user", levels: ["1"] } } } });
    btn("Enhance").click();
    await vi.waitFor(() => expect(m.plugin.setDictionaryOverride).toHaveBeenCalled());
    expect(m.plugin.enhance.enhance).toHaveBeenCalledWith({ surface: "学习", pinyin: "xué xí", traditional: "學習", currentDefinitions: ["to study", "to learn"], sentence: "我学习。" });
    const [k, ov] = m.plugin.setDictionaryOverride.mock.calls[0];
    expect(k).toBe(key);
    expect(ov).toMatchObject({ traditional: "T", hsk: { source: "user", levels: ["1"] }, pinyin: "old", definitions: ["new def"], grammar: "verb", source: "ai" });
    expect(typeof ov.updatedAt).toBe("string");
    expect(Notice.instances.at(-1)!.message).toBe("Dictionary entry enhanced.");
  });

  it("takes the AI's pinyin only when that is allowed and it gave one", async () => {
    const run = async (allow: boolean, result: any) => {
      const m = open({ settings: (s) => ((s.ai.enabled = true), (s.ai.enhanceCanRewritePinyin = allow)), overrides: {} });
      m.plugin.enhance.enhance.mockResolvedValue(result);
      btn("Enhance").click();
      await vi.waitFor(() => expect(m.plugin.setDictionaryOverride).toHaveBeenCalled());
      const pinyin = m.plugin.setDictionaryOverride.mock.calls[0][1].pinyin;
      document.body.innerHTML = "";
      return pinyin;
    };
    expect(await run(true, { definitions: ["d"], pinyin: "new py" })).toBe("new py");
    expect(await run(true, { definitions: ["d"] })).toBeUndefined();
    expect(await run(false, { definitions: ["d"], pinyin: "ignored" })).toBeUndefined();
  });

  it("copes with entries that lack optional fields", async () => {
    const bare = { simplified: "学习", pinyin: "xué xí" };
    const m = open({ entries: [bare], raw: [bare] });
    btn("Enhance").click();
    await vi.waitFor(() => expect(m.plugin.enhance.enhance).toHaveBeenCalled());
    expect(m.plugin.enhance.enhance.mock.calls[0][0]).toMatchObject({ currentDefinitions: [], traditional: undefined });
  });

  it("prefers the merged entry's values and falls back to the raw entry", async () => {
    const raw = { ...ENTRY, pinyin: "raw py" };
    const merged = { simplified: "学习", definitions: undefined, traditional: undefined, pinyin: undefined };
    const m = open({ entries: [merged], raw: [raw] });
    btn("Enhance").click();
    await vi.waitFor(() => expect(m.plugin.enhance.enhance).toHaveBeenCalled());
    expect(m.plugin.enhance.enhance.mock.calls[0][0]).toMatchObject({ pinyin: "raw py", traditional: "學習", currentDefinitions: ["to study", "to learn"] });
  });

  it("uses the raw entry when the merged lookup comes back empty", async () => {
    const m = open();
    m.plugin.dictionary.lookup = vi.fn(() => []);
    (m.popup as any).renderInto(el()!, m.record);
    btn("Enhance").click();
    await vi.waitFor(() => expect(m.plugin.enhance.enhance).toHaveBeenCalled());
  });

  it("shows progress while enhancing; a failure says why and gives the button back", async () => {
    const m = open();
    m.plugin.enhance.enhance.mockRejectedValue(new Error("rate limited"));
    const b = btn("Enhance") as HTMLButtonElement;
    b.click();
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe("Enhancing…");
    await vi.waitFor(() => expect(Notice.instances.at(-1)?.message).toBe("Enhance failed: rate limited"));
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe("Enhance");
    expect(m.plugin.setDictionaryOverride).not.toHaveBeenCalled();
  });

  it("Revert is offered only when the entry has an override, and removes it", async () => {
    const key = makeKey("学习", "xué xí");
    const m = open({ overrides: { [key]: { definitions: ["x"] } } });
    expect(has("Revert")).toBe(true);
    btn("Revert").click();
    await vi.waitFor(() => expect(m.plugin.deleteDictionaryOverride).toHaveBeenCalledWith(key));
    expect(Notice.instances.at(-1)!.message).toBe("Reverted to original dictionary entry.");
    document.body.innerHTML = "";
    open();
    expect(has("Revert")).toBe(false);
    document.body.innerHTML = "";
    open({ entries: [], raw: [], overrides: { x: {} } });
    expect(has("Revert")).toBe(false);
  });
});

describe("redrawing", () => {
  it("does nothing when no card is open", () => {
    const { popup, plugin } = make();
    (popup as any).refresh();
    expect(plugin.vocab.bySurface).not.toHaveBeenCalled();
  });
});
