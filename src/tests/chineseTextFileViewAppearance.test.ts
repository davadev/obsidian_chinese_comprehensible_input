import { describe, it, expect, vi } from "vitest";
import { ChineseTextFileView } from "../view/ChineseTextFileView";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * #119 / 0.7.7: the Settings tab redecorates every open view through refreshChineseViews(), and then calls
 * applySettingsToView() to rewrite the appearance CSS variables. That second step is pure CSS, so it must NOT redecorate
 * again: doing so meant two full passes over every open view for each tick of a slider drag. The settings-tab half was
 * tested; this is the view half, driven on the REAL view class (no DOM, no editor: just the slice of the root element the
 * appliers touch), so removing `{ redecorate: false }` turns it red.
 */

function makeRoot() {
  const style = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    style: { setProperty: (k: string, v: string) => void style.set(k, v) },
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    vars: style,
    attrs,
  };
}

function makeView(settings: Record<string, unknown> = {}) {
  const root = makeRoot();
  const plugin = { settings: { ...DEFAULT_SETTINGS, ...settings } } as any;
  const view = new ChineseTextFileView({} as any, plugin);
  (view as any).containerEl = { children: [{}, root] };
  const redecorate = vi.spyOn(view, "redecorate");
  return { view, root, redecorate };
}

describe("ChineseTextFileView appearance path (#119)", () => {
  it("applySettingsToView rewrites the appearance variables without redecorating", () => {
    const { view, root, redecorate } = makeView({ readerFontPx: 30, annotationScalePercent: 150 });
    view.applySettingsToView();
    expect(redecorate).not.toHaveBeenCalled();
    expect(root.vars.get("--cci-reader-font")).toBe("30px");
    expect(root.vars.get("--cci-annotation-scale")).toBe("1.5");
    expect(root.attrs.get("data-display")).toBe(DEFAULT_SETTINGS.defaultDisplayMode);
  });

  it("a toolbar change (no options) still redecorates exactly once", () => {
    const { view, redecorate } = makeView();
    (view as any).handleToolbarChange();
    expect(redecorate).toHaveBeenCalledTimes(1);
  });

  it("E-ink mode reaches the root through the same path, and is removed when off", () => {
    const on = makeView({ einkMode: true });
    on.view.applySettingsToView();
    expect(on.root.attrs.has("data-eink")).toBe(true);
    expect(on.redecorate).not.toHaveBeenCalled();

    const off = makeView({ einkMode: false });
    off.root.attrs.set("data-eink", "");
    off.view.applySettingsToView();
    expect(off.root.attrs.has("data-eink")).toBe(false);
  });
});
