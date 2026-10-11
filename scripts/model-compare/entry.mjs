// Bundled by scripts/model-compare.mjs: the plugin's real request builder and prompts, plus the HSK list for metrics.
import { AiProviderService } from "../../src/ai/AiProviderService";
import { EnhanceDictionaryService } from "../../src/ai/EnhanceDictionaryService";
import { STORY_SCHEMA, STORY_SYSTEM_PROMPT, buildRepairPrompt, buildUserPrompt } from "../../src/ai/prompts";
import { HSK_MAP } from "../../src/dictionary/hskMap.generated";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

export { HSK_MAP, STORY_SCHEMA, STORY_SYSTEM_PROMPT, buildRepairPrompt, buildUserPrompt };

export function makeServices(apiKey, choice, onUsage) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ai.enabled = true;
  settings.ai.provider = "openai";
  settings.ai.openaiModel = choice;
  const app = { loadLocalStorage: () => apiKey };
  const ai = new AiProviderService(() => settings.ai, app, () => "", onUsage);
  return { ai, enhance: new EnhanceDictionaryService(ai, () => settings) };
}
