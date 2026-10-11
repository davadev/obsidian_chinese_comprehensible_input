#!/usr/bin/env node
/**
 * Runs the plugin's real story and dictionary-enhancement prompts against candidate OpenAI models, so a model
 * migration (#115) is decided on evidence instead of on a pricing table.
 *
 *   OPENAI_API_KEY=... node scripts/model-eval.mjs --models gpt-x:0.10:0.50:0.01,gpt-y:0.2:1.2 \
 *       --variants default,effort-none --runs 3 [--choice default|legacy]
 *
 * It bundles the real AiProviderService (the request builder), prompts and EnhanceDictionaryService with `obsidian`
 * swapped for a tiny shim, so an `unsupported_parameter` 400 here is a 400 a user would hit. `--variants` patches the
 * outgoing body to try parameter combinations the code does not send yet (see scripts/lib/modelEval.mjs).
 *
 * Costs real money (cents). Run it only from .github/workflows/model-eval.yml or with a capped, throwaway key.
 * The key is read from the environment, sent only to api.openai.com, and never printed; stories go to the summary and
 * an artifact so a person can judge quality, which no script can.
 */
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import {
  VARIANTS,
  applyVariant,
  checkStoryJson,
  costUsd,
  markdownTable,
  missingTargets,
  parseModelSpec,
  safeError,
} from "./lib/modelEval.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log("No OPENAI_API_KEY in the environment: nothing to evaluate.");
  process.exit(0);
}

if (process.argv.includes("--list")) {
  // Candidate discovery: the catalog as the API sees it today. Pricing is not in the API; read the pricing page.
  const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`GET /v1/models failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  const ids = (body.data ?? []).map((m) => m.id).filter((id) => !/embed|whisper|tts|dall|image|moderation|audio|realtime|transcribe|search/i.test(id)).sort();
  const text = `### Chat model candidates in the catalog today\n\n${ids.map((id) => `- \`${id}\``).join("\n")}\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exit(0);
}

const models = String(arg("models", "")).split(",").filter(Boolean).map(parseModelSpec);
if (models.length === 0) {
  console.error("Pass --models id:input:output[:cached],…  (USD per 1M tokens, from the pricing page).");
  process.exit(2);
}
const variants = String(arg("variants", "default")).split(",").filter(Boolean);
for (const v of variants) if (!VARIANTS[v]) {
  console.error(`Unknown variant "${v}". Known: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(2);
}
const runs = Math.max(1, Math.min(5, Number(arg("runs", "3")) || 3));
const hsk = String(arg("hsk", "3"));
// Which of the plugin's two OpenAI profiles the candidate is run as: "default" sends that model's extra body fields
// (reasoning_effort), "legacy" sends none. Evaluate the previous model as "legacy" to get exactly today's request.
const choice = arg("choice", "default") === "legacy" ? "legacy" : "default";
const idConst = choice === "legacy" ? "OPENAI_LEGACY_MODEL_ID" : "OPENAI_MODEL_ID";
const outDir = arg("out", path.join(root, "model-eval-out"));
mkdirSync(outDir, { recursive: true });

// Build the real code into one Node bundle. The model id the profile hardcodes is replaced by an env lookup so one
// bundle serves every candidate; everything else in the profile (endpoint mode, JSON mode, streaming) is untouched.
const bundleDir = mkdtempSync(path.join(tmpdir(), "cci-model-eval-"));
const bundleFile = path.join(bundleDir, "eval.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "scripts/model-eval/entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: bundleFile,
  logLevel: "warning",
  alias: { obsidian: path.join(root, "scripts/model-eval/obsidian-shim.mjs") },
  plugins: [
    {
      name: "env-model",
      setup(build) {
        build.onLoad({ filter: /openaiProfile\.ts$/ }, async (args) => {
          const { readFile } = await import("node:fs/promises");
          const src = await readFile(args.path, "utf8");
          const patched = src.replace(new RegExp(`export const ${idConst} = "[^"]+";`), `export const ${idConst} = process.env.EVAL_MODEL;`);
          if (patched === src) throw new Error(`Could not patch ${idConst} in openaiProfile.ts`);
          return { contents: patched, loader: "ts" };
        });
      },
    },
  ],
});
globalThis.window = globalThis; // the plugin calls window.fetch / window.setTimeout
// OPENAI_MODEL_ID is a module-level constant, read once at import. The bundle is a single file, so a distinct query
// string gives each model its own fresh evaluation of it.
async function loadFor(modelId, n) {
  process.env.EVAL_MODEL = modelId;
  return import(`${pathToFileURL(bundleFile).href}?model=${n}`);
}

// The outgoing-body patch. Installed once; the active variant and schema are set per call below.
let activeVariant = "default";
let activeSchema = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url).startsWith("https://api.openai.com/") && init && typeof init.body === "string") {
    const patched = applyVariant(JSON.parse(init.body), activeVariant, activeSchema);
    init = { ...init, body: JSON.stringify(patched) };
  }
  return realFetch(url, init);
};

