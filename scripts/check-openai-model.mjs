#!/usr/bin/env node
/**
 * Warns before the OpenAI model we hardcode reaches its shutdown date (#116).
 *
 *   OPENAI_API_KEY=... node scripts/check-openai-model.mjs
 *
 * Deliberately NOT part of `npm run check-release`, which must stay offline and deterministic: this needs the network
 * and a billable credential, and a shutdown months away must never hold back a user-facing fix. It runs from
 * .github/workflows/model-lifecycle.yml instead.
 *
 * The key is read from the environment only, sent only to api.openai.com, and never printed.
 * Without a key it skips (exit 0), so forks and a revoked key never turn a run red.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { capAtWarn, classifyCatalog, classifyModel, parseModelIds, worst } from "./lib/openaiModelCheck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, "src/ai/openaiProfile.ts");
const API = "https://api.openai.com/v1";

const ids = parseModelIds(readFileSync(profile, "utf8"));
if (!ids.default || !ids.legacy) {
  console.error("Could not find OPENAI_MODEL_ID and OPENAI_LEGACY_MODEL_ID in src/ai/openaiProfile.ts");
  process.exit(2);
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log(`No OPENAI_API_KEY in the environment: skipping the check for ${ids.default} and ${ids.legacy}.`);
  process.exit(0);
}

async function get(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON body is classified by status alone.
  }
  return { status: res.status, body };
}

const catalogAnswer = await get(`${API}/models`);
const results = [];
const lines = [];
for (const [role, modelId] of [["default", ids.default], ["legacy", ids.legacy]]) {
  const model = classifyModel({ ...(await get(`${API}/models/${encodeURIComponent(modelId)}`)), now: Date.now() });
  const catalog = classifyCatalog({ ...catalogAnswer, modelId });
  // The default model is what every user gets: it can fail the run. The legacy one is an opt-in fallback: warn only.
  const shutdown = role === "default" ? model : capAtWarn(model);
  results.push(shutdown, catalog);
  lines.push(`Model \`${modelId}\` (${role})`, `- shutdown: **${shutdown.level}** — ${shutdown.message}`, `- catalog: **${catalog.level}** — ${catalog.message}`);
}
const result = worst(results);
for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");

if (result.level === "warn") console.log(`::warning title=OpenAI model::${result.message}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `level=${result.level}\nmodel=${ids.default}\n`);
}
process.exit(result.level === "fail" ? 1 : 0);
