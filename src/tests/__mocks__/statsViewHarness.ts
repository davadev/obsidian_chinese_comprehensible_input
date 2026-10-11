import { vi } from "vitest";
import { TFile } from "obsidian";
import { StatsView } from "../../ui/StatsView";
import { DEFAULT_SETTINGS } from "../../settings/defaults";

/**
 * A StatsView wired to a plain-object plugin, for tests that run under happy-dom (a real `document`). The vocabulary
 * is a plain list (the view only reads it and calls the few mutators it uses), the vault is a path -> text map, and every
 * plugin method the view calls is a spy.
 */

export const file = (path: string): any => Object.assign(new TFile(), { path, basename: path.replace(/\.[^.]+$/, ""), extension: "md" });

export const rec = (surface: string, over: Record<string, unknown> = {}): any => ({
  key: `${surface}|x`,
  surfaces: [surface],
  simplified: surface,
  pinyin: "pin yin",
  definitions: ["a def"],
  status: "new",
  seenCount: 1,
  recentSeenAt: [],
  dailySeenCounts: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

export interface StatsOpts {
  records?: any[];
  settings?: (s: any) => void;
  files?: Record<string, string>;
  tokens?: (text: string) => any[];
  due?: any[];
  notePaths?: string[];
}

export function makeStats(o: StatsOpts = {}) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.scriptVariant = "auto";
  o.settings?.(settings);
  const files = new Map<string, string>(Object.entries(o.files ?? {}));
  const records = o.records ?? [];
  const root = document.createElement("div");
  const plugin: any = {
    settings,
    app: {
      vault: {
        getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? file(p) : null)),
        cachedRead: vi.fn(async (f: any) => files.get(f.path) ?? ""),
      },
      fileManager: { trashFile: vi.fn(async () => {}) },
      workspace: { openLinkText: vi.fn(async () => {}), getLeaf: vi.fn(() => ({ setViewState: vi.fn(async () => {}) })) },
    },
    vocab: {
      values: vi.fn(() => records),
      knownNotePaths: vi.fn(() => o.notePaths ?? [...new Set(records.flatMap((r) => Object.keys(r.notesSeenCounts ?? {})))].sort()),
      markAllNewAs: vi.fn(() => 0),
      setStatus: vi.fn(),
      setAxes: vi.fn(),
    },
    srs: { due: vi.fn(() => o.due ?? []), applyGrade: vi.fn() },
    dictionary: { lookup: vi.fn(() => []) },
    tokenizer: { tokenize: vi.fn(async (t: string) => (o.tokens ? o.tokens(t) : [])) },
    ai: { testConnection: vi.fn(async () => true), resolveActive: vi.fn(() => ({ active: { maxRepairIterations: 4 } })) },
    story: {
      previewPath: vi.fn(() => "Stories/Preview.md"),
      generatePreview: vi.fn(async () => ({ story: { title: "标题", textChinese: "正文" }, targets: [], targetHsk: "3", score: 0.91, file: file("Stories/Preview.md"), iterations: 1 })),
      commitPreviewAsNote: vi.fn(async () => file("Stories/Saved.md")),
    },
    saveSettings: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
  };
  const leaf: any = { detach: vi.fn(), setViewState: vi.fn() };
  const view = new StatsView(leaf, plugin) as any;
  view.containerEl = { children: [document.createElement("div"), root] };
  view.app = plugin.app;
  view.leaf = leaf;
  return { view, root, plugin, files, leaf, records };
}

export const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel)!;
export const qa = (root: ParentNode, sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
export const btn = (root: ParentNode, text: string | RegExp) =>
  qa(root, "button").find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")))!;
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
