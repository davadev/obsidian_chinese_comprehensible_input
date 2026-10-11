// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { all, makeSettingsTab, renderDef, type Def } from "./__mocks__/settingsTabHarness";

installObsidianDom();
vi.mock("../ui/confirmInput", () => ({ confirmAsync: vi.fn(async () => true) }));
afterEach(() => void (document.body.innerHTML = ""));

describe("every definition", () => {
  it("can be evaluated: descriptions, visibility, disabled state, custom renders and control values", () => {
    const { tab } = makeSettingsTab();
    for (const d of all(tab)) {
      if (typeof d.visible === "function") d.visible();
      if (typeof d.disabled === "function") d.disabled();
      if (d.control && typeof d.control.disabled === "function") d.control.disabled();
      if (d.control) tab.getControlValue(d.control.key);
      if (d.render) renderDef(d);
    }
    expect(all(tab).length).toBeGreaterThan(100);
  });
});
