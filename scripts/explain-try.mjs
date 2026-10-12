#!/usr/bin/env node
/**
 * Try the Explain note (#186) on real words with the real model: the plugin's own dictionary (CC-CEDICT), input assembly,
 * Explain service, validation and Markdown renderer, so what comes out is exactly what Save would write.
 *
 *   OPENAI_API_KEY=... node scripts/explain-try.mjs --cedict cedict.txt --words "方便,行,了" --model gpt-6-luna:0.10:0.50:0.01:default
 *
 * Costs a few cents. The key is read from the environment and never printed. Output: explain-out/<word>.md + summary.md.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEvalBundle } from "./lib/evalBundle.mjs";
import { costUsd } from "./lib/modelEval.mjs";

// An HTTP error's first line is just "{"; a trial wants the whole message (key masked).
const whole = (err) => String((err && err.message) || err).replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…").replace(/\s+/g, " ").slice(0, 400);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log("No OPENAI_API_KEY in the environment: nothing to try.");
  process.exit(0);
}
const [id, input, output, cached, choice] = String(arg("model", "gpt-6-luna:0.10:0.50:0.01:default")).split(":");
const price = { input: Number(input), output: Number(output), cached: Number(cached) };
const mode = arg("mode", "word");
// Words are split on commas; phrases may contain Chinese commas but not ASCII ones, so a phrase list uses "|".
const words = String(arg("words", "方便")).split(mode === "word" ? "," : "|").map((w) => w.trim()).filter(Boolean);
const sentences = JSON.parse(arg("sentences", "{}"));
const outDir = arg("out", path.join(root, "explain-out"));
mkdirSync(outDir, { recursive: true });

globalThis.window = globalThis;
delete process.env.EVAL_ID_default;
delete process.env.EVAL_ID_legacy;
process.env[`EVAL_ID_${choice}`] = id;
const lib = await import(pathToFileURL(await buildEvalBundle(root, "scripts/explain-try/entry.mjs")).href);
const { dict, countTraditionalMarkers } = await lib.makeDictionary(readFileSync(arg("cedict", "cedict.txt"), "utf8"));

const deps = {
  lookup: (s) => dict.lookup(s),
  bySurface: () => undefined,
  region: "mainland",
  scriptVariant: "auto",
  countTraditionalMarkers,
};
const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
const service = lib.makeExplain(key, choice, (u) => {
  for (const k of Object.keys(usage)) usage[k] += u[k];
});

const phraseServices = lib.makePhrase(key, choice, (u) => {
  for (const k of Object.keys(usage)) usage[k] += u[k];
});

async function oneText(text) {
  const { text: clean } = lib.prepareSelection(text);
  const date = new Date().toISOString().slice(0, 10);
  if (mode === "proof") {
    const { result, issues } = await phraseServices.proof.proofread(clean);
    const placed = lib.locateCorrections(clean, result.corrections);
    const lines = [`# Proof read`, ``, clean, ``, ...placed.map((c) => `- ❌ ${c.original} → ✅ ${c.replacement || "(delete)"} — ${c.why}`), ``, `Corrected: ${lib.applyCorrections(clean, result.corrections)}`, ``, issues.length ? `Unverified: ${issues.join(" ")}` : "Checked: ok"];
    writeFileSync(path.join(outDir, `proof ${lib.phraseFileName(clean, date)}`), lines.join("\n"));
    return issues;
  }
  const check = await phraseServices.phrase.check(clean);
  writeFileSync(path.join(outDir, `check ${lib.phraseFileName(clean, date)}.json`), JSON.stringify(check, null, 2));
  if (check.verdict === "wrong") return [`quick check says wrong: ${check.note}`];
  const typo = check.verdict === "typo" ? `${check.original} should be ${check.suggestion}` : undefined;
  const { result, issues } = await phraseServices.phrase.explain(clean, typo);
  writeFileSync(
    path.join(outDir, lib.phraseFileName(clean, date)),
    lib.renderPhraseMarkdown(result, { text: clean, provider: "openai", model: id, date, showPinyin: true })
  );
  return issues;
}

const summary = [`### Explain trial (${id}, ${mode})`, ``, `| word | seconds | issues | cost |`, `| --- | --- | --- | --- |`];
for (const word of words) {
  const t0 = Date.now();
  const before = { ...usage };
  if (mode !== "word") {
    try {
      const issues = await oneText(word);
      const cost = costUsd(price, { inputTokens: usage.inputTokens - before.inputTokens, cachedInputTokens: usage.cachedInputTokens - before.cachedInputTokens, outputTokens: usage.outputTokens - before.outputTokens });
      summary.push(`| ${word} | ${((Date.now() - t0) / 1000).toFixed(1)} | ${issues.length ? issues.join(" ") : "none"} | $${cost.toFixed(4)} |`);
      console.log(`${word}: ok, ${issues.length} issue(s)`);
    } catch (err) {
      summary.push(`| ${word} | – | FAILED: ${whole(err)} | – |`);
      console.log(`${word}: FAILED ${whole(err)}`);
    }
    continue;
  }
  try {
    const inputForWord = lib.explainInputFor(deps, word, sentences[word]);
    writeFileSync(path.join(outDir, `${word}.prompt.json`), JSON.stringify(inputForWord, null, 2));
    const { result, issues } = await service.generate(inputForWord);
    const meta = {
      word,
      pinyin: inputForWord.pinyin,
      key: lib.explainKey(deps, word),
      hsk: inputForWord.hskLevels.join("/"),
      provider: "openai",
      model: id,
      date: new Date().toISOString().slice(0, 10),
      showPinyin: true,
    };
    const md = lib.renderExplainMarkdown(result, meta);
    writeFileSync(path.join(outDir, lib.explainFileName(word, inputForWord.pinyin)), md);
    const cost = costUsd(price, { inputTokens: usage.inputTokens - before.inputTokens, cachedInputTokens: usage.cachedInputTokens - before.cachedInputTokens, outputTokens: usage.outputTokens - before.outputTokens });
    summary.push(`| ${word} | ${((Date.now() - t0) / 1000).toFixed(1)} | ${issues.length ? issues.join(" ") : "none"} | $${cost.toFixed(4)} |`);
    console.log(`${word}: ok, ${issues.length} issue(s)`);
  } catch (err) {
    summary.push(`| ${word} | – | FAILED: ${whole(err)} | – |`);
    console.log(`${word}: FAILED ${whole(err)}`);
  }
}
const text = summary.join("\n");
writeFileSync(path.join(outDir, "summary.md"), text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
console.log(text);
