import { vi } from "vitest";
import CciPlugin from "../../main";
import { ChineseTextFileView } from "../../view/ChineseTextFileView";
import { StatsView } from "../../ui/StatsView";
import { DEFAULT_SETTINGS } from "../../settings/defaults";

/**
 * main.ts is a shell that cannot be loaded whole in a test, so its methods are run against a plain object with
 * `CciPlugin.prototype.<method>.call(self, ...)` (the technique backupWiring.test.ts introduced). `self` carries only
 * what the method under test reads, and the spies on it are the assertions. A test that needs a private method to run
 * for real just lets the prototype supply it: `bind(self)` wires every prototype method onto `self`.
 */

type Fn = (...a: unknown[]) => unknown;
export const proto = CciPlugin.prototype as unknown as Record<string, Fn>;
export const call = <T = unknown>(name: string, self: object, ...args: unknown[]): T => proto[name].call(self, ...args) as T;

/** `self` with every method of the plugin class available on it (so `this.foo()` inside a method works) and state to taste. */
export function bind<T extends Record<string, unknown>>(self: T): T & Record<string, any> {
  const out: Record<string, unknown> = self;
  for (const name of Object.getOwnPropertyNames(CciPlugin.prototype)) {
    if (name === "constructor" || name in out) continue;
    const v = (proto as Record<string, unknown>)[name];
    if (typeof v === "function") out[name] = (v as Fn).bind(out);
  }
  return out as T & Record<string, any>;
}

export const chineseView = (over: Record<string, unknown> = {}): any =>
  Object.assign(Object.create(ChineseTextFileView.prototype), {
    refreshToolbar: vi.fn(),
    redecorate: vi.fn(),
    reconfigureEditor: vi.fn(),
    applySettingsToView: vi.fn(),
    forceRetokenize: vi.fn(),
    applyFormatToRange: vi.fn(),
    ...over,
  });

export const statsView = (over: Record<string, unknown> = {}): any =>
  Object.assign(Object.create(StatsView.prototype), {
    render: vi.fn(),
    setScope: vi.fn(async () => {}),
    invalidateCaches: vi.fn(),
    ...over,
  });

export interface Leaf {
  view: unknown;
  setViewState?: ReturnType<typeof vi.fn>;
}

/** A workspace that hands out the given leaves per view type. */
export function workspace(byType: Record<string, Leaf[]> = {}, over: Record<string, unknown> = {}) {
  return {
    getLeavesOfType: vi.fn((t: string) => byType[t] ?? []),
    getActiveFile: vi.fn(() => null),
    getLeaf: vi.fn(() => ({ setViewState: vi.fn(async () => {}), view: undefined })),
    revealLeaf: vi.fn(async () => {}),
    setActiveLeaf: vi.fn(),
    openLinkText: vi.fn(async () => {}),
    onLayoutReady: vi.fn((cb: () => void) => cb()),
    on: vi.fn(() => ({})),
    ...over,
  };
}

export const settings = (over: (s: any) => void = () => {}) => {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  over(s);
  return s;
};

/** A vault in memory plus a workspace that records the handlers registered on it, for loading the whole plugin. */
export function fakeApp() {
  const files = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p) || binary.has(p) || dirs.has(p)),
    read: vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p)!;
    }),
    write: vi.fn(async (p: string, t: string) => void files.set(p, t)),
    readBinary: vi.fn(async (p: string) => {
      const b = binary.get(p);
      if (!b) throw new Error(`ENOENT ${p}`);
      return b.slice().buffer;
    }),
    writeBinary: vi.fn(async (p: string, d: ArrayBuffer) => void binary.set(p, new Uint8Array(d))),
    mkdir: vi.fn(async (p: string) => void dirs.add(p)),
    remove: vi.fn(async (p: string) => void (files.delete(p), binary.delete(p))),
    rename: vi.fn(async (a: string, b: string) => {
      if (files.has(a)) files.set(b, files.get(a)!);
      if (binary.has(a)) binary.set(b, binary.get(a)!);
      files.delete(a);
      binary.delete(a);
    }),
    list: vi.fn(async () => ({ files: [...files.keys()], folders: [] })),
    stat: vi.fn(async () => null),
  };
  const storage = new Map<string, string>();
  const vaultHandlers: Array<{ name: string; cb: (...a: any[]) => unknown }> = [];
  const workspaceHandlers: Array<{ name: string; cb: (...a: any[]) => unknown }> = [];
  const layoutReady: Array<() => void> = [];
  const ws = workspace({}, {
    on: vi.fn((name: string, cb: (...a: any[]) => unknown) => {
      const ref = { name, cb };
      workspaceHandlers.push(ref);
      return ref;
    }),
    onLayoutReady: vi.fn((cb: () => void) => void layoutReady.push(cb)),
  });
  const app: any = {
    vault: {
      configDir: ".obsidian",
      adapter,
      on: vi.fn((name: string, cb: (...a: any[]) => unknown) => {
        const ref = { name, cb };
        vaultHandlers.push(ref);
        return ref;
      }),
      getAbstractFileByPath: vi.fn(() => null),
      getMarkdownFiles: vi.fn(() => []),
      cachedRead: vi.fn(async () => ""),
    },
    workspace: ws,
    metadataCache: { getFirstLinkpathDest: vi.fn(() => null) },
    fileManager: { trashFile: vi.fn(async () => {}) },
    plugins: { disablePlugin: vi.fn(async () => {}) },
    loadLocalStorage: vi.fn((k: string) => storage.get(k) ?? null),
    saveLocalStorage: vi.fn((k: string, v: string | null) => void (v === null ? storage.delete(k) : storage.set(k, v))),
    setting: undefined,
  };
  return { app, files, binary, adapter, storage, vaultHandlers, workspaceHandlers, layoutReady };
}
