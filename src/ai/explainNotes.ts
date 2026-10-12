import { App, normalizePath, TFile } from "obsidian";
import type { DictionaryEntry } from "../dictionary/DictionaryTypes";
import { displayPinyin } from "../dictionary/displayForms";
import { radicalOf } from "../dictionary/radicals";
import { makeKey, shortenDefinition } from "../dictionary/normalizeChinese";
import type { PronunciationRegion, ScriptVariant } from "../settings/types";
import type { WordRecord } from "../vocabulary/VocabularyTypes";
import type { ExplainInput } from "./ExplainService";
import { wordShape } from "./mnemonicFacts";
import { resolveAiScript } from "./prompts";
import { ensureFolder } from "./noteFiles";

/** At most this many dictionary entries (readings) are sent, each with at most this many definitions. */
const MAX_ENTRIES = 4;
const MAX_DEFINITIONS = 8;

/** Definitions that say nothing a learner can use about a character on its own. */
const UNHELPFUL_GLOSS = /^(\(?surname\b|variant of\b|old variant of\b|archaic variant of\b|also written\b|see\b|abbr\. for\b|used in\b|\(onom\.\))/i;

/** The first definition of the character, over all its entries, that tells the learner what it means. */
function characterGloss(entries: DictionaryEntry[]): string {
  const all = entries.flatMap((e) => e.definitions);
  return shortenDefinition(all.find((d) => !UNHELPFUL_GLOSS.test(d.trim())) ?? all[0] ?? "", 40);
}

export interface ExplainDeps {
  lookup: (surface: string) => DictionaryEntry[];
  bySurface: (surface: string) => WordRecord | undefined;
  region: PronunciationRegion;
  scriptVariant: ScriptVariant;
  /** Count of characters only used in Traditional, for choosing a script when the setting is "auto". */
  countTraditionalMarkers: (text: string) => number;
}

/** The vocabulary key of the word (`simplified|pinyin`), so a saved note can be found again whatever it is renamed to. */
export function explainKey(deps: Pick<ExplainDeps, "lookup" | "bySurface">, surface: string): string {
  const rec = deps.bySurface(surface);
  if (rec) return rec.key;
  const top = deps.lookup(surface)[0];
  return top ? makeKey(top.simplified, top.pinyin) : surface;
}

/**
 * What the model is told about the word: the pinyin the learner sees, every dictionary reading with its meanings, a
 * line per character that uses the reading this word actually has (a polyphone character is not given the wrong one),
 * and the sentence it was met in.
 */
export function explainInputFor(deps: ExplainDeps, surface: string, sentence: string | undefined): ExplainInput {
  const entries = deps.lookup(surface);
  const top = entries[0];
  const rec = deps.bySurface(surface);
  const pinyin = displayPinyin(top, rec, deps.region);
  const shape = wordShape(surface, pinyin);
  return {
    surface,
    pinyin,
    traditional: top?.traditional ?? rec?.traditional,
    hskLevels: rec?.hsk?.levels ?? top?.hsk?.levels ?? [],
    entries: entries.slice(0, MAX_ENTRIES).map((e) => ({
      pinyin: displayPinyin(e, undefined, deps.region),
      definitions: e.definitions.slice(0, MAX_DEFINITIONS),
    })),
    chars: shape.chars.map((char, i) => ({
      char,
      pinyin: shape.syllables?.[i] ?? displayPinyin(deps.lookup(char)[0], undefined, deps.region),
      gloss: characterGloss(deps.lookup(char)),
      radical: radicalOf(char),
    })),
    sentence,
    script: resolveAiScript(deps.scriptVariant, [surface], deps.countTraditionalMarkers),
  };
}

/**
 * The explanation note for this word, wherever the user moved or renamed it, found through the key in its frontmatter.
 * The newest one wins when there are several versions.
 */
export function findExplainNote(app: App, key: string): TFile | null {
  let best: TFile | null = null;
  let bestTime = -1;
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm?.["cci-explain"] !== true || fm["cci-word"] !== key) continue;
    if (f.stat.ctime > bestTime) {
      best = f;
      bestTime = f.stat.ctime;
    }
  }
  return best;
}

/** Create the note in `folder`, never overwriting: a second version of the same word gets " 2", " 3"… */
export async function saveExplainNote(app: App, folder: string, fileName: string, markdown: string): Promise<TFile> {
  const dir = normalizePath(folder);
  await ensureFolder(app, dir);
  const dot = fileName.lastIndexOf(".");
  const stem = fileName.slice(0, dot);
  const ext = fileName.slice(dot);
  let target = normalizePath(`${dir}/${fileName}`);
  for (let n = 2; app.vault.getAbstractFileByPath(target); n++) {
    target = normalizePath(`${dir}/${stem} ${n}${ext}`);
  }
  return app.vault.create(target, markdown);
}
