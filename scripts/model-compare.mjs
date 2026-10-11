#!/usr/bin/env node
/**
 * Head-to-head comparison of the plugin's two OpenAI models on the same jobs (#115): the real story prompts and repair
 * prompts, several scenarios (HSK level, style, script), many runs each, measured with objective metrics, plus the
 * dictionary-enhancement prompt on several words. Stories are also written out BLIND (labelled X / Y, key in a
 * separate file) so a person can read them without knowing which model wrote which.
 *
 *   OPENAI_API_KEY=... node scripts/model-compare.mjs --a gpt-6-luna:0.10:0.50:0.01:default \
 *       --b gpt-5.4-mini:0.75:4.50:0.075:legacy --runs 6
 *
 * Model spec is id:input:output:cached:choice (USD per 1M tokens; choice = the plugin profile the model runs as).
 * Costs real money (tens of cents). The key is read from the environment and never printed.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEvalBundle } from "./lib/evalBundle.mjs";
import { checkStoryJson, costUsd, missingTargets, safeError } from "./lib/modelEval.mjs";
import {
  bigramDiversity,
  cjkLength,
  levelProfile,
  mean,
  meanPairwiseSimilarity,
  paragraphs,
  pct,
  simplifiedSlips,
  targetCounts,
} from "./lib/storyMetrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log("No OPENAI_API_KEY in the environment: nothing to compare.");
  process.exit(0);
}

function parseSpec(spec) {
  const [id, input, output, cached, choice] = String(spec).trim().split(":");
  const n = (v, name) => {
    const x = Number(v);
    if (v === undefined || v === "" || !Number.isFinite(x) || x < 0) throw new Error(`Bad ${name} price in "${spec}"`);
    return x;
  };
  if (!id || (choice !== "default" && choice !== "legacy")) throw new Error(`Bad spec "${spec}": expected id:in:out:cached:default|legacy`);
  return { id, choice, price: { input: n(input, "input"), output: n(output, "output"), cached: n(cached, "cached") } };
}

const A = parseSpec(arg("a", ""));
const B = parseSpec(arg("b", ""));
const runs = Math.max(1, Math.min(10, Number(arg("runs", "6")) || 6));
const outDir = arg("out", path.join(root, "model-eval-out"));
mkdirSync(outDir, { recursive: true });

const W = (word, pinyin, definition) => ({ word, pinyin, definition });
// Real use sends ~12 due words at mixed levels; these are fixed so every run and both models get the same job.
const SCENARIOS = [
  {
    name: "HSK3 story, 12 words",
    style: "story", targetHsk: "3", lengthChars: 400, script: "simplified",
    targets: [W("图书馆", "tú shū guǎn", "library"), W("忽然", "hū rán", "suddenly"), W("邻居", "lín jū", "neighbor"), W("打算", "dǎ suàn", "to plan"), W("容易", "róng yì", "easy"), W("关心", "guān xīn", "to care about"), W("帮助", "bāng zhù", "to help"), W("决定", "jué dìng", "to decide"), W("害怕", "hài pà", "to be afraid"), W("习惯", "xí guàn", "habit"), W("照顾", "zhào gù", "to look after"), W("满意", "mǎn yì", "satisfied")],
  },
  {
    name: "HSK5 article, 12 words",
    style: "article", targetHsk: "5", lengthChars: 500, script: "simplified",
    targets: [W("效率", "xiào lǜ", "efficiency"), W("趋势", "qū shì", "trend"), W("面临", "miàn lín", "to face"), W("适应", "shì yìng", "to adapt"), W("资源", "zī yuán", "resources"), W("意识", "yì shí", "awareness"), W("改善", "gǎi shàn", "to improve"), W("维持", "wéi chí", "to maintain"), W("相对", "xiāng duì", "relatively"), W("积累", "jī lěi", "to accumulate"), W("逐渐", "zhú jiàn", "gradually"), W("承担", "chéng dān", "to bear")],
  },
  {
    name: "HSK2 dialogue, 8 words",
    style: "dialogue", targetHsk: "2", lengthChars: 300, script: "simplified",
    targets: [W("便宜", "pián yi", "cheap"), W("为什么", "wèi shén me", "why"), W("准备", "zhǔn bèi", "to prepare"), W("旅游", "lǚ yóu", "to travel"), W("觉得", "jué de", "to think"), W("非常", "fēi cháng", "very"), W("同事", "tóng shì", "colleague"), W("运动", "yùn dòng", "exercise")],
  },
  {
    name: "HSK4 story, Traditional (Taiwan), 10 words",
    style: "story", targetHsk: "4", lengthChars: 400, script: "traditional",
    targets: [W("影片", "yǐng piàn", "video"), W("網路", "wǎng lù", "internet"), W("軟體", "ruǎn tǐ", "software"), W("計程車", "jì chéng chē", "taxi"), W("便當", "biàn dāng", "boxed meal"), W("捷運", "jié yùn", "metro"), W("認識", "rèn shi", "to know"), W("機會", "jī huì", "chance"), W("經驗", "jīng yàn", "experience"), W("環境", "huán jìng", "environment")],
  },
];

const ENHANCE_CASES = [
  { surface: "行", pinyin: "xíng", currentDefinitions: ["to walk; to go; to travel", "to do", "to perform", "capable; competent", "all right; OK", "(classifier) line; row", "(surname) Xing"], sentence: "你觉得这个办法行不行？" },
  { surface: "打", pinyin: "dǎ", currentDefinitions: ["to beat; to strike", "to break", "to type", "to play (a game)", "from", "to make a call", "dozen"], sentence: "我晚上给你打电话。" },
  { surface: "发", pinyin: "fā", currentDefinitions: ["to send out", "to issue", "to develop", "classifier for gunshots", "to show (a feeling)"], sentence: "他发了一条消息给老师。" },
  { surface: "还", pinyin: "hái", currentDefinitions: ["still; yet", "also; in addition", "fairly; passably", "even more", "to return (sth)"], sentence: "时间还早，我们再坐一会儿吧。" },
  { surface: "了解", pinyin: "liǎo jiě", currentDefinitions: ["to understand", "to acknowledge", "to find out", "to comprehend"], sentence: "我想先了解一下这个城市的历史。" },
  { surface: "方便", pinyin: "fāng biàn", currentDefinitions: ["convenient", "to make things convenient for", "suitable", "having money to spare", "euphemism for going to the toilet"], sentence: "住在地铁站旁边很方便。" },
];

globalThis.window = globalThis;
const bundleFile = await buildEvalBundle(root, "scripts/model-compare/entry.mjs");
async function load(spec, n) {
  delete process.env.EVAL_ID_default;
  delete process.env.EVAL_ID_legacy;
  process.env[`EVAL_ID_${spec.choice}`] = spec.id;
  return import(`${pathToFileURL(bundleFile).href}?m=${n}`);
}
const libs = { A: await load(A, 1), B: await load(B, 2) };
const HSK = libs.A.HSK_MAP;

const specs = { A, B };
const results = []; // one row per story attempt
const enhanceRows = [];
const usageTotals = { A: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, B: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } };

async function oneStory(label, scenario, run) {
  const lib = libs[label];
  const spec = specs[label];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const { ai } = lib.makeServices(key, spec.choice, (u) => {
    for (const k of Object.keys(usage)) usage[k] += u[k];
  });
  const system = lib.STORY_SYSTEM_PROMPT;
  const user = lib.buildUserPrompt({ style: scenario.style, targetHsk: scenario.targetHsk, targetWords: scenario.targets, lengthChars: scenario.lengthChars, script: scenario.script });
  const row = { label, scenario: scenario.name, run, ok: false, repairs: 0 };
  const t0 = Date.now();
  try {
    let raw = await ai.chatJson(system, user, "ChineseStory", lib.STORY_SCHEMA);
    let parsed = checkStoryJson(raw);
    if (!parsed.ok) {
      row.error = parsed.reason;
    } else {
      row.firstAttemptMissing = missingTargets(parsed.story.textChinese, scenario.targets.map((t) => t.word)).length;
      // The plugin's repair loop, for missing words only: same prompt builder, up to 2 passes.
      const history = [];
      let story = parsed.story;
      for (let i = 0; i < 2; i++) {
        const missing = missingTargets(story.textChinese, scenario.targets.map((t) => t.word));
        if (missing.length === 0) break;
        history.push({ textChinese: story.textChinese, missingCount: missing.length });
        const repair = lib.buildRepairPrompt({
          priorAttempts: history,
          missingTargetWords: scenario.targets.filter((t) => missing.includes(t.word)),
          tooHardWords: [],
          targetHsk: scenario.targetHsk,
          totalTargets: scenario.targets.length,
          script: scenario.script,
        });
        raw = await ai.chatJson(system, repair, "ChineseStory", lib.STORY_SCHEMA);
        const again = checkStoryJson(raw);
        if (!again.ok) break;
        story = again.story;
        row.repairs++;
      }
      const text = story.textChinese;
      const words = scenario.targets.map((t) => t.word);
      const prof = levelProfile(text, HSK, Number(scenario.targetHsk));
      row.ok = true;
      row.title = story.title ?? "";
      row.text = text;
      row.chars = cjkLength(text);
      row.lengthRatio = row.chars / scenario.lengthChars;
      row.paragraphs = paragraphs(text);
      row.missingFinal = missingTargets(text, words).length;
      row.counts = targetCounts(text, words);
      row.reused = row.counts.filter((c) => c.count >= 2).length;
      row.diversity = bigramDiversity(text);
      row.tooHard = prof.tooHard;
      row.atOrBelow = prof.atOrBelow;
      row.offList = prof.offList;
      row.tooHardWords = prof.tooHardWords;
      row.slips = scenario.script === "traditional" ? simplifiedSlips(text) : 0;
    }
  } catch (err) {
    row.error = safeError(err);
  }
  row.secs = (Date.now() - t0) / 1000;
  row.usage = usage;
  for (const k of Object.keys(usage)) usageTotals[label][k] += usage[k];
  row.cost = costUsd(spec.price, usage);
  results.push(row);
  console.log(`${label} ${scenario.name} #${run}: ${row.ok ? "ok" : "FAIL " + row.error}`);
}

for (const scenario of SCENARIOS) {
  for (let run = 1; run <= runs; run++) {
    // Alternate which model goes first so a slow minute does not always land on the same one.
    for (const label of run % 2 ? ["A", "B"] : ["B", "A"]) await oneStory(label, scenario, run);
  }
}

for (const c of ENHANCE_CASES) {
  for (const label of ["A", "B"]) {
    const lib = libs[label];
    const spec = specs[label];
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    const { enhance } = lib.makeServices(key, spec.choice, (u) => {
      for (const k of Object.keys(usage)) usage[k] += u[k];
    });
    const t0 = Date.now();
    const row = { label, surface: c.surface, sentence: c.sentence };
    try {
      const out = await enhance.enhance(c);
      row.ok = out.definitions.length > 0;
      row.definitions = out.definitions;
      row.grammar = out.grammar ?? "";
    } catch (err) {
      row.ok = false;
      row.error = safeError(err);
    }
    row.secs = (Date.now() - t0) / 1000;
    for (const k of Object.keys(usage)) usageTotals[label][k] += usage[k];
    row.cost = costUsd(spec.price, usage);
    enhanceRows.push(row);
    console.log(`${label} enhance ${c.surface}: ${row.ok ? "ok" : "FAIL " + row.error}`);
  }
}

// ── report ──
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "–");
const lines = [`### Model comparison`, ``, `**A** = \`${A.id}\` (${A.choice})  ·  **B** = \`${B.id}\` (${B.choice})  ·  ${runs} runs per scenario`, ``];
for (const sc of SCENARIOS) {
  const tbl = [`#### ${sc.name}`, ``, `| metric | A | B |`, `| --- | --- | --- |`];
  const rowsFor = (l) => results.filter((r) => r.scenario === sc.name && r.label === l);
  const okFor = (l) => rowsFor(l).filter((r) => r.ok);
  const metric = (name, f) => tbl.push(`| ${name} | ${f("A")} | ${f("B")} |`);
  metric("stories ok / tried", (l) => `${okFor(l).length}/${rowsFor(l).length}`);
  metric("length vs target (mean, min–max)", (l) => { const x = okFor(l).map((r) => r.lengthRatio); return x.length ? `${pct(mean(x))} (${pct(Math.min(...x))}–${pct(Math.max(...x))})` : "–"; });
  metric("paragraphs (mean)", (l) => fmt(mean(okFor(l).map((r) => r.paragraphs))));
  metric("target words missing, 1st attempt (mean)", (l) => fmt(mean(okFor(l).map((r) => r.firstAttemptMissing)), 2));
  metric("stories needing a repair pass", (l) => `${okFor(l).filter((r) => r.repairs > 0).length}/${okFor(l).length}`);
  metric("target words missing after repair (mean)", (l) => fmt(mean(okFor(l).map((r) => r.missingFinal)), 2));
  metric("targets used 2+ times (mean)", (l) => fmt(mean(okFor(l).map((r) => r.reused))));
  metric(`chars at/below HSK${sc.targetHsk} (mean)`, (l) => pct(mean(okFor(l).map((r) => r.atOrBelow))));
  metric("too-hard chars, >1 level above (mean)", (l) => pct(mean(okFor(l).map((r) => r.tooHard))));
  metric("chars off the HSK lists (mean)", (l) => pct(mean(okFor(l).map((r) => r.offList))));
  metric("bigram diversity (higher = less repetition)", (l) => fmt(mean(okFor(l).map((r) => r.diversity)), 3));
  metric("run-to-run sameness (mean pairwise, lower = more varied)", (l) => fmt(meanPairwiseSimilarity(okFor(l).map((r) => r.text)), 3));
  if (sc.script === "traditional") metric("simplified-only characters (slips, mean)", (l) => fmt(mean(okFor(l).map((r) => r.slips)), 2));
  metric("seconds per story (mean)", (l) => fmt(mean(rowsFor(l).map((r) => r.secs))));
  metric("cost per story (mean)", (l) => `$${fmt(mean(rowsFor(l).map((r) => r.cost)), 5)}`);
  lines.push(...tbl, ``);
}
const ok = (l) => enhanceRows.filter((r) => r.label === l && r.ok).length;
lines.push(`#### Dictionary enhancement (${ENHANCE_CASES.length} words)`, ``, `| | A | B |`, `| --- | --- | --- |`, `| ok | ${ok("A")}/${ENHANCE_CASES.length} | ${ok("B")}/${ENHANCE_CASES.length} |`, ``);
const cost = (l) => costUsd(specs[l].price, usageTotals[l]);
lines.push(`Total spend: A $${fmt(cost("A"), 4)}, B $${fmt(cost("B"), 4)}.`, ``);
const summary = lines.join("\n");
writeFileSync(path.join(outDir, "compare-summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
console.log(summary);

// Blind reading copy: same stories, labels shuffled per scenario, key kept apart.
const blind = [`# Blind reading copy`, ``, `Which model is X and which is Y differs per scenario; the key is in compare-key.md. Read first, look at the key after.`, ``];
const key_ = [`# Key`, ``];
SCENARIOS.forEach((sc, idx) => {
  const swap = (idx + sc.name.length) % 2 === 1;
  const xLabel = swap ? "B" : "A";
  const yLabel = swap ? "A" : "B";
  key_.push(`- ${sc.name}: X = ${xLabel === "A" ? A.id : B.id}, Y = ${yLabel === "A" ? A.id : B.id}`);
  blind.push(`## ${sc.name}`, ``, `Target level HSK${sc.targetHsk}, ~${sc.lengthChars} characters, words: ${sc.targets.map((t) => t.word).join("、")}`, ``);
  for (let run = 1; run <= runs; run++) {
    for (const [tag, label] of [["X", xLabel], ["Y", yLabel]]) {
      const r = results.find((q) => q.scenario === sc.name && q.label === label && q.run === run);
      if (!r || !r.ok) { blind.push(`### ${tag}${run} — (no story: ${r?.error ?? "missing"})`, ``); continue; }
      blind.push(`### ${tag}${run} — ${r.title}`, ``, r.text, ``, `*(missing: ${r.missingFinal}, chars: ${r.chars})*`, ``);
    }
  }
});
blind.push(`## Dictionary enhancement`, ``);
for (const c of ENHANCE_CASES) {
  blind.push(`### ${c.surface} — “${c.sentence}”`, ``);
  const swap = c.surface.length % 2 === 1 ? false : true;
  for (const [tag, label] of [["X", swap ? "B" : "A"], ["Y", swap ? "A" : "B"]]) {
    const r = enhanceRows.find((q) => q.surface === c.surface && q.label === label);
    blind.push(`**${tag}**: ${r?.ok ? r.definitions.map((d) => `${d}`).join(" / ") : "FAILED"}${r?.grammar ? `  \n*grammar:* ${r.grammar}` : ""}`, ``);
    key_.push(`- enhance ${c.surface}: ${tag} = ${label === "A" ? A.id : B.id}`);
  }
}
writeFileSync(path.join(outDir, "compare-blind.md"), blind.join("\n"));
writeFileSync(path.join(outDir, "compare-key.md"), key_.join("\n"));
writeFileSync(path.join(outDir, "compare-raw.json"), JSON.stringify({ results, enhanceRows }, null, 2));
