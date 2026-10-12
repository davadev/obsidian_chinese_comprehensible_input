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
import * as OLD from "./mnemonic-compare/oldPrompt.mjs";
import { costUsd, safeError } from "./lib/modelEval.mjs";
import { mean, pct } from "./lib/storyMetrics.mjs";
import {
  allowedHanzi,
  ccdFacts,
  ccdLeaves,
  charFacts,
  extractCues,
  extractSup,
  repairStoryPinyin,
  semanticFacts,
  toneMark,
  idsLeaves,
  pairCorrect,
  assembleLine,
  parseCcd,
  parseMmah,
  parsePlecoFlat,
  plecoFacts,
  shortDef,
  singleCharFacts,
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

// Optional second and third reference sources (Pleco forum files): used only when their paths are given.
const PLECO = arg("pleco", "") ? parsePlecoFlat(readFileSync(arg("pleco", ""), "utf8")) : new Map();
const CCD = arg("ccd", "") ? parseCcd(readFileSync(arg("ccd", ""), "utf8")) : new Map();

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
const G = (word, pinyin, def, cat, hsk = "", sentence = "") => ({ word, pinyin, def, cat, hsk, sentence });
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
  // round 5: more single characters, balanced by how they are built
  G("钱", "qián", "money", "pictophonetic char", "2"),
  G("睛", "jīng", "eyeball", "pictophonetic char", "5"),
  G("吃", "chī", "to eat", "pictophonetic char", "1"),
  G("唱", "chàng", "to sing", "pictophonetic char", "3"),
  G("病", "bìng", "illness", "pictophonetic char", "3"),
  G("蓝", "lán", "blue", "pictophonetic char", "3"),
  G("菜", "cài", "vegetable; dish", "pictophonetic char", "1"),
  G("看", "kàn", "to look; to watch", "ideographic char", "1"),
  G("男", "nán", "male", "ideographic char", "3"),
  G("从", "cóng", "from", "ideographic char", "3"),
  G("林", "lín", "woods", "ideographic char", "5"),
  G("尖", "jiān", "pointed; sharp", "ideographic char", "5"),
  G("取", "qǔ", "to take", "ideographic char", "3"),
  G("日", "rì", "sun; day", "pictographic char", "1"),
  G("水", "shuǐ", "water", "pictographic char", "1"),
  G("人", "rén", "person", "pictographic char", "1"),
  G("口", "kǒu", "mouth", "pictographic char", "3"),
  G("马", "mǎ", "horse", "pictographic char", "3"),
  G("医", "yī", "medicine; doctor", "graphical-split char", "1"),
  G("图", "tú", "picture; map", "graphical-split char", "3"),
  G("书", "shū", "book", "graphical-split char", "1"),
  G("馆", "guǎn", "public building", "graphical-split char", "3"),
  G("国", "guó", "country", "graphical-split char", "1"),
  // used as (part of) a name in the sentence, and the same character in an ordinary sentence
  G("马克", "mǎ kè", "Mark (name)", "name in sentence", "", "我的朋友马克明天来。"),
  G("李明", "lǐ míng", "Li Ming (name)", "name in sentence", "", "李明是我的老师。"),
  G("白", "bái", "white; Bai (surname)", "name in sentence", "2", "白老师在教室里。"),
  G("白", "bái", "white; Bai (surname)", "same word, ordinary use", "2", "这只猫是白的。"),
  G("马", "mǎ", "horse; Ma (surname)", "same word, ordinary use", "3", "他骑着一匹马。"),
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

// Round 4: one picture group per character, each followed by its own tone cue; parts only for single-character words.
const SYSTEM_PC =
  "You are an expert coach for Chinese character mnemonics for adult learners. You return THREE things for one word: a picture group for EACH character, an emoji strip for the whole word's meaning, and a short story that explains them.\n\n" +
  "\"characters\" — an array with exactly one string per character, in order. Each string is 1 to 3 emoji (single-character words: up to 4) that make the character memorable: for a multi-character word, a picture of what that character means or looks like; for a single-character word, the parts it is built from. Emoji only: no Chinese characters, no words, no tone cue (the app attaches each character's tone cue right after its group).\n" +
  "\"meaning\" — emoji for the meaning of the whole word. An ENGLISH word (one or two at most) only where no emoji can carry it (particles, abstract senses). No Chinese characters.\n" +
  "All groups and the meaning TOGETHER must fit the grapheme budget given in the request. Shorter is better.\n\n" +
  "\"story\" — one short paragraph, plain English, second person (\"you\"). Say which emoji stands for which character or part, and finish on the English meaning as the punchline.\n" +
  "- Every time you name a Chinese character or word, put its tone-marked pinyin in parentheses right after it — 学 (xué), 习 (xí). Never leave a bare hanzi.\n" +
  "- Concrete, sensory, slightly absurd imagery.\n" +
  "- The tone cues are added by the app: never mention the app. You may refer to the arrows as the tone cue.\n" +
  "- Pinyin is required for the word's own characters and for parts that are ordinary words (木, 女, 日). For a radical or stroke that is not a word, name it by its English picture instead of giving pinyin.\n" +
  "- Never invent parts a character does not have. When 'Character facts' are given, use ONLY the parts listed there; parts marked [sound only] hint at the pronunciation and do not carry the meaning.\n\n" +
  "Output strict JSON only: {\"characters\":[string],\"meaning\":string,\"story\":string}. No prose before or after. No markdown code fences.";

// Round 5: the app attaches a superscript tone number after each group, so arrows stay free for the pictures.
const SYSTEM_PCN =
  "You are an expert coach for Chinese character mnemonics for adult learners. You return THREE things for one word: a picture group for EACH character, an emoji strip for the whole word's meaning, and a short story that explains them.\n\n" +
  "\"characters\" — an array with exactly one string per character, in order. Each string is 1 to 3 emoji (single-character words: up to 4) that make the character memorable: for a multi-character word, a picture of what that character means or looks like; for a single-character word, the picture of its meaning-carrying parts. Emoji and arrows only: no Chinese characters, no letters, no digits (the app attaches each character's tone number right after its group).\n" +
  "\"meaning\" — emoji for the meaning of the whole word. An ENGLISH word (one or two at most) only where no emoji can carry it (particles, abstract senses). No Chinese characters. Arrows are fine when the meaning needs them (up, down, return…).\n" +
  "All groups and the meaning TOGETHER must fit the grapheme budget given in the request. Shorter is better.\n\n" +
  "\"story\" — one short paragraph, plain English, second person (\"you\"). Say which emoji stands for which character or part, and finish on the English meaning as the punchline.\n" +
  "- Put the tone-marked pinyin in parentheses right after the word's own characters, the way the request lists them — 学 (xué). Do not give pinyin for parts: name a part by its English picture (the water radical, the heart), or write the character bare.\n" +
  "- Concrete, sensory, slightly absurd imagery.\n" +
  "- The tone numbers are added by the app: never mention the app. Do not talk about sound hints or pronunciation clues; the learner already hears the word.\n" +
  "- Never invent parts a character does not have. When 'Character facts' are given, use ONLY the parts listed there.\n\n" +
  "Output strict JSON only: {\"characters\":[string],\"meaning\":string,\"story\":string}. No prose before or after. No markdown code fences.";

const SCHEMA_PC = {
  type: "object",
  required: ["characters", "meaning", "story"],
  additionalProperties: false,
  properties: { characters: { type: "array", items: { type: "string" } }, meaning: { type: "string" }, story: { type: "string" } },
};

function pcUserPrompt(g, arm, graphemeLength) {
  const style = arm.startsWith("pcn") ? "sup" : "arrow";
  const syl = wordSyllables(g.pinyin);
  const chars = Array.from(g.word);
  const cues = syl.map((s) => (style === "sup" ? toneMark(toneOf(s), "sup") : toneStrip([s])));
  const budget = Math.max(6, 40 - cues.reduce((n, c) => n + graphemeLength(c), 0));
  const single = chars.length === 1;
  const lines = [`Word: ${g.word}`, `Pinyin: ${g.pinyin}`, `HSK level: ${g.hsk || "(not in HSK lists)"}`, `Meaning(s): ${g.def}`, ``];
  lines.push(`Characters (give one picture group for each, in this order; the app attaches the tone ${style === "sup" ? "number" : "cue"} after it):`);
  const aligned = chars.length === syl.length;
  chars.forEach((c, i) => {
    const gloss = single ? "" : shortDef(c, MMAH);
    lines.push(`${i + 1}. ${c} ${aligned ? syl[i] : ""} — tone ${style === "sup" ? "number" : "cue"} ${aligned ? cues[i] : "?"}${gloss ? ` — means: ${gloss}` : ""}`);
  });
  lines.push(`Budget for all groups + meaning together: ${budget} graphemes. Return exactly ${syl.length} string(s) in "characters".`);
  if (single && !["pc", "pcn"].includes(arm)) {
    const f = arm === "pcn_sem" ? semanticFacts(g.word, MMAH) : arm === "pcn_all" ? charFacts(g.word, MMAH) : singleCharFacts(g.word, MMAH, arm !== "pcplain");
    lines.push(``, `Character facts (from a reference dictionary; use ONLY these parts, do not add others):`);
    lines.push(f ? `- ${f}` : `- (no reliable structure data for this character: describe what it actually looks like)`);
  }
  lines.push(``, `Give me the picture groups, the emoji meaning and the story. Reply with JSON only.`);
  return { text: lines.join("\n"), syl, style };
}

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

function factsFor(c, arm) {
  if (arm === "pleco") return plecoFacts(c, PLECO);
  if (arm === "ccd") return ccdFacts(c, CCD);
  return charFacts(c, MMAH, { gated: arm === "gated" });
}

function newUserPrompt(g, withFacts, graphemeLength, arm = "facts") {
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
      .map((c) => factsFor(c, arm))
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

const ARMS = String(arg("arms", "old,pc,pcn,pcn_sem,pcn_roles,pcn_all")).split(",").filter(Boolean);
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
      const user = lib.buildMnemonicUserPrompt(OLD.DEFAULT_MNEMONIC_USER_TEMPLATE, {
        surface: g.word,
        pinyin: g.pinyin,
        traditional: g.word,
        definitions: [g.def],
        hskLevels: g.hsk ? [g.hsk] : [],
      });
      const raw = await ai.chatJson(OLD.MNEMONIC_SYSTEM_PROMPT, user, "Mnemonic", OLD.MNEMONIC_SCHEMA);
      const p = parseJson(raw, ["mnemonic", "story"]);
      if (!p.ok) throw new Error(p.reason);
      line = p.obj.mnemonic.trim();
      story = p.obj.story.trim();
      row.toneExact = JSON.stringify(extractCues(line)) === JSON.stringify(syl.map(toneOf));
    } else if (arm === "plugin") {
      // The shipped service itself (src/ai/MnemonicService.ts): facts, validation, one repair, line assembly.
      const svc = lib.makeMnemonic(key, spec.choice, (u) => {
        for (const k of Object.keys(usage)) usage[k] += u[k];
      });
      const han = Array.from(g.word).filter((c) => HAN_RE.test(c));
      const res = await svc.generate({
        surface: g.word,
        pinyin: g.pinyin,
        definitions: [g.def],
        hskLevels: g.hsk ? [g.hsk] : [],
        sentence: g.sentence || undefined,
        charGlosses: han.length > 1 ? han.map((c) => shortDef(c, MMAH)) : undefined,
      });
      line = res.mnemonic;
      story = res.story ?? "";
      row.notes = res.notes ?? [];
      row.groupsOk = row.notes.length === 0;
      row.toneExact = JSON.stringify(extractSup(line)) === JSON.stringify(syl.map(toneOf));
    } else if (arm.startsWith("pc")) {
      const built = pcUserPrompt(g, arm, graphemeLength);
      const style = built.style;
      row.prompt = built.text;
      const raw = await ai.chatJson(style === "sup" ? SYSTEM_PCN : SYSTEM_PC, built.text, "Mnemonic", SCHEMA_PC);
      let obj;
      try {
        obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      } catch {
        throw new Error("not valid JSON");
      }
      if (!Array.isArray(obj.characters) || typeof obj.meaning !== "string" || typeof obj.story !== "string") throw new Error("missing field");
      row.groupsOk = obj.characters.length === built.syl.length;
      line = assembleLine(obj.characters, built.syl, obj.meaning, style);
      story = obj.story.trim();
      row.toneExact = JSON.stringify(style === "sup" ? extractSup(line) : extractCues(line)) === JSON.stringify(built.syl.map(toneOf));
    } else {
      const built = newUserPrompt(g, !["old", "tones"].includes(arm), graphemeLength, arm);
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
    const ownSet = new Set(Array.from(g.word));
    const isOwn = (run) => Array.from(run).every((c) => ownSet.has(c));
    row.ownPairs = pairs.filter((p) => isOwn(p.hanzi)).length;
    row.ownBare = bare.filter(isOwn).length;
    row.repairs = repairStoryPinyin(story, g.word, syl).changes;
    const ety = MMAH.get(g.word)?.etymology;
    row.phoneticOnly = Array.from(g.word).length === 1 && ety?.type === "pictophonetic" && ety.phonetic && ety.semantic ? story.includes(ety.phonetic) && !story.includes(ety.semantic) : null;
    const verdicts = pairs.map((p) => pairCorrect(p.hanzi, p.pinyin, g.word, syl, MMAH));
    row.pinyinChecked = verdicts.filter((v) => v !== null && v !== "gloss").length;
    row.pinyinWrong = verdicts.filter((v) => v === false).length;
    row.pinyinGloss = verdicts.filter((v) => v === "gloss").length;
    // "Outside the reference" is judged against every source loaded, so a part any source lists is not called invented.
    const allowed = allowedHanzi(g.word, MMAH);
    for (const c of Array.from(g.word)) {
      for (const p of PLECO.get(c)?.parts ?? []) allowed.add(p);
      for (const p of ccdLeaves(c, CCD)) allowed.add(p);
    }
    const named = new Set(Array.from(story).filter((c) => HAN_RE.test(c)));
    row.unsupported = [...named].filter((c) => !allowed.has(c));
    const own = (c) => (arm === "pleco" ? PLECO.get(c)?.parts ?? [] : arm === "ccd" ? ccdLeaves(c, CCD) : idsLeaves(MMAH.get(c)?.decomposition));
    const refParts = new Set(Array.from(g.word).flatMap(own));
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
const lines = [`### Mnemonic harness comparison`, ``, `${GOLD.length} words × ${runs} runs × ${ARMS.length} arms per model. Arms: **old** = current prompt; **tones** = app writes syllables + tone strip; **facts** = tones + all Make Me a Hanzi parts; **gated** = Make Me a Hanzi where meaningful; **pleco** = Petrossi flat parts with English names; **ccd** = catusf component tree with glosses. Arms run: ${ARMS.join(", ")}.`, ``];
lines.push(`#### Reference data coverage (Make Me a Hanzi, ${MMAH.size} characters)`, ``);
lines.push(`- HSK characters in the plugin's lists: ${hskChars.size}`);
lines.push(`- found in reference: ${inRef} (${pct(inRef / hskChars.size)})`);
lines.push(`- with 2+ parts: ${withParts} (${pct(withParts / hskChars.size)}); with sound/meaning roles: ${withRoles} (${pct(withRoles / hskChars.size)}); with an origin hint: ${withHint} (${pct(withHint / hskChars.size)})`);
if (PLECO.size) lines.push(`- Petrossi flat list: ${PLECO.size} characters; covers ${[...hskChars].filter((c) => PLECO.has(c)).length} of ${hskChars.size} HSK characters (${pct([...hskChars].filter((c) => PLECO.has(c)).length / hskChars.size)})`);
if (CCD.size) lines.push(`- catusf component tree: ${CCD.size} characters; covers ${[...hskChars].filter((c) => CCD.get(c)?.tree.length).length} of ${hskChars.size} HSK characters with a tree (${pct([...hskChars].filter((c) => CCD.get(c)?.tree.length).length / hskChars.size)})`);
lines.push(`- gold-set characters missing from reference: ${goldMissing.length ? goldMissing.join(" ") : "none"}`, ``);
for (const spec of SPECS) {
  const tbl = [`#### ${spec.id}`, ``, `| metric | ${ARMS.join(" | ")} |`, `| ${ARMS.map(() => "---").join(" | ")} | --- |`];
  const rs = (arm) => rows.filter((r) => r.model === spec.id && r.arm === arm);
  const ok = (arm) => rs(arm).filter((r) => r.ok);
  const metric = (name, f) => tbl.push(`| ${name} | ${ARMS.map((a) => f(a)).join(" | ")} |`);
  metric("ok / tried", (a) => `${ok(a).length}/${rs(a).length}`);
  metric("line ≤ 40 graphemes", (a) => `${ok(a).filter((r) => r.lineOk).length}/${ok(a).length}`);
  metric("one picture group per character", (a) => (a.startsWith("pc") ? `${ok(a).filter((r) => r.groupsOk).length}/${ok(a).length}` : "n/a"));
  metric("line has no hanzi", (a) => `${ok(a).filter((r) => r.hanFree).length}/${ok(a).length}`);
  metric("tone cues exactly right", (a) => `${ok(a).filter((r) => r.toneExact).length}/${ok(a).length}`);
  metric("story: the word's own hanzi followed by pinyin (share)", (a) => pct(ok(a).reduce((s, r) => s + r.ownPairs, 0) / Math.max(1, ok(a).reduce((s, r) => s + r.ownPairs + r.ownBare, 0))));
  metric("stories where the app had to fix the word's own pinyin", (a) => `${ok(a).filter((r) => r.repairs > 0).length}/${ok(a).length}`);
  metric("pictophonetic chars: story leans on the sound part only", (a) => { const x = ok(a).filter((r) => r.phoneticOnly !== null); return `${x.filter((r) => r.phoneticOnly).length}/${x.length}`; });
  metric("line length in graphemes (mean)", (a) => fmt(mean(ok(a).map((r) => r.graphemes)), 1));
  metric("story: any hanzi followed by pinyin (share)", (a) => pct(ok(a).reduce((s, r) => s + r.pairs, 0) / Math.max(1, ok(a).reduce((s, r) => s + r.pairs + r.bare, 0))));
  metric("story: pinyin wrong / checkable", (a) => `${ok(a).reduce((s, r) => s + r.pinyinWrong, 0)}/${ok(a).reduce((s, r) => s + r.pinyinChecked, 0)}`);
  metric("story: gloss written instead of pinyin / hanzi runs", (a) => `${ok(a).reduce((s, r) => s + r.pinyinGloss, 0)}/${ok(a).reduce((s, r) => s + r.pairs + r.bare, 0)}`);
  metric("stories naming a hanzi outside the reference parts", (a) => `${ok(a).filter((r) => r.unsupported.length).length}/${ok(a).length}`);
  metric("reference parts named in story (mean)", (a) => pct(mean(ok(a).filter((r) => r.refParts).map((r) => r.refPartsNamed / r.refParts))));
  metric("tokens in / out (mean)", (a) => `${fmt(mean(rs(a).map((r) => r.usage.inputTokens + r.usage.cachedInputTokens)), 0)} / ${fmt(mean(rs(a).map((r) => r.usage.outputTokens)), 0)}`);
  metric("seconds (mean)", (a) => fmt(mean(rs(a).map((r) => r.secs))));
  metric("cost per mnemonic (mean)", (a) => `$${fmt(mean(rs(a).map((r) => r.cost)), 5)}`);
  lines.push(...tbl, ``);
  const cats = [...new Set(GOLD.map((g) => g.cat))];
  const ct = [`By word type: tone cues right / stories naming a hanzi outside the reference parts (ok runs)`, ``, `| type | ${ARMS.join(" | ")} |`, `| ${ARMS.map(() => "---").join(" | ")} | --- |`];
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
const blind = [`# Blind reading copy`, ``, `Per word the four results are labelled P, Q, R… in a shuffled order; the key is in mnemonic-key.md. "Reference" is Make Me a Hanzi data, shown only so you can judge whether the named parts are right (it is not always right either).`, ``];
const styleSheet = [["arrows (today)", "arrow"], ["superscript numbers", "sup"], ["subscript numbers", "sub"], ["plain digits", "digit"]].map(
  ([name, style]) => `- ${name}: ${assembleLine(["🗺️", "📖", "🏛️"], ["tú", "shū", "guǎn"], "📚", style)}   ·   ${assembleLine(["🌳👁️❤️"], ["xiǎng"], "🤔", style)}   ·   ${assembleLine(["👩🐴"], ["mā"], "👩‍👧", style)}`
);
blind.splice(2, 0, `## Tone style sheet (same words: 图书馆, 想, 妈) — look at these on your phone`, ``, ...styleSheet, ``);
const keyLines = [`# Key`, ``];
const orderFor = (idx) => {
  const rot = ARMS.map((_, k) => ARMS[(k + idx * 2 + 1) % ARMS.length]);
  return idx % 2 ? rot.reverse() : rot;
};
const shown = SPECS[0];
GOLD.forEach((g, idx) => {
  const order = orderFor(idx);
  const facts = Array.from(new Set(Array.from(g.word))).flatMap((c) => [charFacts(c, MMAH), PLECO.size ? plecoFacts(c, PLECO) : null, CCD.size ? ccdFacts(c, CCD) : null].filter(Boolean));
  blind.push(`## ${g.word} — ${g.pinyin} — ${g.def} (${g.cat})`, ``, facts.length ? `Reference: ${facts.join(" | ")}` : `Reference: none`, ``);
  keyLines.push(`- ${g.word}: ${order.map((a, i) => `${"PQRSTU"[i]} = ${a}`).join(", ")}`);
  order.forEach((arm, i) => {
    const r = rows.find((q) => q.model === shown.id && q.word === g.word && q.arm === arm && q.run === 1);
    blind.push(`**${"PQRSTU"[i]}** ${r?.ok ? `${r.line}\n\n${r.story}` : `(failed: ${r?.error})`}`, ``);
  });
});
writeFileSync(path.join(outDir, "mnemonic-blind.md"), blind.join("\n"));
writeFileSync(path.join(outDir, "mnemonic-key.md"), keyLines.join("\n"));
writeFileSync(path.join(outDir, "mnemonic-raw.json"), JSON.stringify(rows, null, 2));
