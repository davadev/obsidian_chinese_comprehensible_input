import { vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { ChineseTextFileView } from "../../view/ChineseTextFileView";
import { DEFAULT_SETTINGS } from "../../settings/defaults";
import { putCachedTokens } from "../../tokenizer/tokenCache";

/**
 * A ChineseTextFileView wired to a plain-object plugin, for tests that run under happy-dom (a real `document`, so the
 * toolbar and a real CodeMirror EditorView mount). Everything the view reads from the plugin is here and overridable.
 */

export interface HarnessOptions {
  mode?: string;
  file?: { path: string; basename: string } | null;
  plugin?: Record<string, unknown>;
}

export function makeView(data: string, modeOrOpts: string | HarnessOptions = "read") {
  const opts: HarnessOptions = typeof modeOrOpts === "string" ? { mode: modeOrOpts } : modeOrOpts;
  const state = { mode: opts.mode ?? "read" };
  const root = document.createElement("div");
  const plugin: any = {
    settings: { ...DEFAULT_SETTINGS, story: { ...DEFAULT_SETTINGS.story } },
    app: { workspace: {}, vault: {}, fileManager: { trashFile: vi.fn(async () => {}) } },
    tokenizer: {
      // Like the real service: tokenizing fills the shared cache that the decoration plugin peeks at synchronously.
      tokenize: vi.fn(async (text: string) => {
        putCachedTokens(text, []);
        return [];
      }),
    },
    dictionary: { lookup: () => [] },
    dictionaryCustomWords: {},
    story: { previewPath: () => "none" },
    exposure: { resetSession: vi.fn() },
    vocab: { get: () => undefined },
    activeViewMode: () => state.mode,
    setActiveViewMode: (m: string) => void (state.mode = m),
    computeNoteStats: () => ({}),
    currentNoteKey: () => null,
    maybeSuggestTraditional: vi.fn(),
    saveSettings: vi.fn(async () => {}),
    openStatsView: vi.fn(async () => {}),
    openFileInChineseView: vi.fn(async () => {}),
    ...opts.plugin,
  };
  const view = new ChineseTextFileView({} as any, plugin);
  (view as any).containerEl = { children: [document.createElement("div"), root] };
  (view as any).data = data;
  (view as any).file = opts.file ?? null;
  (view as any).leaf = { setViewState: vi.fn(async () => {}) };
  return { view, root, plugin, state };
}

export const editorOf = (view: ChineseTextFileView) => (view as any).editor as EditorView | null;

/** The header actions the view registered through addAction() (recorded by the obsidian stub). */
export const actionsOf = (view: ChineseTextFileView) =>
  (view as unknown as { actions: Array<{ icon: string; title: string; cb: (evt: unknown) => unknown }> }).actions;
