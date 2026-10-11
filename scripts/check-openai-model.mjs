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
import { classifyCatalog, classifyModel, parseModelId, worst } from "./lib/openaiModelCheck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, "src/ai/openaiProfile.ts");
const API = "https://api.openai.com/v1";

const modelId = parseModelId(readFileSync(profile, "utf8"));
if (!modelId) {
  console.error("Could not find OPENAI_MODEL_ID in src/ai/openaiProfile.ts");
  process.exit(2);
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log(`No OPENAI_API_KEY in the environment: skipping the check for ${modelId}.`);
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

const model = classifyModel({ ...(await get(`${API}/models/${encodeURIComponent(modelId)}`)), now: Date.now() });
const catalog = classifyCatalog({ ...(await get(`${API}/models`)), modelId });
const result = worst([model, catalog]);

const lines = [`Model \`${modelId}\``, `- shutdown: **${model.level}** — ${model.message}`, `- catalog: **${catalog.level}** — ${catalog.message}`];
for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");

if (result.level === "warn") console.log(`::warning title=OpenAI model ${modelId}::${result.message}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `level=${result.level}\nmodel=${modelId}\n`);
}
process.exit(result.level === "fail" ? 1 : 0);
