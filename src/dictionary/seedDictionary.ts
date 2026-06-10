import { DictionaryEntry } from "./DictionaryTypes";

/**
 * Tiny seed dictionary so the plugin works out-of-the-box for testing.
 * Real CC-CEDICT data is loaded lazily at runtime from a Vault-side file
 * (see DictionaryService.loadFromVault) and is NOT bundled here for
 * license/size reasons. Run the build script described in NOTICE.md to
 * import a full CC-CEDICT shard set.
 */
export const SEED_ENTRIES: DictionaryEntry[] = [
  { simplified: "我", traditional: "我", pinyin: "wǒ", definitions: ["I", "me", "my"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "你", traditional: "你", pinyin: "nǐ", definitions: ["you (informal)"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "他", traditional: "他", pinyin: "tā", definitions: ["he", "him"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "她", traditional: "她", pinyin: "tā", definitions: ["she", "her"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "好", traditional: "好", pinyin: "hǎo", definitions: ["good", "well", "OK"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "是", traditional: "是", pinyin: "shì", definitions: ["to be", "yes", "is"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "不", traditional: "不", pinyin: "bù", definitions: ["not", "no"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "了", traditional: "了", pinyin: "le", definitions: ["(completed action particle)"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "在", traditional: "在", pinyin: "zài", definitions: ["at", "in", "on", "exist"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "有", traditional: "有", pinyin: "yǒu", definitions: ["to have", "there is"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "人", traditional: "人", pinyin: "rén", definitions: ["person", "people"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "中国", traditional: "中國", pinyin: "Zhōng guó", definitions: ["China"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "中文", traditional: "中文", pinyin: "Zhōng wén", definitions: ["Chinese language"], hsk: { source: "2.0", levels: ["2"] } },
  { simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["to study", "to learn"], hsk: { source: "2.0", levels: ["2"] } },
  { simplified: "学生", traditional: "學生", pinyin: "xué sheng", definitions: ["student"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "老师", traditional: "老師", pinyin: "lǎo shī", definitions: ["teacher"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "朋友", traditional: "朋友", pinyin: "péng you", definitions: ["friend"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "马上", traditional: "馬上", pinyin: "mǎ shàng", definitions: ["at once", "immediately"], hsk: { source: "2.0", levels: ["3"] } },
  { simplified: "马", traditional: "馬", pinyin: "mǎ", definitions: ["horse"], hsk: { source: "2.0", levels: ["3"] } },
  { simplified: "上", traditional: "上", pinyin: "shàng", definitions: ["on", "upon", "above"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "研究", traditional: "研究", pinyin: "yán jiū", definitions: ["research", "to study"], hsk: { source: "2.0", levels: ["5"] } },
  { simplified: "研究生", traditional: "研究生", pinyin: "yán jiū shēng", definitions: ["graduate student", "postgraduate"], hsk: { source: "2.0", levels: ["6"] } },
  { simplified: "生", traditional: "生", pinyin: "shēng", definitions: ["to be born", "raw"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "今天", traditional: "今天", pinyin: "jīn tiān", definitions: ["today"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "明天", traditional: "明天", pinyin: "míng tiān", definitions: ["tomorrow"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "天气", traditional: "天氣", pinyin: "tiān qì", definitions: ["weather"], hsk: { source: "2.0", levels: ["2"] } },
  { simplified: "喜欢", traditional: "喜歡", pinyin: "xǐ huan", definitions: ["to like"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "吃", traditional: "吃", pinyin: "chī", definitions: ["to eat"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "饭", traditional: "飯", pinyin: "fàn", definitions: ["cooked rice", "meal"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "去", traditional: "去", pinyin: "qù", definitions: ["to go"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "说", traditional: "說", pinyin: "shuō", definitions: ["to speak", "to say"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "话", traditional: "話", pinyin: "huà", definitions: ["speech", "talk", "words"], hsk: { source: "2.0", levels: ["2"] } },
  { simplified: "什么", traditional: "什麼", pinyin: "shén me", definitions: ["what?"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "怎么", traditional: "怎麼", pinyin: "zěn me", definitions: ["how?"], hsk: { source: "2.0", levels: ["1"] } },
  { simplified: "为什么", traditional: "為什麼", pinyin: "wèi shén me", definitions: ["why?"], hsk: { source: "2.0", levels: ["2"] } },
  { simplified: "因为", traditional: "因為", pinyin: "yīn wèi", definitions: ["because"], hsk: { source: "2.0", levels: ["2"] } },
  { simplified: "所以", traditional: "所以", pinyin: "suǒ yǐ", definitions: ["therefore"], hsk: { source: "2.0", levels: ["2"] } },
];
