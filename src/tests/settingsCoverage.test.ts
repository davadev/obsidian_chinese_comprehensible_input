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
  };
  const app = plugin.app;
  return new CciSettingsTab(app as never, plugin as never);
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