// A fixed, HSK-3-ish request so every model and every run gets the same job.
const TARGETS = [
  { word: "图书馆", pinyin: "tú shū guǎn", definition: "library" },
  { word: "忽然", pinyin: "hū rán", definition: "suddenly" },
  { word: "邻居", pinyin: "lín jū", definition: "neighbor" },
  { word: "打算", pinyin: "dǎ suàn", definition: "to plan; to intend" },
  { word: "容易", pinyin: "róng yì", definition: "easy" },
  { word: "关心", pinyin: "guān xīn", definition: "to care about" },
];
const ENHANCE_INPUT = {
  surface: "行",
  pinyin: "xíng",
  currentDefinitions: ["to walk; to go; to travel", "to do", "to perform", "capable; competent", "all right; OK", "(classifier) line; row", "(surname) Xing"],
  sentence: "你觉得这个办法行不行？",
};

const rows = [];
const stories = [];
let totalCost = 0;
for (const [modelIndex, model] of models.entries()) {
  const lib = await loadFor(model.id, modelIndex);
  for (const variant of variants) {
    activeVariant = variant;
    for (let run = 1; run <= runs; run++) {
      const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
      const { ai } = lib.makeServices(key, choice, (u) => {
        usage.inputTokens += u.inputTokens;
        usage.cachedInputTokens += u.cachedInputTokens;
        usage.outputTokens += u.outputTokens;
      });
      const { system, user } = lib.storyPrompts({ style: "story", targetHsk: hsk, targetWords: TARGETS, lengthChars: 400, script: "simplified" });
      activeSchema = lib.STORY_SCHEMA;
      const t0 = Date.now();
      const row = { model: model.id, variant, task: `story ${run}/${runs}` };
      try {
        const raw = await ai.chatJson(system, user, "ChineseStory", lib.STORY_SCHEMA);
        const parsed = checkStoryJson(raw);
        if (!parsed.ok) {
          row.result = `FAIL: ${parsed.reason}`;
        } else {
          const missing = missingTargets(parsed.story.textChinese, TARGETS.map((t) => t.word));
          row.result = "ok";
          row["target words"] = `${TARGETS.length - missing.length}/${TARGETS.length}`;
          stories.push(`## ${model.id} · ${variant} · story ${run}\n\n**${parsed.story.title ?? ""}**\n\n${parsed.story.textChinese}\n\nMissing: ${missing.join("、") || "none"}\n`);
        }
      } catch (err) {
        row.result = `FAIL: ${safeError(err)}`;
      }
      row["tokens in/out"] = `${usage.inputTokens + usage.cachedInputTokens}/${usage.outputTokens}`;
      const c = costUsd(model, usage);
      totalCost += c;
      row.cost = `$${c.toFixed(5)}`;
      row.secs = ((Date.now() - t0) / 1000).toFixed(1);
      rows.push(row);
      console.log(`${row.model} ${row.variant} ${row.task}: ${row.result}`);
    }

    // One dictionary enhancement per model and variant, on a deliberately messy CC-CEDICT gloss.
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    const { enhance } = lib.makeServices(key, choice, (u) => {
      usage.inputTokens += u.inputTokens;
      usage.cachedInputTokens += u.cachedInputTokens;
      usage.outputTokens += u.outputTokens;
    });
    activeSchema = lib.ENHANCE_SCHEMA;
    const t0 = Date.now();
    const row = { model: model.id, variant, task: "enhance 行" };
    try {
      const out = await enhance.enhance(ENHANCE_INPUT);
      row.result = out.definitions.length ? "ok" : "FAIL: no definitions";
      stories.push(`## ${model.id} · ${variant} · enhance 行\n\n${out.definitions.map((d) => `- ${d}`).join("\n")}\n\nGrammar: ${out.grammar ?? "(none)"}\n`);
    } catch (err) {
      row.result = `FAIL: ${safeError(err)}`;
    }
    row["tokens in/out"] = `${usage.inputTokens + usage.cachedInputTokens}/${usage.outputTokens}`;
    const c = costUsd(model, usage);
    totalCost += c;
    row.cost = `$${c.toFixed(5)}`;
    row.secs = ((Date.now() - t0) / 1000).toFixed(1);
    rows.push(row);
    console.log(`${row.model} ${row.variant} ${row.task}: ${row.result}`);
  }
}

const summary = `### Model eval\n\n${markdownTable(rows)}\n\nTotal cost across all calls: **$${totalCost.toFixed(4)}**. Stories are in the \`model-eval-out\` artifact: read them, no script judges quality.\n`;
writeFileSync(path.join(outDir, "stories.md"), `# Generated output\n\n${stories.join("\n")}`);
writeFileSync(path.join(outDir, "summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
