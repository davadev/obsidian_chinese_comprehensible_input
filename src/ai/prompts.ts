import {
  WordShape,
  expectedGroups,
  pictureBudget,
  toneMark,
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
 * The model draws; the app counts. It returns one picture group per character and the
 * story. The app attaches each character's tone number, writes the line, and writes the word's own pinyin into the
 * story (`mnemonicFacts.ts`), because tones and pinyin are facts the app already has and the model gets them wrong:
 * measured on a 53-word gold set, the previous prompt, which asked the model to write the tone cues, got them wrong
 * for up to half of the words on `gpt-5.4-mini` and put Chinese characters into the emoji line.
 *
 * These rules live in the SYSTEM prompt so users who customised their user template still get them.
 */
export const MNEMONIC_SYSTEM_PROMPT =
  "You are an expert coach for Chinese character mnemonics for adult learners. " +
  "You return a picture group for each character and a short story that explains them.\n" +
  "\n" +
  "\"isName\" — true only when, in the sentence the learner met the word in, the word is used as a person's name or part of one, or as another proper name (a place, a brand). Then leave \"characters\" as an empty array: the app writes a name badge itself. In \"story\" write one plain sentence saying that the word is a name here, with the word's pinyin. Otherwise false.\n" +
  "\n" +
  "\"characters\" — an array with exactly one string per character, in order. The request says how many. Each string is 1 to 3 emoji and nothing else: no Chinese characters, no English words, no letters, no digits. The app writes a tone number after each group by itself, so never write tones.\n" +
  "- Each group is a picture of what that character MEANS in this word: a concrete image a learner can see. For a word of several characters, choose the pictures so that, in order, they hint at the meaning of the whole word. For a single character, picture its meaning; do not draw its strokes or parts.\n" +
  "- Where no picture carries the idea (a grammar particle, an abstract sense) use a symbol emoji, for example ✅ completed, ❓ question, ➕ addition, ⏳ ongoing, 🔁 repeat. Arrows are fine when the meaning needs them.\n" +
  "\n" +
  "All groups TOGETHER must fit the character budget given in the request. Shorter is better. No sentences, no trailing punctuation.\n" +
  "\n" +
  "\"story\" — the prose that unpacks the pictures:\n" +
  "- One short paragraph, plain English, second person (\"you\").\n" +
  "- Say which emoji stands for which character, and finish on the English meaning as the punchline.\n" +
  "- Put the tone-marked pinyin in parentheses right after each of the word's own characters, the way the request lists them — 学 (xué). Do not give pinyin for anything else.\n" +
  "- Concrete, sensory, slightly absurd imagery — absurd is memorable.\n" +
  "- Never mention the app and never talk about sound hints; the tone numbers are added for you.\n" +
  "- You may mention what a character looks like if it helps the picture stick, but never invent parts a character does not have.\n" +
  "\n" +
  "Output strict JSON only matching this shape: " +
  "{\"isName\":boolean,\"characters\":[string],\"story\":string}. " +
  "No prose before or after the JSON. No markdown code fences.";

/**
 * Default user-prompt template for mnemonic generation. Users can rewrite
 * this in Settings → AI provider → AI prompts → Mnemonics to personalise the
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
    `Budget for all groups together: ${pictureBudget(shape)} characters. Return exactly ${want} string(s) in "characters".`
  );
  return lines.join("\n");
}

/** The single follow-up when the answer broke a rule the app can check. */
export function buildMnemonicRepairPrompt(issues: string[]): string {
  return (
    `Your last answer broke these rules:\n${issues.map((i) => `- ${i}`).join("\n")}\n` +
    `Reply again with corrected JSON only, keeping what was already good. Where a Chinese character, an English word or a letter crept into a picture group, replace it with an emoji or leave it out.`
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
  required: ["isName", "characters", "story"],
  additionalProperties: false,
  properties: {
    isName: { type: "boolean" },
    characters: { type: "array", items: { type: "string" } },
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

/**
 * System prompt for the Explain note (#186): a thorough usage note for ONE word, as JSON. The plugin lays the fields
 * out (`explain.ts`), so the model never writes Markdown, and checks what it can (examples contain the word, rows are
 * complete) before asking once more.
 */
export const EXPLAIN_SYSTEM_PROMPT =
  "You are an expert teacher of Mandarin Chinese for adult English-speaking learners. " +
  "Write a thorough, accurate and well organised usage note for ONE word, as the JSON described below. " +
  "The note is read on a phone as well as on a desktop, so every item is short and concrete: no long paragraphs.\n" +
  "\n" +
  "How to treat the facts: the request gives the pinyin, the HSK level and the dictionary entries. They are ground truth for pronunciation and for the meanings they list; you may add senses and usage that real speakers have, but never contradict the dictionary on pronunciation. " +
  "Be honest. If you are not sure of a usage rule, an etymology or a decomposition, say so in that field or leave it out; an empty list is better than a padded or invented one. Every Chinese sentence must be natural Mandarin that a native speaker would say.\n" +
  "\n" +
  "Fields:\n" +
  "- \"summary\": one or two sentences saying what the word is and why a learner needs it.\n" +
  "- \"meaning\": the core meaning in at most 12 words.\n" +
  "- \"partOfSpeech\": for example \"verb\", \"adjective\", \"noun (measure word: 个)\", \"separable verb (verb-object)\", \"particle\", \"measure word\".\n" +
  "- \"register\": for example \"neutral\", \"spoken\", \"formal / written\", \"more common in Taiwan\". Keep it short.\n" +
  "- \"whenYouNeedIt\": 2 to 4 concrete situations in which a learner would reach for this word, each starting with the intent (\"To say that…\").\n" +
  "- \"senses\": every sense a learner will meet, most common first, each with a short label, the English meaning, and one short Chinese example sentence with its English (empty strings if none is needed). If the dictionary lists more than one reading with different meanings (for example 行 háng and xíng), cover every common reading: start each such label with the pinyin (\"xíng — to walk; OK\"), give examples for each, and use \"notes\" to say how to tell them apart.\n" +
  "- \"grammar\": \"pattern\" is how the word is used in a sentence (for example \"Subject + 打算 + Verb\"); \"measureWord\" is the classifier(s) for a noun, else \"\"; \"notes\" are short points about position, objects and complements, negation, separable verbs, and common patterns. For a particle or other function word, explain it as a grammar point instead of a vocabulary item.\n" +
  "- \"collocations\": 3 to 8 common combinations and set phrases, each with pinyin and English.\n" +
  "- \"examples\": 5 to 8 natural sentences that each contain the word itself, across DIFFERENT contexts and registers (daily life, work or study, social, formal or written, spoken). Give each a short \"context\" label, tone-marked pinyin and an English translation. Use common vocabulary at or just above the word's HSK level so the learner can read them.\n" +
  "- \"pitfalls\": 0 to 3 pitfalls that really trip learners up with this word. Build each one only from something you have already put in this note: \"similar-word\" (mixing it up with one of the words you list under \"similar\"), \"pattern\" (breaking the sentence pattern or negation rule you gave), \"english-habit\" (word order or a missing or extra particle carried over from English), or \"register\" (using it in the wrong register). \"kind\" is one of those four. \"rule\" is the pitfall as one short instruction (\"Put the time before the place.\"). \"right\" is the correct fragment or sentence that follows the rule. Do not write the wrong version. Leave out anything you are not sure of: an empty list is better than a weak pitfall.\n" +
  "- \"similar\": near-synonyms or easily confused words (0 to 4), each with pinyin and how it differs and when to choose which. Leave empty if there are none worth contrasting.\n" +
  "- \"characters\": exactly one entry per character of the word, in order, each with its tone-marked \"pinyin\" as it is read in this word. \"meaning\" is what the character means on its own, in at most 8 words. \"radical\" is the radical with its meaning. \"components\" says how the character is built from parts, for example \"木 (tree) on top of 目 (eye)\", and for a character built from a part that gives the sound and a part that gives the meaning, say which is which. \"etymology\" is where the character comes from, in one or two sentences, only if you know a well-established account, else \"\". Set \"confidence\" to \"established\" only when both the breakdown (including which part gives the sound or the meaning) and the origin are the standard scholarly account; use \"uncertain\" for a popular story, a folk etymology, a doubtful split or when you are not sure. Do not invent a breakdown or an etymology to fill a field. If the character is a single indivisible form, or you know of no reliable structure, leave \"components\" and \"etymology\" as empty strings and set \"confidence\" to \"established\" (there is nothing doubtful to flag).\n" +
  "- \"notes\": 0 to 4 useful extras: differences between mainland and Taiwan usage, politeness or tone, frequency, related idioms, or other tips. Empty if nothing is worth adding.\n" +
  "\n" +
  "Rules: Chinese and English only, no Markdown, no emoji. Give tone-marked pinyin for every Chinese sentence, collocation and character. Explain in English. " +
  "Output strict JSON only matching the schema, with every field present (an empty string or empty list when there is nothing to say). No prose before or after the JSON. No markdown code fences.";

export interface ExplainPromptArgs {
  surface: string;
  pinyin: string;
  traditional?: string;
  hskLevels: string[];
  /** Every dictionary entry for the surface (several readings are possible). */
  entries: { pinyin: string; definitions: string[] }[];
  /** One line of facts per character of the word. */
  chars: { char: string; pinyin: string; gloss: string }[];
  /** The sentence the learner met the word in, when known. */
  sentence?: string;
  script: AiScript;
}

/** The facts the plugin already has, so the model works from them instead of from memory. */
export function buildExplainUserPrompt(a: ExplainPromptArgs): string {
  const trad = a.traditional && a.traditional !== a.surface ? a.traditional : "(same)";
  const level = a.hskLevels.length ? `HSK ${a.hskLevels.join("/")}` : "not in the HSK lists";
  const lines = [
    `Word: ${a.surface}`,
    `Pinyin: ${a.pinyin || "(unknown)"}`,
    `Traditional: ${trad}`,
    `Level: ${level}`,
    scriptClause(a.script),
    "",
    "Dictionary entries (ground truth for pronunciation and the meanings listed):",
    ...(a.entries.length
      ? a.entries.map((e, i) => `${i + 1}. ${e.pinyin} — ${e.definitions.filter((d) => d.trim()).join("; ") || "(no definition)"}`)
      : ["(none: the word is not in the dictionary)"]),
    "",
    "Characters:",
    ...a.chars.map((c, i) => `${i + 1}. ${c.char} ${c.pinyin}${c.gloss ? ` — ${c.gloss}` : ""}`),
  ];
  if (a.sentence?.trim()) {
    lines.push("", `The learner met the word in this sentence (use it to pick the sense they need, but cover the other senses too): ${a.sentence.trim()}`);
  }
  lines.push("", "Write the note now. Reply with JSON only.");
  return lines.join("\n");
}

/** The single follow-up when the answer broke a rule the plugin can check. */
export function buildExplainRepairPrompt(issues: string[]): string {
  return (
    `Your last answer broke these rules:\n${issues.map((i) => `- ${i}`).join("\n")}\n` +
    `Reply again with the complete corrected JSON only, keeping what was already good and using exactly the field names and nesting from the instructions.`
  );
}

/** The quick check made before a phrase is explained: is it generally correct? Small, so it is cheap and fast. */
export const PHRASE_CHECK_SYSTEM_PROMPT =
  "You check a short piece of Mandarin Chinese before it is explained to a learner. Decide whether it is generally correct and natural enough to explain. " +
  "Be lenient: spoken, informal, regional or elliptical Chinese is fine, and style is not your business. " +
  "Reply with a verdict: \"ok\" when it is fine; \"typo\" when the only problem is a typo (a wrong, missing or extra character or punctuation mark) whose intended meaning is obvious, in which case \"original\" is the wrong fragment, \"suggestion\" the fix and \"note\" a few words; " +
  "\"wrong\" only when the grammar or word choice is broken enough that explaining the text as it stands would teach the learner something false, or when it is not Chinese or not a sentence, in which case \"note\" says in one or two English sentences what is wrong. " +
  "Use empty strings for fields that do not apply. Output strict JSON only matching the schema. No prose before or after. No markdown code fences.";

export function buildPhraseCheckUserPrompt(text: string): string {
  return `Text:\n${text}\n\nCheck it. Reply with JSON only.`;
}

/**
 * The phrase explanation: the big picture and the grammatical job of every word, not a dictionary entry per word (the word
 * note already does that). The plugin checks that the word-by-word list covers the whole selection.
 */
export const PHRASE_SYSTEM_PROMPT =
  "You are an expert teacher of Mandarin Chinese for adult English-speaking learners. The learner selected a short piece of Chinese from something they are reading and wants to understand it. " +
  "Explain it as the JSON described below. Focus on the big picture: what the whole text says and does, and what role each word plays in it grammatically. Do NOT simply define each word as a dictionary would. " +
  "The note is read on a phone as well as on a desktop, so every item is short and concrete.\n" +
  "\n" +
  "Fields:\n" +
  "- \"translation\": a natural English translation of the whole text, not word for word.\n" +
  "- \"expresses\": one or two sentences on what the text expresses or does (a plan, a complaint, politeness, a contrast…), its tone, and when someone would say it.\n" +
  "- \"register\": a few words (neutral, spoken, formal, written…).\n" +
  "- \"structure\": the skeleton of the sentence as a pattern, for example \"Time + Subject + 打算 + Verb + Place\". For several sentences give one line per sentence, separated by \" / \".\n" +
  "- \"breakdown\": EVERY word of the text, in order, each exactly once, so that reading all the \"text\" values one after another reproduces the text (ignore punctuation, do not list it). Keep exactly what is written, even a mistyped character. Group a fixed word as one entry (北京, 因为) and give a particle its own entry. For each: \"text\", tone-marked \"pinyin\", \"role\" (the word's grammatical job in this sentence, for example \"subject\", \"time word placed before the verb\", \"measure word\", \"aspect particle marking a completed action\", \"conjunction linking the two clauses\") and \"meaning\" (its sense here, in a few words).\n" +
  "- \"grammarPoints\": 1 to 4 grammar patterns or points that make this text work, each with \"point\" (a name or pattern), \"explanation\" (one or two simple sentences) and \"example\" (one short extra example of the same pattern with its English in brackets, or \"\" if none is needed).\n" +
  "- \"typo\": only when the request says the text has a typo: one short line saying what it is and the fix; do not dwell on it. Otherwise \"\".\n" +
  "- \"notes\": 0 to 3 useful extras (a nuance, a common alternative, a regional difference); empty if nothing is worth adding.\n" +
  "\n" +
  "Rules: Chinese and English only, no Markdown, no emoji. Explain in English. Give tone-marked pinyin for every Chinese word you write. Keep any Chinese you write in the same script (Simplified or Traditional) as the text. " +
  "Output strict JSON only matching the schema, with every field present (an empty string or empty list when there is nothing to say). No prose before or after the JSON. No markdown code fences.";

export function buildPhraseUserPrompt(a: { text: string; typo?: string }): string {
  const lines = [`Text to explain:\n${a.text}`];
  if (a.typo?.trim()) lines.push("", `The text has a typo (${a.typo.trim()}). Explain the words as written, mention the typo in "typo" and do not dwell on it.`);
  lines.push("", "Write the explanation now. Reply with JSON only.");
  return lines.join("\n");
}

/** The proofreader: real mistakes only, the smallest fix for each, and why. */
export const PROOFREAD_SYSTEM_PROMPT =
  "You proofread a short piece of Mandarin Chinese for an adult learner. Find REAL mistakes only: a wrong, missing or extra character, a grammar error, a wrong word or measure word, an unnatural word order, wrong punctuation. " +
  "Do not restyle or improve text that is correct; spoken, informal and regional Chinese is fine. Do not rewrite sentences. " +
  "For each mistake give the smallest fix: \"original\" is copied EXACTLY from the text (the shortest span that contains the mistake, at least one character, and different corrections must not overlap), " +
  "\"replacement\" is the corrected span (an empty string if the fix is to delete), and \"why\" is one short sentence in English saying what is wrong. " +
  "Keep the replacement in the same script (Simplified or Traditional) as the text. Give at most 5 corrections, the most important ones. If nothing is wrong, return an empty list. " +
  "Output strict JSON only matching the schema. No prose before or after. No markdown code fences.";

export function buildProofreadUserPrompt(text: string): string {
  return `Text to proofread:\n${text}\n\nReply with JSON only.`;
}

/** Which learner-tunable prompt a request uses. */
export type TunablePrompt = "explain" | "phrase" | "proofread";

/** What the learner changed for one prompt: text to add, or a replacement for the whole system prompt. */
export interface PromptCustom {
  extra: string;
  override: string;
}

export const NO_CUSTOM: PromptCustom = { extra: "", override: "" };

/**
 * The system prompt to send: the built-in one, or the learner's replacement when they wrote one, followed by their extra
 * instructions. The JSON schema and the checks that follow every answer do not change, so a prompt that ignores the
 * format falls into the normal repair path instead of producing a broken note.
 */
export function systemPromptWith(builtin: string, custom: PromptCustom): string {
  const base = custom.override.trim() ? custom.override.trim() : builtin;
  const extra = custom.extra.trim();
  return extra
    ? `${base}\n\nThe learner's own instructions (follow them, but keep the required JSON structure and every rule above): ${extra}`
    : base;
}
