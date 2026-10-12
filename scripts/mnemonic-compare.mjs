#!/usr/bin/env node
/**
 * Does supplying facts make mnemonics better? (#185) Runs a gold set of words through four "harnesses" on the same
 * OpenAI model(s) and measures what can be measured:
 *
 *   old    the plugin's current prompt, unchanged (the model must know tones, parts and pinyin by itself)
 *   tones  the app computes syllables + tone cues and writes the tone strip itself; the model writes parts + meaning
 *   facts  tones + reference character facts from Make Me a Hanzi (decomposition, roles, hint, part glosses)
 *   gated  as facts, but pictographic characters get only the origin hint and characters without etymology get none
 *
 *   OPENAI_API_KEY=... node scripts/mnemonic-compare.mjs --mmah dictionary.txt \
 *       --models gpt-6-luna:0.10:0.50:0.01:default,gpt-5.4-mini:0.75:4.50:0.075:legacy --runs 2
 *
 * Also reports how much of the HSK character set the reference data covers. The key is read from the environment and
 * never printed. Output: mnemonic-out/ (summary, blind reading copy + key, raw JSON).
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEvalBundle } from "./lib/evalBundle.mjs";
import { costUsd, safeError } from "./lib/modelEval.mjs";
import { mean, pct } from "./lib/storyMetrics.mjs";
import {
  allowedHanzi,
  charFacts,
  extractCues,
  idsLeaves,
  pairCorrect,
  parseMmah,
  storyPairs,
  toneOf,
  toneStrip,
  wordSyllables,
} from "./lib/mnemonicFacts.mjs";

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
const mmahPath = arg("mmah", "");
if (!mmahPath) throw new Error("--mmah <dictionary.txt> is required");
const MMAH = parseMmah(readFileSync(mmahPath, "utf8"));
if (MMAH.size < 5000) throw new Error(`Reference data looks wrong: only ${MMAH.size} characters parsed`);

function parseSpec(spec) {
  const [id, input, output, cached, choice] = String(spec).trim().split(":");
  const n = (v) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new Error(`Bad price in "${spec}"`);
    return x;
  };
  if (!id || (choice !== "default" && choice !== "legacy")) throw new Error(`Bad spec "${spec}"`);
  return { id, choice, price: { input: n(input), output: n(output), cached: n(cached) } };
}
const SPECS = String(arg("models", "")).split(",").filter(Boolean).map(parseSpec);
if (!SPECS.length) throw new Error("--models is required");
const runs = Math.max(1, Math.min(5, Number(arg("runs", "2")) || 2));
const concurrency = Math.max(1, Math.min(8, Number(arg("concurrency", "5")) || 5));
const outDir = arg("out", path.join(root, "mnemonic-out"));
mkdirSync(outDir, { recursive: true });

// word, pinyin (one syllable per character, space separated), meaning, category, optional traditional form
const G = (word, pinyin, def, cat, hsk = "") => ({ word, pinyin, def, cat, hsk });
const GOLD = [
  G("妈", "mā", "mom; mother", "pictophonetic char", "1"),
  G("河", "hé", "river", "pictophonetic char", "3"),
  G("请", "qǐng", "please; to invite", "pictophonetic char", "1"),
  G("想", "xiǎng", "to think; to want", "pictophonetic char", "1"),
  G("清", "qīng", "clear; pure", "pictophonetic char", "4"),
  G("山", "shān", "mountain; hill", "pictographic char", "2"),
  G("木", "mù", "tree; wood", "pictographic char", "3"),
  G("休", "xiū", "to rest", "ideographic char", "4"),
  G("明", "míng", "bright; clear; next (day)", "ideographic char", "3"),
  G("好", "hǎo", "good; well", "ideographic char", "1"),
  G("安", "ān", "safe; peaceful", "ideographic char", "3"),
  G("森", "sēn", "forest", "ideographic char", "5"),
  G("学习", "xué xí", "to learn; to study", "word", "1"),
  G("朋友", "péng you", "friend", "word (neutral tone)", "1"),
  G("图书馆", "tú shū guǎn", "library", "word", "3"),
  G("打算", "dǎ suàn", "to plan; to intend", "word", "3"),
  G("电脑", "diàn nǎo", "computer", "word", "1"),
  G("医院", "yī yuàn", "hospital", "word", "1"),
  G("谢谢", "xiè xie", "to thank; thanks", "word (neutral tone)", "1"),
  G("手机", "shǒu jī", "mobile phone", "word", "2"),
  G("玩儿", "wán r", "to play; to have fun", "word (erhua)", "2"),
  G("银行", "yín háng", "bank", "polyphone word", "3"),
  G("行", "xíng", "to walk; to go; OK", "polyphone char", "2"),
  G("长", "cháng", "long; length", "polyphone char", "2"),
  G("吗", "ma", "question particle", "particle", "1"),
  G("了", "le", "completed-action particle", "particle", "1"),
  G("學習", "xué xí", "to learn; to study", "Traditional word", "1"),
  G("圖書館", "tú shū guǎn", "library", "Traditional word", "3"),
  G("電腦", "diàn nǎo", "computer", "Traditional word", "1"),
  G("認識", "rèn shi", "to know (a person); to recognise", "Traditional word (neutral tone)", "3"),
];

// ── prompts for the two new arms (experiment only: nothing here ships) ──
const SYSTEM_NEW =
  "You are an expert coach for Chinese character mnemonics for adult learners. " +
  "You return THREE things for one word: an emoji strip for its character parts, an emoji strip for its meaning, and a short story that explains them.\n\n" +
  "\"components\" — emoji picturing the parts the characters are built from, in reading order. Mostly emoji; no Chinese characters; no tone cue (the app adds that itself).\n" +
  "\"meaning\" — emoji for the meaning. An ENGLISH word (one or two at most) only where no emoji can carry it (particles, abstract senses). No Chinese characters.\n" +
  "components and meaning TOGETHER must fit the grapheme budget given in the request. Shorter is better. No sentences, no trailing punctuation.\n\n" +
  "\"story\" — one short paragraph, plain English, second person (\"you\"). Say which emoji stands for which part, and finish on the English meaning as the punchline.\n" +
  "- Every time you name a Chinese character or word, put its tone-marked pinyin in parentheses right after it — 学 (xué), 习 (xí). Never leave a bare hanzi.\n" +
  "- Concrete, sensory, slightly absurd imagery.\n" +
  "- The tone strip is added by the app: never mention the app or say it inserts anything. You may refer to the strip's arrows as the tone cue.\n" +
  "- Pinyin is required for the word's own characters and for parts that are ordinary words (木, 女, 日). For a radical or stroke that is not a word, name it by its English picture instead of giving pinyin.\n" +
  "- Never invent parts a character does not have. When 'Character facts' are given, use ONLY the parts listed there; otherwise describe what the character actually looks like.\n\n" +
  "Output strict JSON only: {\"components\":string,\"meaning\":string,\"story\":string}. No prose before or after. No markdown code fences.";

const SCHEMA_NEW = {
  type: "object",
  required: ["components", "meaning", "story"],
  additionalProperties: false,
  properties: { components: { type: "string" }, meaning: { type: "string" }, story: { type: "string" } },
};

function syllableFacts(g, syllables) {
  const chars = Array.from(g.word);
  const aligned = chars.length === syllables.length;
  const rows = aligned
    ? chars.map((c, i) => `${c} ${syllables[i]}`)
    : [`(${chars.length} characters, ${syllables.length} syllables: ${syllables.join(" ")})`];
  return rows;
}

function newUserPrompt(g, withFacts, graphemeLength, gated = false) {
  const syl = wordSyllables(g.pinyin);
  const strip = toneStrip(syl);
  const budget = Math.max(6, 40 - graphemeLength(strip));
  const lines = [
    `Word: ${g.word}`,
    `Pinyin: ${g.pinyin}`,
    `HSK level: ${g.hsk || "(not in HSK lists)"}`,
    `Meaning(s): ${g.def}`,
    ``,
    `Syllables (computed by the app, correct):`,
    ...syllableFacts(g, syl).map((r) => `- ${r}`),
    `Tone strip the app inserts between your two parts: ${strip}`,
    `Budget for components + meaning together: ${budget} graphemes.`,
  ];
  if (withFacts) {
    const facts = Array.from(new Set(Array.from(g.word)))
      .map((c) => charFacts(c, MMAH, { gated }))
      .filter(Boolean);
    lines.push(``, `Character facts (from a reference dictionary; use ONLY these parts, do not add others):`);
    lines.push(...(facts.length ? facts.map((f) => `- ${f}`) : [`- (no reliable structure data for these characters)`]));
  }
  lines.push(``, `Give me the emoji parts, the emoji meaning and the story. Reply with JSON only.`);
  return { text: lines.join("\n"), strip, budget };
}

function parseJson(raw, keys) {
  let obj;
  try {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    obj = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  for (const k of keys) if (typeof obj[k] !== "string") return { ok: false, reason: `missing ${k}` };
  return { ok: true, obj };
}

globalThis.window = globalThis;
const bundleFile = await buildEvalBundle(root, "scripts/mnemonic-compare/entry.mjs");
let loadN = 0;
async function load(spec) {
  delete process.env.EVAL_ID_default;
  delete process.env.EVAL_ID_legacy;
  process.env[`EVAL_ID_${spec.choice}`] = spec.id;
  return import(`${pathToFileURL(bundleFile).href}?m=${++loadN}`);
}

const ARMS = ["old", "tones", "facts", "gated"];
const rows = [];
const jobs = [];

const libs = [];
for (const spec of SPECS) libs.push({ spec, lib: await load(spec) });

const { graphemeLength, HSK_MAP } = libs[0].lib;
const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/u;

async function oneJob({ spec, lib }, g, arm, run) {
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const ai = lib.makeAi(key, spec.choice, (u) => {
    for (const k of Object.keys(usage)) usage[k] += u[k];
  });
  const syl = wordSyllables(g.pinyin);
  const row = { model: spec.id, word: g.word, cat: g.cat, arm, run, ok: false };
  const t0 = Date.now();
  try {
    let line = "";
    let story = "";
    if (arm === "old") {
      const user = lib.buildMnemonicUserPrompt(lib.DEFAULT_MNEMONIC_USER_TEMPLATE, {
        surface: g.word,
        pinyin: g.pinyin,
        traditional: g.word,
        definitions: [g.def],
        hskLevels: g.hsk ? [g.hsk] : [],
      });
      const raw = await ai.chatJson(lib.MNEMONIC_SYSTEM_PROMPT, user, "Mnemonic", lib.MNEMONIC_SCHEMA);
      const p = parseJson(raw, ["mnemonic", "story"]);
      if (!p.ok) throw new Error(p.reason);
      line = p.obj.mnemonic.trim();
      story = p.obj.story.trim();
      row.toneExact = JSON.stringify(extractCues(line)) === JSON.stringify(syl.map(toneOf));
    } else {
      const built = newUserPrompt(g, arm === "facts" || arm === "gated", graphemeLength, arm === "gated");
      const raw = await ai.chatJson(SYSTEM_NEW, built.text, "Mnemonic", SCHEMA_NEW);
      const p = parseJson(raw, ["components", "meaning", "story"]);
      if (!p.ok) throw new Error(p.reason);
      line = `${p.obj.components.trim()}${built.strip}${p.obj.meaning.trim()}`;
      story = p.obj.story.trim();
      row.toneExact = true; // by construction: the app wrote the strip
      row.partsBudgetOk = graphemeLength(p.obj.components.trim() + p.obj.meaning.trim()) <= built.budget;
    }
    row.ok = true;
    row.line = line;
    row.story = story;
    row.graphemes = graphemeLength(line);
    row.lineOk = row.graphemes <= 40;
    row.hanFree = !HAN_RE.test(line);
    const { pairs, bare } = storyPairs(story);
    row.pairs = pairs.length;
    row.bare = bare.length;
    const verdicts = pairs.map((p) => pairCorrect(p.hanzi, p.pinyin, g.word, syl, MMAH));
    row.pinyinChecked = verdicts.filter((v) => v !== null && v !== "gloss").length;
    row.pinyinWrong = verdicts.filter((v) => v === false).length;
    row.pinyinGloss = verdicts.filter((v) => v === "gloss").length;
    const allowed = allowedHanzi(g.word, MMAH);
    const named = new Set(Array.from(story).filter((c) => HAN_RE.test(c)));
    row.unsupported = [...named].filter((c) => !allowed.has(c));
    const refParts = new Set(Array.from(g.word).flatMap((c) => idsLeaves(MMAH.get(c)?.decomposition)));
    row.refParts = refParts.size;
    row.refPartsNamed = [...refParts].filter((c) => named.has(c)).length;
  } catch (err) {
    row.error = safeError(err);
  }
  row.secs = (Date.now() - t0) / 1000;
  row.usage = usage;
  row.cost = costUsd(spec.price, usage);
  rows.push(row);
  console.log(`${spec.id} ${arm} ${g.word} #${run}: ${row.ok ? "ok" : "FAIL " + row.error}`);
}

for (const entry of libs) for (const g of GOLD) for (let run = 1; run <= runs; run++) for (const arm of ARMS) jobs.push(() => oneJob(entry, g, arm, run));
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) await jobs[next++]();
  })
);

// ── data coverage over the HSK character set ──
const hskChars = new Set();
for (const w of Object.keys(HSK_MAP)) for (const c of Array.from(w)) if (HAN_RE.test(c)) hskChars.add(c);
let inRef = 0, withParts = 0, withRoles = 0, withHint = 0;
for (const c of hskChars) {
  const e = MMAH.get(c);
  if (!e) continue;
  inRef++;
  if (idsLeaves(e.decomposition).length > 1) withParts++;
  if (e.etymology?.phonetic || e.etymology?.semantic) withRoles++;
  if (e.etymology?.hint) withHint++;
}
const goldChars = new Set(GOLD.flatMap((g) => Array.from(g.word)));
const goldMissing = [...goldChars].filter((c) => !MMAH.has(c));

// ── report ──
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "–");
const lines = [`### Mnemonic harness comparison`, ``, `${GOLD.length} words × ${runs} runs × 4 arms per model. Arms: **old** = current prompt; **tones** = app writes syllables + tone strip; **facts** = tones + all Make Me a Hanzi parts; **gated** = facts only where the structure is meaningful.`, ``];
lines.push(`#### Reference data coverage (Make Me a Hanzi, ${MMAH.size} characters)`, ``);
lines.push(`- HSK characters in the plugin's lists: ${hskChars.size}`);
lines.push(`- found in reference: ${inRef} (${pct(inRef / hskChars.size)})`);
lines.push(`- with 2+ parts: ${withParts} (${pct(withParts / hskChars.size)}); with sound/meaning roles: ${withRoles} (${pct(withRoles / hskChars.size)}); with an origin hint: ${withHint} (${pct(withHint / hskChars.size)})`);
lines.push(`- gold-set characters missing from reference: ${goldMissing.length ? goldMissing.join(" ") : "none"}`, ``);
for (const spec of SPECS) {
  const tbl = [`#### ${spec.id}`, ``, `| metric | old | tones | facts | gated |`, `| --- | --- | --- | --- | --- |`];
  const rs = (arm) => rows.filter((r) => r.model === spec.id && r.arm === arm);
  const ok = (arm) => rs(arm).filter((r) => r.ok);
  const metric = (name, f) => tbl.push(`| ${name} | ${ARMS.map((a) => f(a)).join(" | ")} |`);
  metric("ok / tried", (a) => `${ok(a).length}/${rs(a).length}`);
  metric("line ≤ 40 graphemes", (a) => `${ok(a).filter((r) => r.lineOk).length}/${ok(a).length}`);
  metric("line has no hanzi", (a) => `${ok(a).filter((r) => r.hanFree).length}/${ok(a).length}`);
  metric("tone cues exactly right", (a) => `${ok(a).filter((r) => r.toneExact).length}/${ok(a).length}`);
  metric("story: hanzi followed by pinyin (share)", (a) => pct(ok(a).reduce((s, r) => s + r.pairs, 0) / Math.max(1, ok(a).reduce((s, r) => s + r.pairs + r.bare, 0))));
  metric("story: pinyin wrong / checkable", (a) => `${ok(a).reduce((s, r) => s + r.pinyinWrong, 0)}/${ok(a).reduce((s, r) => s + r.pinyinChecked, 0)}`);
  metric("story: gloss written instead of pinyin / hanzi runs", (a) => `${ok(a).reduce((s, r) => s + r.pinyinGloss, 0)}/${ok(a).reduce((s, r) => s + r.pairs + r.bare, 0)}`);
  metric("stories naming a hanzi outside the reference parts", (a) => `${ok(a).filter((r) => r.unsupported.length).length}/${ok(a).length}`);
  metric("reference parts named in story (mean)", (a) => pct(mean(ok(a).filter((r) => r.refParts).map((r) => r.refPartsNamed / r.refParts))));
  metric("tokens in / out (mean)", (a) => `${fmt(mean(rs(a).map((r) => r.usage.inputTokens + r.usage.cachedInputTokens)), 0)} / ${fmt(mean(rs(a).map((r) => r.usage.outputTokens)), 0)}`);
  metric("seconds (mean)", (a) => fmt(mean(rs(a).map((r) => r.secs))));
  metric("cost per mnemonic (mean)", (a) => `$${fmt(mean(rs(a).map((r) => r.cost)), 5)}`);
  lines.push(...tbl, ``);
  const cats = [...new Set(GOLD.map((g) => g.cat))];
  const ct = [`By word type: tone cues right / stories naming a hanzi outside the reference parts (ok runs)`, ``, `| type | old | tones | facts | gated |`, `| --- | --- | --- | --- | --- |`];
  for (const cat of cats) {
    const cell = (a) => {
      const x = ok(a).filter((r) => r.cat === cat);
      return `${x.filter((r) => r.toneExact).length}/${x.length} · ${x.filter((r) => r.unsupported.length).length}/${x.length}`;
    };
    ct.push(`| ${cat} | ${ARMS.map(cell).join(" | ")} |`);
  }
  lines.push(...ct, ``);
}
const summary = lines.join("\n");
writeFileSync(path.join(outDir, "mnemonic-summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
console.log(summary);

// Blind reading copy: arms shuffled per word, reference parts shown so a reader can judge component fidelity.
const blind = [`# Blind reading copy`, ``, `Per word the four results are labelled P/Q/R/S in a shuffled order; the key is in mnemonic-key.md. "Reference" is Make Me a Hanzi data, shown only so you can judge whether the named parts are right (it is not always right either).`, ``];
const keyLines = [`# Key`, ``];
const perms = [["old", "tones", "facts", "gated"], ["tones", "gated", "old", "facts"], ["facts", "old", "gated", "tones"], ["gated", "facts", "tones", "old"], ["old", "gated", "facts", "tones"], ["tones", "old", "facts", "gated"]];
const shown = SPECS[0];
GOLD.forEach((g, idx) => {
  const order = perms[(idx * 5 + g.word.length) % perms.length];
  const facts = Array.from(new Set(Array.from(g.word))).map((c) => charFacts(c, MMAH)).filter(Boolean);
  blind.push(`## ${g.word} — ${g.pinyin} — ${g.def} (${g.cat})`, ``, facts.length ? `Reference: ${facts.join(" | ")}` : `Reference: none`, ``);
  keyLines.push(`- ${g.word}: ${order.map((a, i) => `${"PQRS"[i]} = ${a}`).join(", ")}`);
  order.forEach((arm, i) => {
    const r = rows.find((q) => q.model === shown.id && q.word === g.word && q.arm === arm && q.run === 1);
    blind.push(`**${"PQRS"[i]}** ${r?.ok ? `${r.line}\n\n${r.story}` : `(failed: ${r?.error})`}`, ``);
  });
});
writeFileSync(path.join(outDir, "mnemonic-blind.md"), blind.join("\n"));
writeFileSync(path.join(outDir, "mnemonic-key.md"), keyLines.join("\n"));
writeFileSync(path.join(outDir, "mnemonic-raw.json"), JSON.stringify(rows, null, 2));
