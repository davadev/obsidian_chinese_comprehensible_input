import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import {
  BASE_FORMAT_IDS,
  availableFormatOptions,
  orderedFormatOptions,
} from "../editor/formatOptions";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";

/**
 * `formatOptions` had no test at all, which is why these start from the base
 * list and work outward: the option list feeds both the toolbar dropdown and
 * the settings reorder list, so a wrong order or a dropped entry is visible to
 * the user in two places at once.
 *
 * Same minimal App stub as highlightPalette.test.ts:16-18 —
 * `resolveHighlightPalette` reads `app.plugins` defensively and returns no
 * colors when it is absent.
 */
function appWith(plugins?: Record<string, { settings?: unknown }>): App {
  return { plugins: plugins ? { plugins } : undefined } as unknown as App;
}

const NO_PLUGINS = appWith();

function settings(over: Partial<CciSettings> = {}): CciSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

describe("availableFormatOptions", () => {
  it("returns the nine base formats when no palette is available", () => {
    const out = availableFormatOptions(NO_PLUGINS, settings());
    expect(out).toHaveLength(9);
    expect(out.map((o) => o.id)).toEqual([...BASE_FORMAT_IDS]);
  });

  it("labels the base formats from FORMAT_LABELS and gives them no colour", () => {
    const out = availableFormatOptions(NO_PLUGINS, settings());
    expect(out[0]).toEqual({ id: "bold", label: "Bold" });
    expect(out.find((o) => o.id === "strike")?.label).toBe("Strikethrough");
    expect(out.every((o) => o.color === undefined)).toBe(true);
  });

  it("appends the default palette when the opt-in is on without Highlightr", () => {
    const out = availableFormatOptions(
      NO_PLUGINS,
      settings({ showHighlightColorsWithoutPlugin: true })
    );
    expect(out).toHaveLength(9 + 8);
    // Base formats keep their leading position; colours follow.
    expect(out.slice(0, 9).map((o) => o.id)).toEqual([...BASE_FORMAT_IDS]);
    expect(out[9]).toEqual({ id: "hl:pink", label: "Highlight: Pink", color: "#FFB8EBA6" });
    expect(out.at(-1)?.id).toBe("hl:purple");
  });

  it("prefers Highlightr's colours and order over the defaults", () => {
    const app = appWith({
      "highlightr-plugin": {
        settings: {
          highlighters: { Teal: "#0FF", "Hot Pink": "#F0F" },
          highlighterOrder: ["Hot Pink", "Teal"],
        },
      },
    });
    const out = availableFormatOptions(app, settings());
    expect(out.slice(9)).toEqual([
      { id: "hl:hot-pink", label: "Highlight: Hot Pink", color: "#F0F" },
      { id: "hl:teal", label: "Highlight: Teal", color: "#0FF" },
    ]);
  });
});

describe("orderedFormatOptions", () => {
  it("returns options in the persisted order", () => {
    const out = orderedFormatOptions(
      NO_PLUGINS,
      settings({ formatOrder: ["quote", "bold", "h1"] }),
      true
    );
    // The three named ids lead; the rest follow in availability order.
    expect(out.slice(0, 3).map((o) => o.id)).toEqual(["quote", "bold", "h1"]);
    expect(out).toHaveLength(9);
  });

  it("ignores a persisted id that is no longer available", () => {
    // `hl:pink` is persisted but the palette is off, so it must not appear —
    // this is the stale-id path that survives a Highlightr uninstall.
    const out = orderedFormatOptions(
      NO_PLUGINS,
      settings({ formatOrder: ["hl:pink", "bold"] }),
      true
    );
    expect(out.map((o) => o.id)).not.toContain("hl:pink");
    expect(out[0].id).toBe("bold");
    expect(out).toHaveLength(9);
  });

  it("appends newly available options missing from formatOrder", () => {
    const out = orderedFormatOptions(
      NO_PLUGINS,
      settings({
        formatOrder: ["bold"],
        showHighlightColorsWithoutPlugin: true,
      }),
      true
    );
    expect(out[0].id).toBe("bold");
    expect(out).toHaveLength(17);
    // Everything not named in formatOrder is appended, colours included.
    expect(out.map((o) => o.id)).toContain("hl:purple");
    expect(new Set(out.map((o) => o.id)).size).toBe(17);
  });

  it("filters hidden ids only when includeHidden is false", () => {
    const s = settings({ formatHidden: ["h1", "h2", "h3"] });
    expect(orderedFormatOptions(NO_PLUGINS, s, true)).toHaveLength(9);
    const visible = orderedFormatOptions(NO_PLUGINS, s, false);
    expect(visible).toHaveLength(6);
    expect(visible.map((o) => o.id)).not.toContain("h1");
  });

  it("can hide a highlight colour as well as a base format", () => {
    const s = settings({
      showHighlightColorsWithoutPlugin: true,
      formatHidden: ["hl:pink"],
    });
    const visible = orderedFormatOptions(NO_PLUGINS, s, false);
    expect(visible).toHaveLength(16);
    expect(visible.map((o) => o.id)).not.toContain("hl:pink");
    expect(visible.map((o) => o.id)).toContain("hl:red");
  });
});
