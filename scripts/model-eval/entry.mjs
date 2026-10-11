// Bundled by scripts/model-eval.mjs. Imports the plugin's REAL request builder and prompts, so the body that goes to
// OpenAI is the body a user's Obsidian would send (apart from the optional variant patch).
import { AiProviderService } from "../../src/ai/AiProviderService";
import { EnhanceDictionaryService } from "../../src/ai/EnhanceDictionaryService";
import { STORY_SCHEMA, STORY_SYSTEM_PROMPT, buildEnhanceSchema, buildUserPrompt } from "../../src/ai/prompts";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

export const ENHANCE_SCHEMA = buildEnhanceSchema(false);
export { STORY_SCHEMA };

export function makeServices(apiKey, choice, onUsage) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ai.enabled = true;
  settings.ai.provider = "openai";
  settings.ai.openaiModel = choice;
  const app = { loadLocalStorage: () => apiKey };
  const ai = new AiProviderService(() => settings.ai, app, () => "", onUsage);
  const enhance = new EnhanceDictionaryService(ai, () => settings);
  return { ai, enhance, active: () => ai.resolveActive() };
}

export function storyPrompts(args) {
  return { system: STORY_SYSTEM_PROMPT, user: buildUserPrompt(args) };
}
export { STORY_SYSTEM_PROMPT };
