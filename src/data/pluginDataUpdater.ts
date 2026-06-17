import type { CciSettings } from "../settings/types";
import type {
  DictionaryCustomWords,
  DictionaryOverrides,
} from "../dictionary/DictionaryTypes";

/**
 * Structural shape of the plugin's persisted data blob. Obsidian's
 * `Plugin.loadData()` is typed as `any`, which cascades the `any` taint
 * into every reader. Casting to this interface at the loadData boundary
 * gives every downstream property access a real type and silences the
 * `@typescript-eslint/no-unsafe-*` cluster without per-call casts.
 *
 * The `[key: string]: unknown` index signature keeps the type forward-
 * compatible with future bookkeeping fields the plugin may stash here.
 */
export interface PluginDataBlob {
  __autoDisabled?: boolean;
  __crashCounter?: number;
  __autoStoryLastSuccessDate?: string;
  __autoStoryLastAttemptAt?: string;
  __settingsTouchedAt?: string;
  settings?: Partial<CciSettings>;
  dictionaryOverrides?: DictionaryOverrides;
  dictionaryCustomWords?: DictionaryCustomWords;
  vocab?: unknown;
  [key: string]: unknown;
}

export type PluginDataMutation = (
  blob: PluginDataBlob
) => void | Promise<void>;

export function createQueuedDataBlobUpdater(
  loadData: () => Promise<PluginDataBlob | null | undefined>,
  saveData: (blob: PluginDataBlob) => Promise<void>
): (mutate: PluginDataMutation) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  return async (mutate: PluginDataMutation): Promise<void> => {
    const run = tail.catch(() => {}).then(async () => {
      const blob = (await loadData()) ?? {};
      await mutate(blob);
      await saveData(blob);
    });
    tail = run;
    await run;
  };
}
