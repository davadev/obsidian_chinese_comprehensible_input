import type { PronunciationRegion, ScriptVariant } from "./types";

export interface ScriptState {
  script: ScriptVariant;
  region: PronunciationRegion;
}

export interface ScriptChangePlan {
  /** Nothing to do — neither setting moved. */
  noop: boolean;
  /** Rebuild the tokenizer trie and drop surface-lookup caches. Only a
   *  script change alters segmentation; a region change does not. */
  rebuildTrie: boolean;
  /** Drop cached tokens and re-tokenize open views. Needed for BOTH, because
   *  the RubyWidget snapshots its pinyin when it is built, so a region change
   *  cannot be picked up by a plain redecorate either. */
  retokenize: boolean;
  /** Tell the user what happened. Only for a change that arrived from another
   *  device: `scriptVariant` is a shared setting, so flipping it on one device
   *  silently re-segments the reader and switches the flashcard script on every
   *  other one. A change the user just made here needs no announcement. */
  notifyRemote: boolean;
}

/**
 * What has to be thrown away when the script or region setting moves.
 *
 * Pure so it can be tested without standing up the plugin. The decision is
 * easy to get subtly wrong in a way nothing reports: too little invalidation
 * repaints fresh colours over stale segmentation, silently.
 */
export function planScriptChange(
  prev: ScriptState,
  next: ScriptState,
  opts: { remote?: boolean } = {}
): ScriptChangePlan {
  const scriptChanged = prev.script !== next.script;
  const regionChanged = prev.region !== next.region;
  if (!scriptChanged && !regionChanged) {
    return { noop: true, rebuildTrie: false, retokenize: false, notifyRemote: false };
  }
  return {
    noop: false,
    rebuildTrie: scriptChanged,
    retokenize: true,
    notifyRemote: !!opts.remote,
  };
}
