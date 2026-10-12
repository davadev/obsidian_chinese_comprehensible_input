// Bundled by scripts/mnemonic-compare.mjs: the plugin's real request builder and mnemonic prompts.
import { AiProviderService } from "../../src/ai/AiProviderService";
import { MnemonicService } from "../../src/ai/MnemonicService";
import {
  DEFAULT_MNEMONIC_USER_TEMPLATE,
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  buildMnemonicUserPrompt,
} from "../../src/ai/prompts";
import { HSK_MAP } from "../../src/dictionary/hskMap.generated";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import { graphemeLength } from "../../src/vocabulary/mnemonicText";

export {
  DEFAULT_MNEMONIC_USER_TEMPLATE,
  HSK_MAP,
  MNEMONIC_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
  buildMnemonicUserPrompt,
  graphemeLength,
};

export function makeAi(apiKey, choice, onUsage) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ai.enabled = true;
  settings.ai.provider = "openai";
  settings.ai.openaiModel = choice;
  const app = { loadLocalStorage: () => apiKey };
  return new AiProviderService(() => settings.ai, app, () => "", onUsage);
}

// The plugin's real mnemonic service, for the "plugin" arm: the same code path a learner's tap takes.
export function makeMnemonic(apiKey, choice, onUsage) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.ai.enabled = true;
  settings.ai.provider = "openai";
  settings.ai.openaiModel = choice;
  const app = { loadLocalStorage: () => apiKey };
  const ai = new AiProviderService(() => settings.ai, app, () => "", onUsage);
  return new MnemonicService(ai, () => settings);
}
