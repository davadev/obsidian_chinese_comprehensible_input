import {
  WordShape,
  expectedGroups,
  pictureBudget,
  toneMark,
  wantsMeaning,
} from "./mnemonicFacts";

export const STORY_SYSTEM_PROMPT =
  "You are an expert writer of graded Chinese comprehensible input for adult Chinese learners. " +
  "Write natural, engaging Chinese using simple grammar and vocabulary appropriate to the requested HSK level. " +
  "Include all required target words naturally inside the story itself — they must appear in the textChinese body, not in any explanation or list. " +
  "Where it fits the story naturally, use a target word more than once for stronger learner exposure — but never force it if it disrupts the flow. " +
  "Do not explain in English inside the story. " +
  "Break anything longer than a few sentences into short paragraphs separated by a blank line (a \\n\\n inside the textChinese string), so it is easy to read. " +
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

/**
 * The script/usage clause for a generated text.
 *
 * Asking only for Traditional characters is not enough: it yields Mainland
 * vocabulary in Traditional clothing, which reads wrong to a Taiwan learner.
 * CC-CEDICT tags roughly 1,280 entries `(Tw)` and carries both halves of every common
 * pair (網路/網絡, 影片/視頻, 軟體/軟件), so the distinction is real.
 */
export type AiScript = "simplified" | "traditional";

/**
 * Which script to ask the model for.
 *
 * `scriptVariant` can be "auto", which is a reading mode — it means "index both
 * and show me what I read". Generation has to commit to one, and there is no
 * note to look at, so decide from the target words themselves: any
 * traditional-only character among them means the learner is working in
 * Traditional.
 *
 * Threshold of one, not the three `looksTraditional()` uses. That threshold
 * guards against an incidental quotation inside a page of prose; here the input
 * is a short list of words the learner has actually been studying, where a
 * single traditional-only character is already decisive.
 */
export function resolveAiScript(
  variant: "simplified" | "traditional" | "auto",
  targetWords: string[],
  countTraditionalMarkers: (text: string) => number
): AiScript {
  if (variant !== "auto") return variant;
  return countTraditionalMarkers(targetWords.join("")) > 0 ? "traditional" : "simplified";
}

export function scriptClause(script: AiScript): string {
  return script === "traditional"
    ? "Write the Chinese in Traditional characters as used in Taiwan, and prefer Taiwanese Mandarin " +
        "vocabulary and usage (e.g. 網路 rather than 網絡, 影片 rather than 視頻). Do not use Simplified forms."
    : "Write the Chinese in Simplified characters as used in mainland China. Do not use Traditional forms.";
}

