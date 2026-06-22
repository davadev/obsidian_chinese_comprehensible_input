import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import {
  DEFAULT_HIGHLIGHT_PALETTE,
  findHighlightSpans,
  highlightColorForId,
  highlightWrap,
  parseMarkColor,
  resolveHighlightPalette,
  slugify,
  type HighlightColor,
} from "../editor/highlightPalette";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/** Minimal App stub with a configurable plugins registry. */
function appWith(plugins?: Record<string, { settings?: unknown }>): App {
  return { plugins: plugins ? { plugins } : undefined } as unknown as App;
}

const PINK: HighlightColor = { slug: "pink", label: "Pink", color: "#FFB8EBA6", source: "default" };

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Bright Pink")).toBe("bright-pink");
    expect(slugify("Yellow")).toBe("yellow");
  });
});

describe("parseMarkColor", () => {
  it("reads an inline background hex", () => {
    expect(parseMarkColor(' style="background:#FFB8EBA6;"', [])).toBe("#FFB8EBA6");
  });

  it("reads background-color and rgba", () => {
    expect(parseMarkColor(' style="background-color: rgba(1,2,3,0.5)"', [])).toBe(
      "rgba(1,2,3,0.5)"
    );
  });

  it("resolves an hltr class via the palette", () => {
    expect(parseMarkColor(' class="hltr-pink"', [PINK])).toBe("#FFB8EBA6");
  });

  it("rejects injection-y values", () => {
    expect(parseMarkColor(' style="background:url(evil)"', [])).toBeNull();
    expect(parseMarkColor(' class="hltr-unknown"', [PINK])).toBeNull();
    expect(parseMarkColor("", [])).toBeNull();
  });
});

describe("highlightWrap", () => {
  it("defaults to inline <mark style> when Highlightr is absent", () => {
    const w = highlightWrap(PINK, appWith());
    expect(w.open).toBe('<mark style="background:#FFB8EBA6;">');
    expect(w.close).toBe("</mark>");
  });

  it("uses hltr classes when Highlightr is set to css-classes", () => {
    const app = appWith({ "highlightr-plugin": { settings: { highlighterStyle: "css-classes" } } });
    expect(highlightWrap(PINK, app).open).toBe('<mark class="hltr-pink">');
  });
});

describe("resolveHighlightPalette", () => {
  it("returns nothing when Highlightr absent and opt-in off", () => {
    expect(resolveHighlightPalette(appWith(), DEFAULT_SETTINGS)).toEqual([]);
  });

  it("returns the default palette when opted in", () => {
    const settings = { ...DEFAULT_SETTINGS, showHighlightColorsWithoutPlugin: true };
    const out = resolveHighlightPalette(appWith(), settings);
    expect(out).toHaveLength(DEFAULT_HIGHLIGHT_PALETTE.length);
    expect(out[0]).toMatchObject({ slug: "pink", color: "#FFB8EBA6", source: "default" });
  });

  it("reads Highlightr's colors + order when installed", () => {
    const app = appWith({
      "highlightr-plugin": {
        settings: {
          highlighters: { Lime: "#aaffaa", Sky: "#aaddff" },
          highlighterOrder: ["Sky", "Lime"],
        },
      },
    });
    const out = resolveHighlightPalette(app, DEFAULT_SETTINGS);
    expect(out.map((c) => c.slug)).toEqual(["sky", "lime"]);
    expect(out[0]).toMatchObject({ color: "#aaddff", source: "highlightr" });
  });
});

describe("findHighlightSpans", () => {
  const pink: HighlightColor = {
    slug: "pink",
    label: "Pink",
    color: "#FFB8EBA6",
    source: "default",
  };

  it("finds a plain == span with no color", () => {
    const text = "我==爱学==中";
    const spans = findHighlightSpans(text, []);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].contentFrom, spans[0].contentTo)).toBe("爱学");
    expect(spans[0].color).toBeUndefined();
  });

  it("finds a colored <mark> span", () => {
    const text = '前<mark style="background:#FFB8EBA6;">爱学</mark>后';
    const spans = findHighlightSpans(text, []);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].contentFrom, spans[0].contentTo)).toBe("爱学");
    expect(spans[0].color).toBe("#FFB8EBA6");
  });

  it("resolves hltr class marks via the palette", () => {
    const text = '<mark class="hltr-pink">字</mark>';
    const spans = findHighlightSpans(text, [pink]);
    expect(spans[0].color).toBe("#FFB8EBA6");
  });

  it("ignores colorless marks and empty content", () => {
    expect(findHighlightSpans("<mark>字</mark>", [])).toEqual([]);
    expect(findHighlightSpans("<mark></mark>", [])).toEqual([]);
  });
});

describe("highlightColorForId", () => {
  it("matches hl:<slug> against the palette", () => {
    expect(highlightColorForId("hl:pink", [PINK])).toBe(PINK);
    expect(highlightColorForId("hl:none", [PINK])).toBeNull();
    expect(highlightColorForId("bold", [PINK])).toBeNull();
  });
});
