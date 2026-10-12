// Bundled by scripts/explain-try.mjs: the plugin's real dictionary, input assembly, Explain service and renderer.
import { AiProviderService } from "../../src/ai/AiProviderService";
import { ExplainService } from "../../src/ai/ExplainService";
import { PhraseExplainService } from "../../src/ai/PhraseExplainService";
import { ProofreadService } from "../../src/ai/ProofreadService";
import { phraseFileName, prepareSelection, renderPhraseMarkdown } from "../../src/ai/phrase";
import { applyCorrections, locateCorrections } from "../../src/ai/proofread";
import { explainBlocks, explainFileName, renderExplainMarkdown } from "../../src/ai/explain";
import { explainInputFor, explainKey } from "../../src/ai/explainNotes";
import { parseCedict } from "../../src/dictionary/DictionaryDownloader";
import { DictionaryService } from "../../src/dictionary/DictionaryService";
import { countTraditionalMarkers } from "../../src/dictionary/scriptDetect";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

export {
  applyCorrections,
  explainBlocks,
  explainFileName,
  explainInputFor,
  explainKey,
  locateCorrections,
  parseCedict,
  phraseFileName,
  prepareSelection,
  renderExplainMarkdown,
  renderPhraseMarkdown,
};

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

/** The phrase services (explain and proof read) on the same settings, for the phrase and proof modes of the trial. */
export function makePhrase(apiKey, choice, onUsage) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ai.enabled = true;
  settings.ai.provider = "openai";
  settings.ai.openaiModel = choice;
  const app = { loadLocalStorage: () => apiKey };
  const ai = new AiProviderService(() => settings.ai, app, () => "", onUsage);
  return { phrase: new PhraseExplainService(ai), proof: new ProofreadService(ai) };
}