export function buildUserPrompt(args: {
  style: "story" | "article" | "dialogue";
  targetHsk: string;
  targetWords: TargetWord[];
  knownWords?: string[];
  lengthChars: number;
  script: AiScript;
}): string {
  const wordsBlock = args.targetWords
    .map((w, i) => `  ${i + 1}. ${w.word} (${w.pinyin}) — ${w.definition}`)
    .join("\n");
  const knownWordsBlock = args.knownWords?.length
    ? `Words the learner already knows (use these as examples for suitable filler vocabulary, but target words above are still required):\n${args.knownWords.join("、")}\n`
    : "";
  return (
    `Create a Chinese ${args.style} for a learner around HSK ${args.targetHsk}.\n` +
    `${scriptClause(args.script)}\n` +
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
  script: AiScript;
  /** The last attempt came back in the wrong script. Can be true with no
   *  missing words at all, which changes what the prompt should lead with. */
  wrongScript?: boolean;
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
  // The story can be sent back for the script alone, with every target word
  // present — so don't open by accusing the model of missing words it did not
  // miss. Naming the actual defect first is what gets it fixed.
  const lead = args.missingTargetWords.length
    ? "Your previous Chinese story attempts repeatedly miss required target words."
    : "Your previous Chinese story attempt was written in the wrong script.";
  const scriptLine = args.wrongScript
    ? `The last attempt contains no Traditional-only characters, so it was written in ` +
      `Simplified. Rewrite it in Traditional characters throughout.\n`
    : "";
  return (
    `${lead} ` +
    `Here is the full history of attempts so far:\n\n` +
    `${attemptsBlock}\n\n` +
    `${scriptLine}` +
    `${args.missingTargetWords.length} of ${args.totalTargets} target words are still missing from textChinese.\n` +
    `Each missing word below MUST appear at least once verbatim inside textChinese, ` +
    `as the exact surface form given. Putting it in a glossary, comment, ` +
    `or paraphrase does NOT count. Where natural, use a missing target word more than once.\n` +
    `${scriptClause(args.script)}\n\n` +
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
 * System prompt for the AI mnemonic generator (#49, reshaped for #185).
 *
 * The model draws; the app counts. It returns one picture group per character, an optional meaning strip, and the
 * story. The app attaches each character's tone number, writes the line, and writes the word's own pinyin into the
 * story (`mnemonicFacts.ts`), because tones and pinyin are facts the app already has and the model gets them wrong:
 * measured on a 53-word gold set, the previous prompt, which asked the model to write the tone cues, got them wrong
 * for up to half of the words on `gpt-5.4-mini` and put Chinese characters into the emoji line.
 *
 * These rules live in the SYSTEM prompt so users who customised their user template still get them.
 */
export const MNEMONIC_SYSTEM_PROMPT =
  "You are an expert coach for Chinese character mnemonics for adult learners. " +
  "You return THREE things for one word: a picture group for each character, an emoji strip for the meaning, and a short story that explains them.\n" +
  "\n" +
  "\"characters\" — an array with exactly one string per picture group, in order. The request says how many. Each string is 1 to 3 emoji (up to 4 for a single character) and nothing else: no Chinese characters, no letters, no digits. The app writes a tone number after each group by itself, so never write tones.\n" +
  "- A word of several characters gets one group per character: a picture of what that character means or looks like, chosen so that the pictures in order hint at the meaning of the whole word.\n" +
  "- A single character (or whatever the request lists as one group) gets the picture of the parts it is built from, as concrete images.\n" +
  "\n" +
  "\"meaning\" — only when the request asks for exactly one group: an emoji strip for the meaning, at most 14 characters, no Chinese characters. Use an ENGLISH word (one or two at most) only where no emoji can carry the idea (grammar particles, abstract senses). Arrows are fine when the meaning needs them. For a word with several groups return an empty string.\n" +
  "\n" +
  "All groups and the meaning TOGETHER must fit the character budget given in the request. Shorter is better. No sentences, no trailing punctuation.\n" +
  "\n" +
  "\"story\" — the prose that unpacks the pictures:\n" +
  "- One short paragraph, plain English, second person (\"you\").\n" +
  "- Say which emoji stands for which character or part, and finish on the English meaning as the punchline.\n" +
  "- Put the tone-marked pinyin in parentheses right after each of the word's own characters, the way the request lists them — 学 (xué). Do not give pinyin for parts: name a part by its English picture (the water radical, the heart), or write the character bare.\n" +
  "- Concrete, sensory, slightly absurd imagery — absurd is memorable.\n" +
  "- Never mention the app and never talk about sound hints; the tone numbers are added for you.\n" +
  "- Never invent parts a character does not have; if a split is not helpful, describe what the character actually looks like.\n" +
  "\n" +
  "Output strict JSON only matching this shape: " +
  "{\"characters\":[string],\"meaning\":string,\"story\":string}. " +
  "No prose before or after the JSON. No markdown code fences.";

/**
 * Default user-prompt template for mnemonic generation. Users can rewrite
 * this in Settings → AI provider → Mnemonic prompt to personalise the
 * result (their own imagery, humour, language, memory palace, …). The facts
 * block (characters, tones, budget) is appended by the app whatever the
 * template says, so a rewritten template cannot lose it.
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
  "Give me the picture groups and the story for this word. Reply with JSON only.";

/**
 * The default template through 0.8.2, which told the model to encode the tone itself. Anyone who never edited the
 * template has it stored in their settings, so it is swapped for the current one on load (`migrateMnemonicPrompt`).
 * A template the user did edit is left alone.
 */
export const LEGACY_MNEMONIC_USER_TEMPLATE =
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
  /** For a word of several characters: one short dictionary gloss per Han character, in order. */
  charGlosses?: string[];
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
 * What the app appends to the user prompt whatever the template says: the characters in order with the tone number
 * the app will attach to each, a short gloss per character for a multi-character word, how many picture groups to
 * return, and the character budget. This is the "fact sheet" of #185.
 */
export function buildMnemonicFactsBlock(shape: WordShape, glosses?: string[]): string {
  const want = expectedGroups(shape);
  const lines: string[] = [
    `Characters (give one picture group for each, in this order; the app attaches the tone number after it):`,
  ];
  if (shape.syllables) {
    shape.chars.forEach((c, i) => {
      const gloss = shape.chars.length > 1 ? glosses?.[i]?.trim() : "";
      lines.push(
        `${i + 1}. ${c} ${shape.syllables?.[i]} — tone number ${toneMark(shape.tones[i])}${gloss ? ` — means: ${gloss}` : ""}`
      );
    });
  } else {
    lines.push(`(the pinyin does not split one syllable per character, so treat the whole word as one group)`);
  }
  lines.push(
    `Budget for all groups + meaning together: ${pictureBudget(shape)} characters. Return exactly ${want} string(s) in "characters".` +
      (wantsMeaning(shape) ? ` Also fill "meaning".` : ` Return "" for "meaning".`)
  );
  return lines.join("\n");
}

/** The single follow-up when the answer broke a rule the app can check. */
export function buildMnemonicRepairPrompt(issues: string[]): string {
  return (
    `Your last answer broke these rules:\n${issues.map((i) => `- ${i}`).join("\n")}\n` +
    `Reply again with corrected JSON only, keeping what was already good. Where a Chinese character crept into a picture group, draw it as an emoji or leave it out.`
  );
}

/**
 * All three properties are listed in `required` on purpose. When the user picks
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
  required: ["characters", "meaning", "story"],
  additionalProperties: false,
  properties: {
    characters: { type: "array", items: { type: "string" } },
    meaning: { type: "string" },
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
