import { describe, it, expect } from "vitest";
import {
  OPENAI_BASE_URL,
  OPENAI_LEGACY_MODEL_ID,
  OPENAI_MODELS,
  OPENAI_MODEL_ID,
  buildOpenAiActiveConfig,
  computeOpenAiCostUsd,
  openAiExtraBody,
  priceForModel,
  resolveOpenAiChoice,
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

  it("picks the previous model for 'legacy' and the current one for everything else", () => {
    expect(buildOpenAiActiveConfig("k", "legacy").chatModel).toBe(OPENAI_LEGACY_MODEL_ID);
    for (const junk of ["default", "", "gpt-9", undefined, null, 3]) {
      expect(buildOpenAiActiveConfig("k", junk).chatModel).toBe(OPENAI_MODEL_ID);
    }
  });
});

describe("the two models", () => {
  it("are different models, the default is the cheaper one, and both are plain string ids the shutdown check can read", () => {
    expect(OPENAI_MODEL_ID).not.toBe(OPENAI_LEGACY_MODEL_ID);
    expect(OPENAI_MODELS.default.id).toBe(OPENAI_MODEL_ID);
    expect(OPENAI_MODELS.legacy.id).toBe(OPENAI_LEGACY_MODEL_ID);
    expect(OPENAI_MODELS.default.price.output).toBeLessThan(OPENAI_MODELS.legacy.price.output);
  });

  it("only the new model asks for reasoning to be off; the previous one sends exactly what it always did", () => {
    expect(openAiExtraBody(OPENAI_MODEL_ID)).toEqual({ reasoning_effort: "none" });
    expect(openAiExtraBody(OPENAI_LEGACY_MODEL_ID)).toEqual({});
    expect(openAiExtraBody("something-hand-edited")).toEqual({});
  });

  it("resolveOpenAiChoice defaults anything unknown", () => {
    expect(resolveOpenAiChoice("legacy")).toBe("legacy");
    expect(resolveOpenAiChoice("default")).toBe("default");
    expect(resolveOpenAiChoice(undefined)).toBe("default");
  });
});

describe("computeOpenAiCostUsd", () => {
  it("returns 0 for an empty bucket", () => {
    expect(computeOpenAiCostUsd({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("matches the per-story estimate quoted in docs/openai-setup.md", () => {
    // 2100 input × $0.10/1M + 1200 output × $0.50/1M = 0.00021 + 0.0006 = $0.00081.
    const cost = computeOpenAiCostUsd({ inputTokens: 2100, cachedInputTokens: 0, outputTokens: 1200 }, OPENAI_MODEL_ID);
    expect(cost).toBeCloseTo(0.00081, 6);
    // The same story on the previous model: 2100 × 0.75 + 1200 × 4.50 = $0.006975.
    expect(computeOpenAiCostUsd({ inputTokens: 2100, cachedInputTokens: 0, outputTokens: 1200 }, OPENAI_LEGACY_MODEL_ID)).toBeCloseTo(0.006975, 6);
  });

  it("prices an entry logged before models were recorded, or with an unknown id, at the previous default", () => {
    expect(priceForModel(undefined)).toBe(OPENAI_MODELS.legacy.price);
    expect(priceForModel("unknown")).toBe(OPENAI_MODELS.legacy.price);
    expect(priceForModel(OPENAI_MODEL_ID)).toBe(OPENAI_MODELS.default.price);
  });

  it("bills cached input at the 10x discount", () => {
    const p = OPENAI_MODELS.default.price;
    const full = computeOpenAiCostUsd({ inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 }, OPENAI_MODEL_ID);
    const cached = computeOpenAiCostUsd({ inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 }, OPENAI_MODEL_ID);
    expect(full).toBeCloseTo(p.input, 4);
    expect(cached).toBeCloseTo(p.cachedInput, 4);
    expect(full / cached).toBeCloseTo(10, 1);
  });

  it("sums the three buckets correctly", () => {
    const p = OPENAI_MODELS.default.price;
    const cost = computeOpenAiCostUsd({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 }, OPENAI_MODEL_ID);
    expect(cost).toBeCloseTo(p.input + p.cachedInput + p.output, 4);
  });
});
