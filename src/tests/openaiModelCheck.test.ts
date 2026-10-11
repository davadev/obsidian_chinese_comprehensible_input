import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FAIL_WITHIN_DAYS,
  classifyCatalog,
  classifyModel,
  parseModelId,
  worst,
} from "../../scripts/lib/openaiModelCheck.mjs";

/** #116: the early warning before our hardcoded model is shut down. */

const NOW = Date.parse("2026-10-11T00:00:00Z");
const inDays = (d: number) => new Date(NOW + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe("parseModelId", () => {
  it("reads the id we actually ship", () => {
    const id = parseModelId(readFileSync("src/ai/openaiProfile.ts", "utf8"));
    expect(id).toMatch(/^[\w.-]+$/);
  });

  it("returns null when the constant is gone, rather than guessing", () => {
    expect(parseModelId('export const OTHER = "x";')).toBeNull();
  });
});

describe("classifyModel", () => {
  it("fails when the model is gone", () => {
    expect(classifyModel({ status: 404, body: null, now: NOW }).level).toBe("fail");
  });

  it("fails on a rejected key, and says so", () => {
    for (const status of [401, 403]) {
      const r = classifyModel({ status, body: null, now: NOW });
      expect(r.level).toBe("fail");
      expect(r.message).toContain("API key");
    }
  });

  it("fails on any other unexpected status", () => {
    expect(classifyModel({ status: 500, body: null, now: NOW }).level).toBe("fail");
  });

  it("passes when shutdown_date is null, absent, or the body is not an object", () => {
    expect(classifyModel({ status: 200, body: { shutdown_date: null }, now: NOW }).level).toBe("pass");
    expect(classifyModel({ status: 200, body: { id: "m" }, now: NOW }).level).toBe("pass");
    expect(classifyModel({ status: 200, body: null, now: NOW }).level).toBe("pass");
  });

  it("fails a shutdown inside the window and warns on one further out", () => {
    expect(classifyModel({ status: 200, body: { shutdown_date: inDays(FAIL_WITHIN_DAYS) }, now: NOW }).level).toBe("fail");
    expect(classifyModel({ status: 200, body: { shutdown_date: inDays(FAIL_WITHIN_DAYS + 1) }, now: NOW }).level).toBe("warn");
    expect(classifyModel({ status: 200, body: { shutdown_date: inDays(-5) }, now: NOW }).level).toBe("fail");
  });

  it("fails on a shutdown_date it cannot read", () => {
    expect(classifyModel({ status: 200, body: { shutdown_date: "soon" }, now: NOW }).level).toBe("fail");
  });
});

describe("classifyCatalog", () => {
  it("passes when listed", () => {
    expect(classifyCatalog({ status: 200, body: { data: [{ id: "m" }] }, modelId: "m" }).level).toBe("pass");
  });

  it("only warns when the model has left the catalog (it can stay callable for months)", () => {
    expect(classifyCatalog({ status: 200, body: { data: [{ id: "other" }, null] }, modelId: "m" }).level).toBe("warn");
    expect(classifyCatalog({ status: 200, body: {}, modelId: "m" }).level).toBe("warn");
  });

  it("only warns when the catalog itself cannot be read", () => {
    expect(classifyCatalog({ status: 500, body: null, modelId: "m" }).level).toBe("warn");
  });
});

describe("worst", () => {
  it("picks the most severe, treating skip like pass", () => {
    const pass = { level: "pass", message: "" };
    const warn = { level: "warn", message: "" };
    const fail = { level: "fail", message: "" };
    expect(worst([pass, warn]).level).toBe("warn");
    expect(worst([warn, fail, pass]).level).toBe("fail");
    expect(worst([{ level: "skip", message: "" }, pass]).level).toBe("skip");
  });
});
