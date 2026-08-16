export const STORY_SYSTEM_PROMPT =
  "You are an expert writer of graded Chinese comprehensible input for adult Chinese learners. " +
  "Write natural, engaging Chinese using simple grammar and vocabulary appropriate to the requested HSK level. " +
  "Include all required target words naturally inside the story itself — they must appear in the textChinese body, not in any explanation or list. " +
  "Where it fits the story naturally, use a target word more than once for stronger learner exposure — but never force it if it disrupts the flow. " +
  "Do not explain in English inside the story. " +
  "Output valid JSON only matching this shape: " +
  "{\"title\":string,\"targetLevel\":string,\"textChinese\":string}. " +
  "Do not include a glossary, checklist, learner notes, or any extra keys. " +
  "Do not use keys named text, content, keywords, meaning, or term. " +
  "Return ONLY a single JSON object. No prose before or after. No markdown code fences.";

export interface TargetWord {
  word: string;
  pinyin: string;
  definition: string;
}

export function buildUserPrompt(args: {
  style: "story" | "article" | "dialogue";
  targetHsk: string;
  targetWords: TargetWord[];
  knownWords?: string[];
  lengthChars: number;
}): string {
  const wordsBlock = args.targetWords
    .map((w, i) => `  ${i + 1}. ${w.word} (${w.pinyin}) — ${w.definition}`)
    .join("\n");
  const knownWordsBlock = args.knownWords?.length
    ? `Words the learner already knows (use these as examples for suitable filler vocabulary, but target words above are still required):\n${args.knownWords.join("、")}\n`
    : "";
  return (
    `Create a Chinese ${args.style} for a learner around HSK ${args.targetHsk}.\n` +
    `Required target words (use every one at least once, naturally; reuse a word 2-3 times where it fits the story without forcing it):\n${wordsBlock}\n` +
    knownWordsBlock +
    `For all other vocabulary, prefer words at or below HSK ${args.targetHsk}.\n` +
    `Keep the ${args.style} coherent, enjoyable, and not childish unless requested.\n` +
    `Length: roughly ${args.lengthChars} Chinese characters.\n` +
    `Return JSON only with the key textChinese for the Chinese text. Do not include English explanations inside the Chinese text.`
  );
}

export function buildRepairPrompt(args: {
  priorAttempts: Array<{ textChinese: string; missingCount: number }>;
  missingTargetWords: TargetWord[];
  tooHardWords: string[];
  targetHsk: string;
  totalTargets: number;
}): string {
  const attemptsBlock = args.priorAttempts
    .map(
      (a, i) =>
        `Attempt ${i + 1} — missed ${a.missingCount} of ${args.totalTargets} target words:\n` +
        `---\n${a.textChinese}\n---`
    )
    .join("\n\n");
  const missingBlock = args.missingTargetWords
    .map((w, i) => `  ${i + 1}. ${w.word} (${w.pinyin}) — ${w.definition}`)
    .join("\n");
  return (
    `Your previous Chinese story attempts repeatedly miss required target words. ` +
    `Here is the full history of attempts so far:\n\n` +
    `${attemptsBlock}\n\n` +
    `${args.missingTargetWords.length} of ${args.totalTargets} target words are still missing from textChinese.\n` +
    `Each missing word below MUST appear at least once verbatim inside textChinese, ` +
    `as the exact simplified-Chinese surface form. Putting it in a glossary, comment, ` +
    `or paraphrase does NOT count. Where natural, use a missing target word more than once.\n\n` +
    `Missing target words to add to the story:\n${missingBlock || "  (none)"}\n\n` +
    `Also replace any too-difficult vocabulary with simpler alternatives at HSK ${args.targetHsk} or below: ${args.tooHardWords.join(", ") || "(none)"}.\n` +
    `Look at the prior attempts above to see which words you kept missing and adjust your approach accordingly. ` +
    `Keep the existing story arc where it works; add or rewrite sentences so every missing word lands naturally in the prose.\n\n` +
    `Return revised JSON only with shape {title, targetLevel, textChinese}.`
  );
}

export const STORY_SCHEMA = {
  type: "object",
  required: ["title", "targetLevel", "textChinese"],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    targetLevel: { type: "string" },
    textChinese: { type: "string" },
  },
};

