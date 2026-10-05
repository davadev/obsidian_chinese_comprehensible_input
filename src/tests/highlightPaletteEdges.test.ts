import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import {
  findHighlightSpans,
  highlightrInstalled,
  highlightWrap,
  parseMarkColor,
  resolveHighlightPalette,
  type HighlightColor,
} from "../editor/highlightPalette";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * Edges of how highlights are found and where their colours come from. Notes are arbitrary
 * user text and Highlightr is somebody else's plugin, so every shape here is one that can
 * really arrive. The colour goes into a style attribute, so the injection cases matter.
 */

const app = (reg?: unknown) => ({ plugins: reg }) as unknown as App;
const withPlugin = (settings: unknown, extra: Record<string, unknown> = {}) =>
  app({ plugins: { "highlightr-plugin": { settings } }, ...extra });
const S = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });

describe("Highlightr detection", () => {
  it("is absent without a plugin registry, without the plugin, or with it disabled", () => {
    expect(highlightrInstalled(app(undefined))).toBe(false);
    expect(highlightrInstalled(app({ plugins: {} }))).toBe(false);
    expect(
      highlightrInstalled(app({ enabledPlugins: new Set(["other"]), plugins: { "highlightr-plugin": { settings: {} } } }))
    ).toBe(false);
  });

  it("is present when enabled, and found through getPlugin when not in the plugins map", () => {
    expect(highlightrInstalled(withPlugin({}, { enabledPlugins: new Set(["highlightr-plugin"]) }))).toBe(true);
    expect(
      highlightrInstalled(app({ getPlugin: (id: string) => (id === "highlightr-plugin" ? { settings: {} } : null) }))
    ).toBe(true);
  });

  it("is absent when its settings are missing or not an object", () => {
    expect(highlightrInstalled(withPlugin(undefined))).toBe(false);
    expect(highlightrInstalled(withPlugin("nope"))).toBe(false);
  });
});

describe("resolveHighlightPalette edges", () => {
  it("ignores colours that are not strings, and names missing from the map", () => {
    const p = resolveHighlightPalette(
      withPlugin({ highlighters: { A: "#111", B: 5, C: null }, highlighterOrder: ["B", "A", "Ghost", "C"] }),
      S()
    );
    expect(p.map((c) => c.label)).toEqual(["A"]);
  });

  it("uses the map's own order when Highlightr gives no (or a non-array) order", () => {
    const labels = (o: unknown) =>
      resolveHighlightPalette(withPlugin({ highlighters: { Z: "#111", Y: "#222" }, highlighterOrder: o }), S()).map(
        (c) => c.label
      );
    expect(labels(undefined)).toEqual(["Z", "Y"]);
    expect(labels("Y,Z")).toEqual(["Z", "Y"]);
  });

  it("falls back to the opt-in defaults when Highlightr is installed but has no colours", () => {
    expect(resolveHighlightPalette(withPlugin({}), S()).length).toBe(0);
    expect(resolveHighlightPalette(withPlugin({}), S({ showHighlightColorsWithoutPlugin: true })).length).toBe(8);
  });

  it("an empty Highlightr palette is an empty palette, not the defaults", () => {
    expect(resolveHighlightPalette(withPlugin({ highlighters: {} }), S({ showHighlightColorsWithoutPlugin: true }))).toEqual([]);
  });
});

describe("highlightWrap with Highlightr's method", () => {
  const hc: HighlightColor = { slug: "hot-pink", label: "Hot Pink", color: "#F0F", source: "highlightr" };
  it("inline style by default and for any other method value", () => {
    expect(highlightWrap(hc, withPlugin({ highlighterStyle: "inline-style" })).open).toBe('<mark style="background:#F0F;">');
    expect(highlightWrap(hc, withPlugin({ highlighterStyle: "???" })).open).toBe('<mark style="background:#F0F;">');
  });
  it("css class when Highlightr is set to classes", () => {
    expect(highlightWrap(hc, withPlugin({ highlighterStyle: "css-classes" })).open).toBe('<mark class="hltr-hot-pink">');
  });
});

describe("parseMarkColor: values that reach a style attribute", () => {
  const palette: HighlightColor[] = [
    { slug: "ok", label: "Ok", color: "#0f0", source: "highlightr" },
    { slug: "evil", label: "Evil", color: "red; background-image:url(//x)", source: "highlightr" },
  ];
  it.each([
    ['style="background:#abc"', "#abc"],
    ["style='background-color: rgb(1, 2, 3)'", "rgb(1, 2, 3)"],
    ['style="color:red;background:yellow"', "yellow"],
    ['class="x hltr-ok y"', "#0f0"],
  ])("accepts %s", (attrs, want) => expect(parseMarkColor(attrs, palette)).toBe(want));

  it.each([
    ['style="background:url(javascript:alert(1))"'],
    ['style="background:red;position:fixed"' + "x"], // second declaration is not taken
    ['style="background:expression(alert(1))"'],
    ['class="hltr-evil"'], // palette entry whose colour is itself unsafe
    ['class="hltr-missing"'],
    ['style="width:1px"'],
    [""],
  ])("does not turn %s into a colour", (attrs) => {
    const c = parseMarkColor(attrs, palette);
    expect(c === null || /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d.,\s%]+\))$/i.test(c)).toBe(true);
    expect(c ?? "").not.toMatch(/[();:]/);
  });
});

describe("findHighlightSpans edges", () => {
  const pal: HighlightColor[] = [];
  it("finds several spans on one line, in order", () => {
    const s = findHighlightSpans("a ==b== c ==d== e", pal);
    expect(s.map((x) => x.openFrom)).toEqual([2, 10]);
  });

  it("does not span lines, and ignores empty or lone delimiters", () => {
    expect(findHighlightSpans("==a\nb==", pal)).toEqual([]);
    expect(findHighlightSpans("==== and == alone", pal).length).toBeLessThanOrEqual(1);
  });

  it("keeps the earlier of two overlapping spans", () => {
    // a == inside a coloured mark: the mark opens first, so it is the one that is kept
    const inner = findHighlightSpans('<mark style="background:#abc">a ==b== c</mark>', pal);
    expect(inner).toHaveLength(1);
    expect(inner[0].color).toBe("#abc");
    // and the other way round
    const outer = findHighlightSpans('==a <mark style="background:#abc">b</mark> c==', pal);
    expect(outer.every((x) => x.openFrom === 0 || x.color === "#abc")).toBe(true);
    expect(outer.length).toBeGreaterThanOrEqual(1);
  });

  it("a mark with an unsafe colour is not a highlight at all", () => {
    expect(findHighlightSpans('<mark style="background:url(x)">hi</mark>', pal)).toEqual([]);
  });

  it("offsets point at the content, so the delimiters can be hidden", () => {
    const doc = "pre ==abc== post";
    const [s] = findHighlightSpans(doc, pal);
    expect(doc.slice(s.contentFrom, s.contentTo)).toBe("abc");
    expect(doc.slice(s.openFrom, s.closeTo)).toBe("==abc==");
  });
});
