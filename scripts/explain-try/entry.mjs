// Bundled by scripts/explain-try.mjs: the plugin's real dictionary, input assembly, Explain service and renderer.
import { AiProviderService } from "../../src/ai/AiProviderService";
import { ExplainService } from "../../src/ai/ExplainService";
import { explainBlocks, explainFileName, renderExplainMarkdown } from "../../src/ai/explain";
import { explainInputFor, explainKey } from "../../src/ai/explainNotes";
import { parseCedict } from "../../src/dictionary/DictionaryDownloader";
import { DictionaryService } from "../../src/dictionary/DictionaryService";
import { countTraditionalMarkers } from "../../src/dictionary/scriptDetect";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

export { explainBlocks, explainFileName, explainInputFor, explainKey, parseCedict, renderExplainMarkdown };

/** A dictionary loaded from CC-CEDICT text, through the same DictionaryService the plugin uses. */
export async function makeDictionary(cedictText) {
  const { entries } = parseCedict(cedictText);
  const adapter = { exists: async () => true, read: async () => JSON.stringify(entries) };
  const dict = new DictionaryService({ vault: { adapter } });
  await dict.ensureLoaded();
  return { dict, countTraditionalMarkers: (t) => countTraditionalMarkers(t, dict) };
}

export function makeExplain(apiKey, choice, onUsage) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ai.enabled = true;
  settings.ai.provider = "openai";
  settings.ai.openaiModel = choice;
  const app = { loadLocalStorage: () => apiKey };
  const ai = new AiProviderService(() => settings.ai, app, () => "", onUsage);
  return new ExplainService(ai);
}
