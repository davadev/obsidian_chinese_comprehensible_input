import { beforeEach, describe, it, expect, vi } from "vitest";
import { CciSettingsTab } from "../settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import {
  EINK_NUMBER_SCALE_MAX,
  EINK_NUMBER_SCALE_MIN,
  EINK_NUMBER_SCALE_STEP,
} from "../view/einkMode";

/**
 * E-ink mode's settings wiring (#112).
 *
 * The risk with a mode that greys things out is getting the set wrong in either
 * direction: grey something that still does work and the user loses a control for
 * no reason; leave something live that is now dead and it becomes a setting that
 * lies — the thing 0.7.8 removed two of (#126). So the sets are pinned from the
 * definitions themselves, enumerated rather than listed, and the must-stay-live
 * controls are pinned as well.
 */

interface Item {
  type?: string;
  name?: string;
  searchable?: boolean;
  items?: Item[];
  heading?: string;
  visible?: boolean | (() => boolean);
  disabled?: boolean | (() => boolean);
  action?: unknown;
  render?: (setting: unknown) => void;
  control?: {
    type?: string;
    key?: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean | (() => boolean);
  };
}

function makeTab() {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
  const plugin = {
    app: { vault: { configDir: ".obsidian" }, loadLocalStorage: () => "", saveLocalStorage: () => undefined },
    settings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    refreshChineseViewAppearance: vi.fn(),
    forceRetokenizeViews: vi.fn(),
  };
  const tab = new CciSettingsTab(plugin.app as never, plugin as never);
  return { tab, plugin };
}

function flatten(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    out.push(it);
    if (it.items) out.push(...flatten(it.items));
  }
  return out;
}

const definitions = (tab: CciSettingsTab) => flatten(tab.getSettingDefinitions() as never as Item[]);
const byKey = (all: Item[], key: string) => all.find((i) => i.control?.key === key);
const byName = (all: Item[], name: string) => all.find((i) => i.name === name);
const evalFlag = (f: boolean | (() => boolean) | undefined): boolean | undefined =>
  typeof f === "function" ? f() : f;

beforeEach(() => {
  // Obsidian's DOM global, used by SettingsTab.docLink(); same stub as settingsCoverage.test.ts.
  (globalThis as { createFragment?: unknown }).createFragment = (cb: (f: unknown) => void) => {
    const frag = { createSpan: () => frag, createEl: () => frag };
    cb(frag);
    return frag;
  };
});

