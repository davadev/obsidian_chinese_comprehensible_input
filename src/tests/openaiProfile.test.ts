import { describe, it, expect } from "vitest";
import {
  buildOpenAiActiveConfig,
  computeOpenAiCostUsd,
  OPENAI_BASE_URL,
  OPENAI_MODEL_ID,
  OPENAI_PRICE_PER_1M,
} from "../ai/openaiProfile";

describe("buildOpenAiActiveConfig", () => {
  it("injects the API key and pins every other field to the hardcoded profile", () => {
    const cfg = buildOpenAiActiveConfig("sk-test-123");
    expect(cfg.apiKey).toBe("sk-test-123");
    expect(cfg.baseUrl).toBe(OPENAI_BASE_URL);
    expect(cfg.chatModel).toBe(OPENAI_MODEL_ID);
    expect(cfg.endpointMode).toBe("chat");
    expect(cfg.responseFormat).toBe("json_object");
    expect(cfg.stream).toBe(true);
    expect(cfg.suppressThinking).toBe(false);
    expect(cfg.embeddingModel).toBe("");
  });

  it("accepts an empty key (used by Test connection before paste)", () => {
    const cfg = buildOpenAiActiveConfig("");
    expect(cfg.apiKey).toBe("");
    expect(cfg.baseUrl).toBe(OPENAI_BASE_URL);
  });
});

describe("computeOpenAiCostUsd", () => {
  it("returns 0 for an empty bucket", () => {
    expect(computeOpenAiCostUsd({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("matches the per-story estimate quoted in docs/openai-setup.md", () => {
    // 2100 input × $0.75/1M + 1200 output × $4.50/1M = 0.001575 + 0.0054 = $0.006975.
    const cost = computeOpenAiCostUsd({ inputTokens: 2100, cachedInputTokens: 0, outputTokens: 1200 });
    expect(cost).toBeCloseTo(0.006975, 4);
  });

  it("bills cached input at the 10x discount", () => {
    const full = computeOpenAiCostUsd({ inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 });
    const cached = computeOpenAiCostUsd({ inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 });
    expect(full).toBeCloseTo(OPENAI_PRICE_PER_1M.input, 4);
    expect(cached).toBeCloseTo(OPENAI_PRICE_PER_1M.cachedInput, 4);
    expect(full / cached).toBeCloseTo(10, 1);
  });

  it("sums the three buckets correctly", () => {
    const cost = computeOpenAiCostUsd({
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(
      OPENAI_PRICE_PER_1M.input + OPENAI_PRICE_PER_1M.cachedInput + OPENAI_PRICE_PER_1M.output,
      4
    );
  });
});
