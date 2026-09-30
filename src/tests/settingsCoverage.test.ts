import { beforeEach, describe, expect, it, vi } from "vitest";
import { CciSettingsTab } from "../settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { getByPath, setByPath } from "../settings/settingsPath";

/**
 * Guards the 0.5.1 rewrite of the settings tab from imperative `display()`
 * to the declarative `getSettingDefinitions()` API: every user-editable
 * setting must still have a control, and any setting added later must
 * either get one or be listed here deliberately.
 */

/** Settings with no control in the tab, each for a stated reason. */
const NOT_IN_SETTINGS_TAB: Record<string, string> = {
  // Internal bookkeeping, never user-editable.
  schemaVersion: "internal",
  vaultIndexed: "internal flag set by the indexer",
  hskColorsDerivedFromAccent: "internal first-install marker",
  dictionarySource: "written by the dictionary downloader",
  "ai.usageLog": "append-only token log",
  "ai.ollama.apiKey": "always empty at rest; the key lives in localStorage",
  "ai.ollama.embeddingModel": "reserved, not used by any feature yet",
  traditionalPromptDismissed:
    "set by the one-time 'this note looks Traditional' prompt's Don't ask again",
  trackedBaselineRepaired:
    "one-shot bookkeeping for the vault-index baseline pass; not a preference",
  // Edited from the reading view's toolbar / display menu.
  enabledFormats: "armed from the formatting toolbar",
  formatReverseMode: "toggled by the highlighter button",
  formatOrder: "reordered by the formatting-picker list control",
  formatHidden: "toggled by the formatting-picker list control",
  readerLineSpacing: "slider in the view's display menu",
  "sync.statusPriority": "reordered by the priority list control",
  // Edited from the dashboard.
  statsExcludeNew: "dashboard header toggle",
  flashcardsMode: "remembered from the flashcards tab",
  topicRadarTopics: "topic-coverage spoke chooser on the dashboard",
  topicRadarMode: "topic-coverage metric selector on the dashboard",
  // Declared but not consumed by any code path (pre-existing).
  newWordBehavior: "not read anywhere in the plugin",
  unknownWordBehavior: "not read anywhere in the plugin",
};

const PREFIXES_NOT_IN_TAB = ["progressChartSeries.", "hskCoverageBuckets."];

function leafPaths(obj: unknown, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leafPaths(v, path));
    else out.push(path);
  }
  return out;
}

interface AnyItem {
  type?: string;
  name?: string;
  items?: AnyItem[];
  control?: { key?: string };
}

function collectKeys(items: AnyItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.control?.key) out.push(item.control.key);
    if (item.items) out.push(...collectKeys(item.items));
  }
  return out;
}

function makeTab(): CciSettingsTab {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
  const plugin = {
    app: { vault: { configDir: ".obsidian" }, loadLocalStorage: () => "", saveLocalStorage: () => undefined },
    settings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
    // Only reached by the APPEARANCE_KEYS branch of persist(), which no test
    // touched before the 0.7.7 regression tests below.
    refreshChineseViewAppearance: vi.fn(),
    forceRetokenizeViews: vi.fn(),
  };
  const app = plugin.app;
  return new CciSettingsTab(app as never, plugin as never);
}