describe("E-ink mode settings", () => {
  it("puts the toggle first in the Display group, right after the guide link", () => {
    const { tab } = makeTab();
    const display = (tab.getSettingDefinitions() as never as Item[]).find(
      (i) => i.type === "group" && i.heading === "Display"
    );
    expect(display).toBeTruthy();
    const keys = display!.items!.map((i) => i.control?.key).filter(Boolean);
    expect(keys[0]).toBe("einkMode");
    expect(byKey(display!.items!, "einkMode")?.control?.type).toBe("toggle");
  });

  it("defaults to off, with the size at 100", () => {
    expect(DEFAULT_SETTINGS.einkMode).toBe(false);
    expect(DEFAULT_SETTINGS.einkNumberScalePercent).toBe(100);
  });

  describe("level-number size slider", () => {
    it("takes its bounds from the shared constants, not from copies", () => {
      // The annotation slider duplicates 50/200 in several places and its own
      // comment warns the floor must match. Here a drift is a failing test.
      const { tab } = makeTab();
      const slider = byKey(definitions(tab), "einkNumberScalePercent");
      expect(slider?.control?.type).toBe("slider");
      expect(slider?.control?.min).toBe(EINK_NUMBER_SCALE_MIN);
      expect(slider?.control?.max).toBe(EINK_NUMBER_SCALE_MAX);
      expect(slider?.control?.step).toBe(EINK_NUMBER_SCALE_STEP);
    });

    it("is visible only while E-ink mode is on", () => {
      const { tab, plugin } = makeTab();
      const slider = byKey(definitions(tab), "einkNumberScalePercent")!;
      plugin.settings.einkMode = false;
      expect(evalFlag(slider.visible)).toBe(false);
      plugin.settings.einkMode = true;
      expect(evalFlag(slider.visible)).toBe(true);
    });

    it("is greyed unless colour mode is HSK — the number only exists there", () => {
      // The full truth table, not just the interesting corner.
      const { tab, plugin } = makeTab();
      const slider = byKey(definitions(tab), "einkNumberScalePercent")!;
      const cases: Array<[boolean, "status" | "hsk", boolean, boolean]> = [
        // einkMode, colorMode, expected visible, expected disabled
        [false, "status", false, true],
        [false, "hsk", false, false],
        [true, "status", true, true],
        [true, "hsk", true, false],
      ];
      for (const [eink, mode, vis, dis] of cases) {
        plugin.settings.einkMode = eink;
        plugin.settings.colorMode = mode;
        expect(evalFlag(slider.visible), `visible @ eink=${eink} ${mode}`).toBe(vis);
        expect(evalFlag(slider.control!.disabled), `disabled @ eink=${eink} ${mode}`).toBe(dis);
      }
    });
  });

  describe("what E-ink mode greys out", () => {
    it("greys EVERY customColors.* picker, enumerated from the definitions", () => {
      // Enumerated rather than listed, so a colour picker added later cannot be
      // forgotten: it either gets the predicate or this test names it.
      const { tab, plugin } = makeTab();
      const pickers = definitions(tab).filter((i) => i.control?.key?.startsWith("customColors."));
      // 4 status colours + 7 HSK levels. Asserted so a silently empty match
      // cannot make the loop below vacuous.
      expect(pickers.length).toBe(11);
      for (const p of pickers) {
        plugin.settings.einkMode = false;
        expect(evalFlag(p.control!.disabled), `${p.control!.key} off`).toBe(false);
        plugin.settings.einkMode = true;
        expect(evalFlag(p.control!.disabled), `${p.control!.key} on`).toBe(true);
      }
    });

    it("greys the pinyin and translation pickers (E-ink draws those rows black), not the characters one", () => {
      const { tab, plugin } = makeTab();
      const all = definitions(tab);
      for (const key of ["textColors.pinyin", "textColors.gloss"]) {
        const item = byKey(all, key);
        expect(item, key).toBeTruthy();
        plugin.settings.einkMode = false;
        expect(evalFlag(item!.control!.disabled), `${key} off`).toBe(false);
        plugin.settings.einkMode = true;
        expect(evalFlag(item!.control!.disabled), `${key} on`).toBe(true);
      }
    });

    it("greys both reset-colour buttons", () => {
      const { tab, plugin } = makeTab();
      const all = definitions(tab);
      for (const name of ["Reset HSK colors to accent gradient", "Reset all colors to defaults"]) {
        const btn = byName(all, name);
        expect(btn, name).toBeTruthy();
        plugin.settings.einkMode = false;
        expect(evalFlag(btn!.disabled), `${name} off`).toBe(false);
        plugin.settings.einkMode = true;
        expect(evalFlag(btn!.disabled), `${name} on`).toBe(true);
      }
    });

    it("leaves every control that still does something LIVE", () => {
      // The guard against over-greying. These still have an effect in E-ink mode:
      // colorMode picks underline-styles vs numbers; the per-status and per-level
      // switches decide WHICH words get marked; highlightOverridesStatus decides
      // whether a highlight or an underline shows; the text-colour toggle and the
      // characters colour are unrelated (the pinyin / translation pickers are not:
      // E-ink draws those rows black, see the test below).
      const { tab } = makeTab();
      const all = definitions(tab);
      const mustStayLive = [
        "colorMode",
        "showKnownColor",
        "showPartialColor",
        "showUnknownColor",
        "showNewColor",
        "highlightOverridesStatus",
        "textColors.enabled",
        "textColors.chars",
        ...["1", "2", "3", "4", "5", "6", "7"].map((l) => `showHskColors.${l}`),
      ];
      for (const key of mustStayLive) {
        const item = byKey(all, key);
        expect(item, `${key} should exist`).toBeTruthy();
        expect(item!.control!.disabled, `${key} must not be greyed`).toBeUndefined();
      }
    });

    it("explains the greying, and only while the mode is on", () => {
      const { tab, plugin } = makeTab();
      // The hint is a prose row; recognise it by what it renders.
      const texts = new Map<Item, string>();
      for (const it of definitions(tab)) {
        if (typeof it.render !== "function") continue;
        let captured = "";
        const fakeSetting = {
          settingEl: { empty() {}, addClass() {}, createEl: (_t: string, o: { text?: string }) => (captured = o.text ?? "") },
        };
        try {
          it.render(fakeSetting);
        } catch {
          continue;
        }
        texts.set(it, captured);
      }
      const hint = [...texts].find(([, t]) => t.startsWith("E-ink mode is on"))?.[0];
      expect(hint, "hint row not found").toBeTruthy();
      const text = texts.get(hint!)!;
      // It must be honest that the colours still do something elsewhere.
      expect(text).toContain("statistics");
      plugin.settings.einkMode = false;
      expect(evalFlag(hint!.visible)).toBe(false);
      plugin.settings.einkMode = true;
      expect(evalFlag(hint!.visible)).toBe(true);
    });
  });

  describe("persist wiring", () => {
    function spies() {
      const { tab, plugin } = makeTab();
      const domState = vi.spyOn(tab, "refreshDomState").mockImplementation(() => undefined);
      const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);
      return { tab, plugin, domState, update };
    }

    it("toggling E-ink mode applies the attribute AND re-evaluates the greyed rows, once each", async () => {
      // Both are needed: the appearance refresh puts data-eink on the view, and
      // refreshDomState() re-runs the disabled/visible predicates. It cannot just
      // join APPEARANCE_KEYS — that branch is first in the chain and would skip
      // the second call.
      const { tab, plugin, domState, update } = spies();
      await tab.setControlValue("einkMode", true);
      expect(plugin.settings.einkMode).toBe(true);
      expect(plugin.refreshChineseViewAppearance).toHaveBeenCalledTimes(1);
      expect(domState).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it("dragging the size slider re-applies appearance and does NOT re-render the page", async () => {
      const { tab, plugin, domState, update } = spies();
      await tab.setControlValue("einkNumberScalePercent", 110);
      expect(plugin.settings.einkNumberScalePercent).toBe(110);
      expect(plugin.refreshChineseViewAppearance).toHaveBeenCalledTimes(1);
      expect(domState).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("changing colour mode re-evaluates the slider's greyed state", async () => {
      const { tab, plugin, domState } = spies();
      await tab.setControlValue("colorMode", "hsk");
      expect(domState).toHaveBeenCalledTimes(1);
      expect(plugin.refreshChineseViewAppearance).not.toHaveBeenCalled();
    });

    it("redecorates exactly once per change — never twice (the 0.7.7 slider regression)", async () => {
      // A double redecorate on a slider drag was a real bug in this release.
      const { tab, plugin } = spies();
      for (const [key, value] of [
        ["einkMode", true],
        ["einkNumberScalePercent", 120],
        ["colorMode", "hsk"],
      ] as const) {
        plugin.refreshChineseViews.mockClear();
        await tab.setControlValue(key, value);
        expect(plugin.refreshChineseViews, key).toHaveBeenCalledTimes(1);
      }
    });
  });
});