/**
 * System prompt for the "Enhance dictionary entry" feature on the word
 * popup. The model rewrites a CC-CEDICT entry so the FIRST gloss best
 * reflects the meaning the word carries in the supplied sentence,
 * without cherry-picking a rare sense that happens to fit. Grammar field
 * is only included when the word has notable grammar for a learner.
 */
export const ENHANCE_SYSTEM_PROMPT =
  "You are a precise bilingual Chinese-English lexicographer. " +
  "You rewrite a single CC-CEDICT-style dictionary entry so its FIRST definition reflects the meaning the word carries in the supplied sentence, without cherry-picking a rare or context-specific sense. " +
  "Subsequent definitions list other common senses, ordered by general frequency. " +
  "If — and only if — the word has notable grammar a learner needs (measure word, separable verb, aspect particle, classifier, resultative complement, etc.), include a short English grammar note. " +
  "Otherwise omit the grammar field entirely. " +
  "Output strict JSON only matching this shape: " +
  "{\"definitions\":string[],\"grammar\"?:string}. " +
  "Rules: definitions is required and contains at least one English gloss; do not invent rare senses just because the sentence is unusual; keep each definition under 80 chars; never include Chinese in the JSON values; no prose before or after; no markdown code fences.";

/** Extra clause appended when the user has opted into letting the AI
 *  rewrite pinyin (e.g. to disambiguate polyphone readings from
 *  context). Off by default — see `ai.enhanceCanRewritePinyin`. */
export const ENHANCE_PINYIN_CLAUSE =
  " You MAY also return \"pinyin\": \"tone-marked pinyin\" if the sentence disambiguates a polyphone reading. Otherwise omit pinyin.";

export function buildEnhanceUserPrompt(args: {
  surface: string;
  pinyin: string;
  traditional?: string;
  currentDefinitions: string[];
  sentence: string;
}): string {
  const defsBlock = args.currentDefinitions.length
    ? args.currentDefinitions.map((d) => `  - ${d}`).join("\n")
    : "  (none)";
  const trad =
    args.traditional && args.traditional !== args.surface ? args.traditional : "(same)";
  return (
    `Word: ${args.surface}\n` +
    `Pinyin: ${args.pinyin || "(unknown)"}\n` +
    `Traditional: ${trad}\n` +
    `Current dictionary entry (one per line):\n${defsBlock}\n` +
    `Sentence the word appears in:\n  ${args.sentence}\n\n` +
    `Rewrite the entry per the system rules. Reply with JSON only.`
  );
}

/**
 * System prompt for the AI mnemonic generator (#49).
 *
 * Two outputs, with very different jobs:
 *  - `mnemonic` is a compact EMOJI line. It is shown on the word card and
 *    is the candidate for replacing the English gloss on a third line in a
 *    future release, so it has to survive in a narrow column — hence the
 *    hard length limit and the emoji-first rule. Emoji also happen to be
 *    stickier than prose, which is the point of a mnemonic.
 *  - `story` is the prose that unpacks the emoji line.
 *
 * The three things a mnemonic must carry for this plugin's learners are
 * the character components, the tone, and the meaning — named explicitly
 * because models otherwise default to meaning-only. These rules live in
 * the SYSTEM prompt so users who customised their user template still get
 * the emoji behaviour.
 */
export const MNEMONIC_SYSTEM_PROMPT =
  "You are an expert coach for Chinese character mnemonics for adult learners. " +
  "You return TWO things for one word: a compact emoji line, and a short story that explains it.\n" +
  "\n" +
  "\"mnemonic\" — the emoji line. Rules:\n" +
  "- Mostly emoji. Use a word ONLY where no emoji can carry the idea (grammar particles, abstract senses); one or two words at most.\n" +
  "- Hard limit: 40 characters. Shorter is better — it has to fit on a narrow line under the word.\n" +
  "- No sentences, no explanation, no trailing punctuation. It is a picture strip, not a caption.\n" +
  "- Encode all three of: the character components/radicals as images, the tone of each syllable, and the meaning.\n" +
  "- Encode tone with a consistent cue: 1st = ➡️ or a flat/steady image, 2nd = ↗️ rising, 3rd = ↘️↗️ dipping then rising, 4th = ↘️ sharp drop, neutral = 〰️ light and quick.\n" +
  "- Order the emoji so reading them left to right replays the story: components → tone → meaning.\n" +
  "\n" +
  "\"story\" — the prose that unpacks the line. Rules:\n" +
  "- One short paragraph, plain English, second person (\"you\").\n" +
  "- Say which emoji stands for which component, what the tone cue is, and finish on the English meaning as the punchline.\n" +
  "- Concrete, sensory, slightly absurd imagery — absurd is memorable.\n" +
  "- Never invent components a character does not have; if a split is not helpful, describe what the character actually looks like.\n" +
  "\n" +
  "Output strict JSON only matching this shape: " +
  "{\"mnemonic\":string,\"story\":string}. " +
  "mnemonic is required. No prose before or after the JSON. No markdown code fences.";