/** Same tab, but with the fake plugin handed back so its spies are reachable. */
function makeTabWithPlugin() {
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

interface HeadingItem extends AnyItem {
  heading?: string;
  visible?: boolean | (() => boolean);
}

/**
 * Map every named setting to the divider heading it renders under.
 *
 * An empty-items `{ type: "group" }` is a DIVIDER, not a container: it labels
 * everything that follows it in the same array until the next one. That is the
 * whole reason three unrelated settings drifted under "Annotation lines" in
 * 0.7.7, so it is worth pinning.
 */
function headingOf(items: HeadingItem[], inherited = ""): Map<string, string> {
  const out = new Map<string, string>();
  let current = inherited;
  for (const item of items) {
    if (item.type === "group") {
      if (item.items && item.items.length > 0) {
        // A group WITH items scopes only its own children.
        for (const [k, v] of headingOf(item.items as HeadingItem[], item.heading ?? current)) {
          out.set(k, v);
        }
      } else {
        current = item.heading ?? current;
      }
      continue;
    }
    if (item.type === "page") {
      // A page is its own screen; headings do not leak across the boundary.
      for (const [k, v] of headingOf((item.items ?? []) as HeadingItem[], "")) out.set(k, v);
      continue;
    }
    if (item.name) out.set(item.name, current);
    if (item.items) {
      for (const [k, v] of headingOf(item.items as HeadingItem[], current)) out.set(k, v);
    }
  }
  return out;
}

describe("settings tab definitions", () => {
  beforeEach(() => {
    (globalThis as unknown as { createFragment: unknown }).createFragment = (
      cb: (f: unknown) => void
    ) => {
      const frag = {
        createSpan: () => frag,
        createEl: () => frag,
      };
      cb(frag);
      return frag;
    };
  });

  it("exposes a control for every user-editable setting", () => {
    const keys = new Set(collectKeys(makeTab().getSettingDefinitions() as AnyItem[]));
    const missing = leafPaths(DEFAULT_SETTINGS).filter(
      (p) =>
        !keys.has(p) &&
        !(p in NOT_IN_SETTINGS_TAB) &&
        !PREFIXES_NOT_IN_TAB.some((prefix) => p.startsWith(prefix))
    );
    expect(missing).toEqual([]);
  });

  it("only binds controls to real settings paths (no typos)", () => {
    const keys = collectKeys(makeTab().getSettingDefinitions() as AnyItem[]);
    const bogus = keys.filter(
      (k) =>
        !k.startsWith("secret:") &&
        !k.startsWith("ui:") &&
        getByPath(DEFAULT_SETTINGS, k) === undefined
    );
    expect(bogus).toEqual([]);
  });

  it("gives every control a unique key", () => {
    const keys = collectKeys(makeTab().getSettingDefinitions() as AnyItem[]);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("round-trips a nested value through get/setControlValue", async () => {
    const tab = makeTab();
    await tab.setControlValue("ai.ollama.chatModel", "qwen3:14b");
    expect(tab.getControlValue("ai.ollama.chatModel")).toBe("qwen3:14b");
  });

  it("converts the HSK comfort slider between percent and fraction", async () => {
    const tab = makeTab();
    await tab.setControlValue("topHskComfortThreshold", 80);
    expect(tab.getControlValue("topHskComfortThreshold")).toBe(80);
  });
});

/**
 * 0.7.7 regressions. Each of these is a bug that shipped in a beta of this
 * release and was fixed; the tests exist so the same mistake is loud next time.
 */
describe("0.7.7 regression guards", () => {
  beforeEach(() => {
    (globalThis as unknown as { createFragment: unknown }).createFragment = (
      cb: (f: unknown) => void
    ) => {
      const frag = { createSpan: () => frag, createEl: () => frag };
      cb(frag);
      return frag;
    };
  });

  it("puts the annotation-line settings under their own heading, and nothing else", () => {
    // The bug: "Annotation lines" was an empty-items group, i.e. a divider, and
    // nothing closed it — so Top HSK comfort threshold, Annotation density cap
    // and Show mnemonic before full definition all rendered beneath it.
    const headings = headingOf(makeTab().getSettingDefinitions() as never);
    expect(headings.get("Line 2 (directly above the characters)")).toBe("Annotation lines");
    expect(headings.get("Line 3 (above line 2)")).toBe("Annotation lines");
    expect(headings.get("Shorten translations")).toBe("Annotation lines");

    for (const stray of [
      "Top HSK comfort threshold (%)",
      "Annotation density cap (%)",
      "Show mnemonic before full definition",
    ]) {
      expect(headings.get(stray)).not.toBe("Annotation lines");
    }
  });

  it("re-evaluates the duplicate-line warning in place rather than re-rendering", async () => {
    // refreshDomState() is the documented call for a `visible` predicate change
    // ("Cheap: toggles CSS state in place, no re-render"); update() re-runs
    // getSettingDefinitions() and moves the page under the reader's cursor.
    //
    // Awaited unconditionally rather than through optional chaining: if
    // setControlValue ever stopped returning a promise, `?.then?.()` would skip
    // every assertion below and the test would pass while guarding nothing.
    const { tab } = makeTabWithPlugin();
    const domState = vi.spyOn(tab, "refreshDomState").mockImplementation(() => undefined);
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);
    await tab.setControlValue("line2Content", "english");
    expect(domState).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    // And line 3 takes the same branch.
    await tab.setControlValue("line3Content", "mnemonic");
    expect(domState).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it("warns only while line 2 and line 3 hold the same content", () => {
    const { tab, plugin } = makeTabWithPlugin();
    const items = tab.getSettingDefinitions() as never as AnyItem[];
    const warn = findWarn(items);
    expect(warn, "duplicate-content warning row not found").toBeTruthy();
    const visible = (warn as { visible: () => boolean }).visible;

    plugin.settings.line2Content = "pinyin";
    plugin.settings.line3Content = "english";
    expect(visible()).toBe(false);

    plugin.settings.line2Content = "english";
    expect(visible()).toBe(true);

    plugin.settings.line3Content = "mnemonic";
    expect(visible()).toBe(false);
  });

  it("re-applies view appearance for a size key, and does not for other keys", () => {
    // The CSS custom properties these keys drive are not touched by a plain
    // redecorate, so a font-size change from Settings did nothing until the view
    // was reopened.
    const { tab, plugin } = makeTabWithPlugin();
    return Promise.resolve(tab.setControlValue("readerFontPx", 30)).then(async () => {
      expect(plugin.refreshChineseViewAppearance).toHaveBeenCalledTimes(1);
      await tab.setControlValue("annotationScalePercent", 70);
      expect(plugin.refreshChineseViewAppearance).toHaveBeenCalledTimes(2);
      // A non-appearance key must not take that branch.
      await tab.setControlValue("knownWordPopups", true);
      expect(plugin.refreshChineseViewAppearance).toHaveBeenCalledTimes(2);
    });
  });
});

/** The conditional warning row: a render item carrying a `visible` predicate. */
function findWarn(items: AnyItem[]): AnyItem | undefined {
  for (const item of items) {
    const v = (item as { visible?: unknown }).visible;
    if (typeof v === "function" && !item.control && !item.items) return item;
    if (item.items) {
      const hit = findWarn(item.items);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe("settingsPath", () => {
  it("reads nested paths and undefined for missing segments", () => {
    const obj = { a: { b: { c: 1 } } };
    expect(getByPath(obj, "a.b.c")).toBe(1);
    expect(getByPath(obj, "a.x.c")).toBeUndefined();
    expect(getByPath(undefined, "a")).toBeUndefined();
  });

  it("writes nested paths, creating missing objects", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "a.b.c", 2);
    expect(obj).toEqual({ a: { b: { c: 2 } } });
  });

  it("replaces a non-object segment rather than throwing", () => {
    const obj: Record<string, unknown> = { a: 5 };
    setByPath(obj, "a.b", 1);
    expect(obj).toEqual({ a: { b: 1 } });
  });
});
