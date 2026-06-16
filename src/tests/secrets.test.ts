import { describe, expect, it, vi } from "vitest";
import { loadApiKey, saveApiKey } from "../ai/secrets";

describe("ai secrets", () => {
  it("loadApiKey returns stored string or empty string", () => {
    const app = {
      loadLocalStorage: vi.fn((key: string) => (key.endsWith("openai") ? "sk-live" : 123)),
    } as any;
    expect(loadApiKey(app, "openai")).toBe("sk-live");
    expect(loadApiKey(app, "ollama")).toBe("");
  });

  it("saveApiKey persists non-empty keys and clears empty ones", () => {
    const app = { saveLocalStorage: vi.fn() } as any;
    saveApiKey(app, "openai", "sk-live");
    saveApiKey(app, "openai", "");
    expect(app.saveLocalStorage).toHaveBeenNthCalledWith(1, "cci-ai-apikey-openai", "sk-live");
    expect(app.saveLocalStorage).toHaveBeenNthCalledWith(2, "cci-ai-apikey-openai", null);
  });
});
