export const STORY_SYSTEM_PROMPT =
  "You are an expert writer of graded Chinese comprehensible input for adult Chinese learners. " +
  "Write natural, engaging Chinese using simple grammar and vocabulary appropriate to the requested HSK level. " +
  "Include all required target words naturally. Do not explain in English inside the story. " +
  "Output valid JSON only matching this shape: " +
  "{\"title\":string,\"targetLevel\":string,\"textChinese\":string,\"targetWordsUsed\":[{\"word\":string,\"used\":boolean,\"sentence\":string}],\"glossary\":[{\"word\":string,\"pinyin\":string,\"definition\":string}],\"notesForLearner\":string}. " +
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
  lengthChars: number;
}): string {
  const wordsBlock = args.targetWords
    .map((w, i) => `  ${i + 1}. ${w.word} (${w.pinyin}) — ${w.definition}`)
    .join("\n");
  return (
    `Create a Chinese ${args.style} for a learner around HSK ${args.targetHsk}.\n` +
    `Required target words (use every one at least once, naturally):\n${wordsBlock}\n` +
    `For all other vocabulary, prefer words at or below HSK ${args.targetHsk}.\n` +
    `Keep the ${args.style} coherent, enjoyable, and not childish unless requested.\n` +
    `Length: roughly ${args.lengthChars} Chinese characters.\n` +
    `Return JSON only with the key textChinese for the Chinese text. Do not include English explanations inside the Chinese text.`
  );
}

export function buildRepairPrompt(args: {
  originalText: string;
  missingWords: string[];
  tooHardWords: string[];
  targetHsk: string;
}): string {
  return (
    `Your previous output had problems. Revise the JSON to fix them.\n` +
    `Missing target words (must appear naturally): ${args.missingWords.join(", ") || "(none)"}.\n` +
    `Too-difficult vocabulary to replace with simpler alternatives at HSK ${args.targetHsk} or below: ${args.tooHardWords.join(", ") || "(none)"}.\n` +
    `Preserve valid parts of the previous text:\n---\n${args.originalText}\n---\n` +
    `Return revised JSON only.`
  );
}

export const STORY_SCHEMA = {
  type: "object",
  required: ["title", "targetLevel", "textChinese", "targetWordsUsed", "glossary"],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    targetLevel: { type: "string" },
    textChinese: { type: "string" },
    targetWordsUsed: {
      type: "array",
      items: {
        type: "object",
        required: ["word", "used"],
        additionalProperties: false,
        properties: {
          word: { type: "string" },
          used: { type: "boolean" },
          sentence: { type: "string" },
        },
      },
    },
    glossary: {
      type: "array",
      items: {
        type: "object",
        required: ["word", "pinyin", "definition"],
        additionalProperties: false,
        properties: {
          word: { type: "string" },
          pinyin: { type: "string" },
          definition: { type: "string" },
        },
      },
    },
    notesForLearner: { type: "string" },
  },
};