/**
 * Default user-prompt template for mnemonic generation. Users can rewrite
 * this in Settings → AI provider → Mnemonic prompt to personalise the
 * result (their own imagery, humour, language, memory palace, …).
 */
export const DEFAULT_MNEMONIC_USER_TEMPLATE =
  "Word: {word}\n" +
  "Pinyin: {pinyin}\n" +
  "Traditional: {traditional}\n" +
  "HSK level: {hsk}\n" +
  "Meaning(s): {definitions}\n" +
  "Sentence I met it in: {sentence}\n" +
  "My current emoji line (replace it with something better): {existing}\n" +
  "My current story: {existingStory}\n\n" +
  "Give me the emoji line and the story for this word. Break down the character " +
  "components, encode the tone of each syllable, and end on the meaning. Reply with JSON only.";

export interface MnemonicPromptArgs {
  surface: string;
  pinyin?: string;
  traditional?: string;
  definitions?: string[];
  sentence?: string;
  hskLevels?: string[];
  /** The user's current emoji line, if any. */
  existing?: string;
  /** The user's current story, if any. */
  existingStory?: string;
}

/**
 * Substitute the mnemonic placeholders in `template`. Unknown placeholders
 * are left verbatim so a user's own `{foo}` text survives, and blank
 * fields degrade to a readable "(none)" / "(unknown)" the way
 * `buildEnhanceUserPrompt` does. An empty / whitespace-only template
 * falls back to the built-in default.
 */
export function buildMnemonicUserPrompt(
  template: string,
  args: MnemonicPromptArgs
): string {
  const tpl = template.trim() ? template : DEFAULT_MNEMONIC_USER_TEMPLATE;
  const trad =
    args.traditional && args.traditional !== args.surface ? args.traditional : "(same)";
  const values: Record<string, string> = {
    word: args.surface,
    pinyin: args.pinyin?.trim() || "(unknown)",
    traditional: trad,
    definitions: args.definitions?.filter((d) => d.trim()).join("; ") || "(none)",
    sentence: args.sentence?.trim() || "(none)",
    hsk: args.hskLevels?.length ? args.hskLevels.join("/") : "(not in HSK lists)",
    existing: args.existing?.trim() || "(none yet)",
    existingStory: args.existingStory?.trim() || "(none yet)",
  };
  return tpl.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole
  );
}

/**
 * Both properties are listed in `required` on purpose. When the user picks
 * Response format = `json_schema`, `buildResponseFormat` sends this with
 * `strict: true`, and strict mode rejects a schema whose
 * `additionalProperties: false` object has a property missing from
 * `required` — OpenAI enforces that, and so do the LiteLLM / vLLM proxies
 * people put in front of local models, while Ollama's grammar conversion
 * is lenient. Matches the shape the system prompt asks for; the parser
 * still treats a missing or empty `story` as absent.
 */
export const MNEMONIC_SCHEMA = {
  type: "object",
  required: ["mnemonic", "story"],
  additionalProperties: false,
  properties: {
    mnemonic: { type: "string" },
    story: { type: "string" },
  },
};

export function buildEnhanceSchema(includePinyin: boolean): object {
  const properties: Record<string, unknown> = {
    definitions: { type: "array", items: { type: "string" }, minItems: 1 },
    grammar: { type: "string" },
  };
  if (includePinyin) properties.pinyin = { type: "string" };
  return {
    type: "object",
    required: ["definitions"],
    additionalProperties: false,
    properties,
  };
}
