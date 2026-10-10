import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The coverage gate is a ratchet: it only ever goes up. These tests keep the part of it that can be checked
 * without running coverage from being loosened by accident, and keep the rule "dead code is deleted, never
 * hidden from the report".
 */

const root = path.resolve(import.meta.dirname, "../..");
const config = readFileSync(path.join(root, "vitest.config.mts"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "tests" ? [] : sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("coverage gate", () => {
  it("fails CI below 100 on every metric", () => {
    const block = /thresholds:\s*\{([^}]*)\}/.exec(config)![1];
    for (const metric of ["lines", "functions", "branches", "statements"]) {
      expect(block, metric).toMatch(new RegExp(`${metric}:\\s*100\\b`));
    }
  });

  it("has no coverage-ignore comments in the source: unreachable code is deleted, not hidden", () => {
    const offenders = sourceFiles(path.join(root, "src")).filter((f) => /\/\*\s*(?:v8|c8|istanbul)\s+ignore/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("measures the pure type files and prompts.ts (they were once excluded by mistake)", () => {
    for (const f of ["src/ai/prompts.ts", "src/settings/types.ts", "src/vocabulary/VocabularyTypes.ts", "src/tokenizer/tokenizerTypes.ts", "src/dictionary/DictionaryTypes.ts", "src/ai/aiTypes.ts"]) {
      expect(config, f).not.toContain(`"${f}"`);
    }
  });
});
