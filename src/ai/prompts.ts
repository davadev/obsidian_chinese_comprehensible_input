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
