import { describe, it, expect } from "vitest";
import { migrateAiSettingsToV2 } from "../settings/migrations";

describe("migrateAiSettingsToV2", () => {
  it("folds v1 flat ai.* fields into ai.ollama.*", () => {
    const v1 = {
      ai: {
        enabled: true,
        providerName: "Ollama (Tailscale)",
        baseUrl: "http://nuc.tail:11434/v1",
        apiKey: "sk-legacy-12345",
        chatModel: "qwen2.5:14b",
        endpointMode: "ollama",
        temperature: 0.5,
        maxOutputTokens: 12000,
        timeoutMs: 600000,
        maxRepairIterations: 5,
        responseFormat: "json_object",
        suppressThinking: false,
        stream: true,
        debug: false,
      },
    } as any;
    const { migrated, rescuedOllamaApiKey } = migrateAiSettingsToV2(v1);
    const ai = (migrated.ai ?? {}) as any;
    expect(ai.provider).toBe("ollama");
    expect(ai.ollama.baseUrl).toBe("http://nuc.tail:11434/v1");
    expect(ai.ollama.chatModel).toBe("qwen2.5:14b");
    expect(ai.ollama.endpointMode).toBe("ollama");
    expect(ai.ollama.temperature).toBe(0.5);
    expect(ai.ollama.maxRepairIterations).toBe(5);
    expect(ai.ollama.apiKey).toBe("");
    expect(ai.usageLog).toEqual([]);
    expect(rescuedOllamaApiKey).toBe("sk-legacy-12345");
    expect((ai as any).providerName).toBeUndefined();
    expect((ai as any).baseUrl).toBeUndefined();
  });

  it("is idempotent on already-v2 blobs without apiKey", () => {
    const v2 = {
      ai: {
        enabled: true,
        provider: "openai",
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "",
          chatModel: "qwen2.5:7b",
          embeddingModel: "",
          endpointMode: "chat",
          temperature: 0.6,
          maxOutputTokens: 8000,
          timeoutMs: 300000,
          maxRepairIterations: 4,
          responseFormat: "json_object",
          suppressThinking: true,
          stream: true,
        },
        usageLog: [],
        debug: false,
      },
    } as any;
    const { migrated, rescuedOllamaApiKey } = migrateAiSettingsToV2(v2);
    expect(migrated).toBe(v2);
    expect(rescuedOllamaApiKey).toBeNull();
  });

  it("rescues a v2 ai.ollama.apiKey if it slipped in", () => {
    const v2 = {
      ai: {
        enabled: false,
        provider: "ollama",
        ollama: {
          baseUrl: "http://x/v1",
          apiKey: "sk-leak",
          chatModel: "x",
          embeddingModel: "",
          endpointMode: "chat",
          temperature: 0.6,
          maxOutputTokens: 8000,
          timeoutMs: 300000,
          maxRepairIterations: 4,
          responseFormat: "json_object",
          suppressThinking: true,
          stream: true,
        },
        usageLog: [],
        debug: false,
      },
    } as any;
    const { migrated, rescuedOllamaApiKey } = migrateAiSettingsToV2(v2);
    expect(rescuedOllamaApiKey).toBe("sk-leak");
    expect(((migrated.ai ?? {}) as any).ollama.apiKey).toBe("");
  });

  it("handles a missing ai entirely", () => {
    const blank = {} as any;
    const { migrated } = migrateAiSettingsToV2(blank);
    const ai = (migrated.ai ?? {}) as any;
    expect(ai.provider).toBe("ollama");
    expect(ai.ollama.apiKey).toBe("");
    expect(ai.usageLog).toEqual([]);
  });
});
