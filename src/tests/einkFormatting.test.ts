import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";
import {
  effectiveFormats,
  einkPickerNotice,
  pickerFormatOptions,
  toggleFormat,
} from "../editor/formatOptions";
import {
  applyChangesToString,
  buildFormatChanges,
  buildRemoveFormatChanges,
  buildUnformatChanges,
  conflictDisabled,
} from "../editor/formatApply";
import { highlightColorForId, highlightWrap, resolveHighlightPalette } from "../editor/highlightPalette";

/**
 * E-ink mode overlays the formatting picker (#112) without touching saved settings. These run the
 * whole path a tap takes, from the armed list through to the text written into the note, so the
 * promises that matter are checked end to end rather than helper by helper:
 *  - what the user taps in E-ink never writes a coloured <mark>;
 *  - an armed colour is applied as the plain highlight, never as "clear all formatting";
 *  - turning E-ink off gives back exactly the saved picker.
 */

const NO_PLUGINS = { plugins: undefined } as unknown as App;
const HIGHLIGHTR = {
  plugins: {
    plugins: {
      "highlightr-plugin": { settings: { highlighters: { Pink: "#f8c", Teal: "#0aa" }, highlighterOrder: ["Pink", "Teal"] } },
    },
  },
} as unknown as App;
const S = (over: Partial<CciSettings> = {}): CciSettings => ({ ...DEFAULT_SETTINGS, ...over });

/** What main.ts applyFormatRange does with the armed list, in one place. */
function tap(app: App, s: CciSettings, doc: string, from: number, to: number, reverse = false): string {
  const formats = effectiveFormats(s);
  let wrap;
  const colourId = formats.find((f) => f.startsWith("hl:"));
  if (colourId) {
    const hc = highlightColorForId(colourId, resolveHighlightPalette(app, s));
    if (hc) wrap = highlightWrap(hc, app);
  }
  const changes =
    formats.length === 0
      ? buildUnformatChanges(doc, from, to)
      : reverse
      ? buildRemoveFormatChanges(doc, from, to, formats)
      : buildFormatChanges(doc, from, to, formats, wrap);
  return applyChangesToString(doc, changes);
}

describe("tapping in E-ink mode", () => {
  const doc = "你好世界";

  it("the plain highlight writes ==…==", () => {
    expect(tap(NO_PLUGINS, S({ einkMode: true, enabledFormats: ["highlight"] }), doc, 0, 2)).toBe("==你好==世界");
  });

  it("an armed saved colour is applied as the plain highlight, not as a coloured mark", () => {
    const s = S({ einkMode: true, enabledFormats: ["hl:pink"], showHighlightColorsWithoutPlugin: true });
    expect(tap(NO_PLUGINS, s, doc, 0, 2)).toBe("==你好==世界");
    expect(tap(HIGHLIGHTR, S({ einkMode: true, enabledFormats: ["hl:teal"] }), doc, 0, 2)).toBe("==你好==世界");
  });

  it("the same armed colour DOES write a coloured mark with E-ink off (the overlay is the only difference)", () => {
    const s = S({ einkMode: false, enabledFormats: ["hl:pink"], showHighlightColorsWithoutPlugin: true });
    expect(tap(NO_PLUGINS, s, doc, 0, 2)).toMatch(/^<mark style="background:#FFB8EBA6;">你好<\/mark>世界$/);
  });

  it("an armed colour is never read as 'nothing armed', which would strip the span's formatting", () => {
    const s = S({ einkMode: true, enabledFormats: ["hl:pink"] });
    expect(effectiveFormats(s)).not.toEqual([]);
    expect(tap(NO_PLUGINS, s, "==你好==世界", 2, 4)).toContain("==");
  });

  it("with nothing armed it still clears formatting, as it always did", () => {
    expect(tap(NO_PLUGINS, S({ einkMode: true, enabledFormats: [] }), "==你好==世界", 2, 4)).toBe("你好世界");
  });

  it("reverse mode removes a coloured mark when the plain highlight is the armed removal", () => {
    const marked = '<mark style="background:#f8c;">你好</mark>世界';
    const s = S({ einkMode: true, enabledFormats: ["hl:pink"], formatReverseMode: true });
    expect(tap(HIGHLIGHTR, s, marked, 0, marked.length - 2, true)).toBe("你好世界");
  });

  it("reverse mode removes a plain highlight and keeps other formatting", () => {
    const s = S({ einkMode: true, enabledFormats: ["highlight"], formatReverseMode: true });
    const out = tap(NO_PLUGINS, s, "==**你好**==世界", 0, 10, true);
    expect(out).not.toContain("==");
    expect(out).toContain("**");
  });

  it("other formats armed alongside a colour still apply, with the highlight outermost", () => {
    const s = S({ einkMode: true, enabledFormats: ["bold", "hl:pink"] });
    expect(tap(NO_PLUGINS, s, doc, 0, 2)).toBe("==**你好**==世界");
  });
});

