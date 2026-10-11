import { describe, it, expect } from "vitest";
import {
  VARIANTS,
  applyVariant,
  checkStoryJson,
  costUsd,
  markdownTable,
  missingTargets,
  parseModelSpec,
  safeError,
} from "../../scripts/lib/modelEval.mjs";

/** The model-eval harness (#115): the parts that decide what counts as a pass, and what must never be printed. */

describe("parseModelSpec", () => {
  it("reads id:input:output with cached defaulting to 0", () => {
    expect(parseModelSpec("m:0.1:0.5")).toEqual({ id: "m", input: 0.1, output: 0.5, cached: 0 });
    expect(parseModelSpec(" m:1:2:0.5 ")).toEqual({ id: "m", input: 1, output: 2, cached: 0.5 });
  });

  it("refuses a missing or bad price rather than guessing a cost", () => {
    expect(() => parseModelSpec("m")).toThrow(/Bad input price/);
    expect(() => parseModelSpec("m:1")).toThrow(/Bad output price/);
    expect(() => parseModelSpec("m:1:x")).toThrow(/Bad output price/);
    expect(() => parseModelSpec("m:-1:2")).toThrow(/Bad input price/);
    expect(() => parseModelSpec(":1:2")).toThrow(/Missing model id/);
  });
});

describe("costUsd", () => {
  it("bills the three buckets per million tokens", () => {
    const price = { id: "m", input: 0.1, output: 0.5, cached: 0.01 };
    expect(costUsd(price, { inputTokens: 2100, cachedInputTokens: 0, outputTokens: 1200 })).toBeCloseTo(0.00081, 6);
    expect(costUsd(price, { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.01, 6);
  });
});

describe("applyVariant", () => {
  const body = { model: "m", temperature: 0.2, max_completion_tokens: 8000, response_format: { type: "json_object" } };

  it("default leaves the body as the plugin built it", () => {
    expect(applyVariant(body, "default")).toEqual(body);
  });

  it("adds and drops fields without touching the original", () => {
    const out = applyVariant(body, "effort-none-no-temperature");
    expect(out).toMatchObject({ reasoning_effort: "none" });
    expect(out).not.toHaveProperty("temperature");
    expect(body).toHaveProperty("temperature");
  });

  it("json-schema swaps the response format for the task's schema", () => {
    const out = applyVariant(body, "json-schema", { type: "object" }) as any;
    expect(out.response_format).toEqual({ type: "json_schema", json_schema: { name: "Eval", schema: { type: "object" }, strict: true } });
  });

  it("rejects an unknown variant by name", () => {
    expect(() => applyVariant(body, "nope")).toThrow(/Unknown variant "nope"/);
    expect(Object.keys(VARIANTS)).toContain("default");
  });
});

describe("story checks", () => {
  it("lists the target words the text does not contain", () => {
    expect(missingTargets("我去图书馆", ["图书馆", "邻居"])).toEqual(["邻居"]);
    expect(missingTargets("x", [])).toEqual([]);
  });

  it("accepts a story with a body and names why it rejected the rest", () => {
    expect(checkStoryJson('{"title":"T","textChinese":"你好"}').ok).toBe(true);
    expect(checkStoryJson("{oops")).toEqual({ ok: false, reason: "not valid JSON" });
    expect(checkStoryJson("null")).toEqual({ ok: false, reason: "not an object" });
    expect(checkStoryJson('{"textChinese":"  "}')).toEqual({ ok: false, reason: "no textChinese" });
    expect(checkStoryJson('{"text":"x"}')).toEqual({ ok: false, reason: "no textChinese" });
  });
});

describe("safeError", () => {
  it("never lets an API key through, and keeps one line", () => {
    const msg = safeError(new Error("AI provider HTTP 401: Incorrect API key provided: sk-proj-abcdefghijkl1234.\nsecond line"));
    expect(msg).not.toContain("sk-proj-abcdefghijkl1234");
    expect(msg).toContain("sk-…");
    expect(msg).not.toContain("second line");
  });

  it("copes with a thrown string and truncates", () => {
    expect(safeError("plain")).toBe("plain");
    expect(safeError("x".repeat(1000)).length).toBe(400);
  });
});

describe("markdownTable", () => {
  it("renders a header, a rule and one line per row, blank for a missing cell", () => {
    const t = markdownTable([{ model: "m", variant: "default", task: "story", result: "ok" }]);
    const lines = t.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("| model | variant | task | result |");
    expect(lines[2]).toMatch(/^\| m \| default \| story \| ok \|/);
  });
});
