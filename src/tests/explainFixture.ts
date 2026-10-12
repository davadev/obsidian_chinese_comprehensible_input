import type { ExplainMeta, ExplainResult } from "../ai/explain";

/** A complete, valid explanation of 方便 used across the Explain tests. */
export const FULL: ExplainResult = {
  summary: "A very common word for things that are easy, handy or suitable.",
  meaning: "convenient; easy; to make things easy",
  partOfSpeech: "adjective, also a verb",
  register: "neutral",
  whenYouNeedIt: ["To say that a place or a plan is easy to use", "To ask whether now is a good time"],
  senses: [
    { label: "Convenient", meaning: "easy and handy", example: "住在这里很方便。", exampleEnglish: "Living here is convenient." },
    { label: "Suitable", meaning: "at a good time for someone", example: "", exampleEnglish: "" },
  ],
  grammar: { pattern: "Subject + 很 + 方便", measureWord: "", notes: ["Often follows 很.", "Negated with 不方便."] },
  collocations: [{ chinese: "很方便", pinyin: "hěn fāngbiàn", english: "very convenient" }],
  examples: [
    { context: "Daily life", chinese: "这里买东西很方便。", pinyin: "Zhèlǐ mǎi dōngxi hěn fāngbiàn.", english: "Shopping here is convenient." },
    { context: "Work", chinese: "你明天方便开会吗？", pinyin: "Nǐ míngtiān fāngbiàn kāihuì ma?", english: "Are you free for a meeting tomorrow?" },
    { context: "Spoken", chinese: "现在不方便说话。", pinyin: "Xiànzài bù fāngbiàn shuōhuà.", english: "I can't talk right now." },
    { context: "Travel", chinese: "坐地铁最方便。", pinyin: "Zuò dìtiě zuì fāngbiàn.", english: "The subway is the most convenient." },
  ],
  pitfalls: [
    { kind: "pattern", rule: "Put the time before 方便, then the activity.", right: "你明天方便见面吗？" },
    { kind: "similar-word", rule: "Use 便利 for facilities, 方便 for people and times.", right: "交通便利 / 你方便吗？" },
  ],
  similar: [{ word: "便利", pinyin: "biànlì", difference: "More formal, used for facilities and services." }],
  characters: [
    { character: "方", pinyin: "fāng", meaning: "square; direction", radical: "方 (square)" },
    { character: "便", pinyin: "biàn", meaning: "convenient", radical: "人 / 亻 (person)" },
  ],
  notes: ["In Taiwan 方便 is used the same way."],
};

export const META: ExplainMeta = {
  word: "方便",
  pinyin: "fāng biàn",
  key: "方便|fang1bian4",
  hsk: "3",
  provider: "openai",
  model: "gpt-6-luna",
  date: "2026-10-12",
  showPinyin: true,
};

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