describe("the picker the user sees", () => {
  it("offers no colours and always the plain highlight", () => {
    const s = S({ einkMode: true, showHighlightColorsWithoutPlugin: true, formatHidden: ["highlight"] });
    const ids = pickerFormatOptions(NO_PLUGINS, s).map((o) => o.id);
    expect(ids).toContain("highlight");
    expect(ids.some((i) => i.startsWith("hl:"))).toBe(false);
    expect(pickerFormatOptions(HIGHLIGHTR, S({ einkMode: true })).some((o) => o.color)).toBe(false);
  });

  it("with E-ink off, is exactly the saved picker, colours and hidden entries included", () => {
    const s = S({ einkMode: false, showHighlightColorsWithoutPlugin: true, formatHidden: ["highlight", "quote"] });
    const ids = pickerFormatOptions(NO_PLUGINS, s).map((o) => o.id);
    expect(ids).not.toContain("highlight");
    expect(ids).not.toContain("quote");
    expect(ids).toContain("hl:pink");
  });

  it("keeps the user's own order for the rest", () => {
    const s = S({ einkMode: true, formatOrder: ["quote", "highlight", "bold"], formatHidden: ["italic"] });
    const ids = pickerFormatOptions(NO_PLUGINS, s).map((o) => o.id);
    expect(ids.slice(0, 3)).toEqual(["quote", "highlight", "bold"]);
    expect(ids).not.toContain("italic");
  });

  it("the plain highlight's checkbox is usable even while a hidden colour is armed", () => {
    const s = S({ einkMode: true, enabledFormats: ["hl:pink"] });
    // the menu asks conflictDisabled about the EFFECTIVE list, in which the colour is the plain highlight
    expect(conflictDisabled("highlight", effectiveFormats(s))).toBe(false);
    // asked about the raw list it would have been greyed out by the invisible colour
    expect(conflictDisabled("highlight", s.enabledFormats)).toBe(true);
  });
});

describe("ticking in the menu", () => {
  it("adds without duplicating the effective highlight", () => {
    const s = S({ einkMode: true, enabledFormats: ["bold"] });
    expect(toggleFormat(s, "highlight", true)).toEqual(["bold", "highlight"]);
  });

  it("unticking the plain highlight clears every highlight, so no hidden colour stays armed", () => {
    const s = S({ einkMode: true, enabledFormats: ["bold", "hl:pink", "highlight"] });
    expect(toggleFormat(s, "highlight", false)).toEqual(["bold"]);
  });

  it("unticking anything else removes only that", () => {
    const s = S({ einkMode: true, enabledFormats: ["bold", "hl:pink"] });
    expect(toggleFormat(s, "bold", false)).toEqual(["hl:pink"]);
  });

  it("with E-ink off, unticking a colour removes just that colour", () => {
    const s = S({ einkMode: false, enabledFormats: ["hl:pink", "highlight"] });
    expect(toggleFormat(s, "hl:pink", false)).toEqual(["highlight"]);
  });
});

describe("the notice when E-ink is switched on", () => {
  it("says nothing when the picker already looks the same", () => {
    expect(einkPickerNotice(NO_PLUGINS, S())).toBeNull();
  });
  it("speaks when colours would disappear (opt-in palette or Highlightr)", () => {
    expect(einkPickerNotice(NO_PLUGINS, S({ showHighlightColorsWithoutPlugin: true }))).toMatch(/plain highlight/);
    expect(einkPickerNotice(HIGHLIGHTR, S())).toMatch(/plain highlight/);
  });
  it("speaks when the plain highlight was hidden and will be shown", () => {
    expect(einkPickerNotice(NO_PLUGINS, S({ formatHidden: ["highlight"] }))).toMatch(/E-ink mode off/);
  });
  it("tells the user the way back", () => {
    expect(einkPickerNotice(NO_PLUGINS, S({ formatHidden: ["highlight"] }))).toMatch(/Turn E-ink mode off/);
  });
});
