import { App, normalizePath, Notice, TFile } from "obsidian";
import { AiProviderService } from "./AiProviderService";
import { STORY_SCHEMA, STORY_SYSTEM_PROMPT, TargetWord, buildRepairPrompt, buildUserPrompt } from "./prompts";
import { GeneratedStory, StoryRequest } from "./aiTypes";
import { TokenizerService } from "../tokenizer/TokenizerService";
import { validateStory, ValidatorConfig } from "./StoryValidator";
import { SrsScheduler } from "../srs/SrsScheduler";
import { VocabularyStore } from "../vocabulary/VocabularyStore";
import { WordRecord } from "../vocabulary/VocabularyTypes";
import { CciSettings } from "../settings/types";
import { VIEW_TYPE_CHINESE } from "../constants";

/** Days to push a target word's SRS dueAt after a successful story
 *  generation. Lets the picker rotate to different words on the next
 *  run instead of always re-using the same dozen. */
const STORY_COOLDOWN_DAYS = 1;

/** Strip filesystem-illegal characters from a string so it can be used
 *  inside a vault filename. Caps length to keep results sensible. */
function sanitizeForFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class StoryGenerator {
  private generationInFlight = false;

  constructor(
    private app: App,
    private ai: AiProviderService,
    private tokenizer: TokenizerService,
    private srs: SrsScheduler,
    private vocab: VocabularyStore,
    private settings: () => CciSettings
  ) {}

  /**
   * Full LLM + validate + repair loop without committing a permanent
   * note. Writes the result to a fixed preview path inside the story
   * folder so the existing Chinese view can open it; the caller decides
   * whether to commit it as a real note (see commitPreviewAsNote) or
   * discard it (deletePreview).
   */
  async generatePreview(req: StoryRequest): Promise<StoryPreview> {
    if (this.generationInFlight) {
      throw new Error("Story generation is already running.");
    }
    this.generationInFlight = true;
    try {
      // Target-word selection: only send classified vocab to the LLM, and
      // prefer partially-known statuses (the user already has a foothold)
      // over fully unknown. Completely uncategorized "new" words are never
      // sent — they're not actionable review material.
      const partialStatuses = new Set<string>([
        "meaningKnownPinyinUnknown",
        "pinyinKnownMeaningUnknown",
        "charactersUnknown",
      ]);
      const dueAll = this.srs.due();
      // Shuffle within each priority bucket so two consecutive generations
      // don't keep picking the same first N words (the "Peking duck story
      // every time" problem). Bucket priority is preserved.
      const partial = shuffle(dueAll.filter((r) => partialStatuses.has(r.status)));
      const fullyUnknown = shuffle(dueAll.filter((r) => r.status === "unknown"));
      const dueRecords = [...partial, ...fullyUnknown].slice(0, req.dueCount);
      if (dueRecords.length === 0) {
        throw new Error(
          "No classified due words to review yet. Mark some words as unknown or partial first."
        );
      }
      const targetWords: TargetWord[] = dueRecords.map((r) => ({
        word: r.simplified ?? r.surfaces[0],
        pinyin: r.pinyin ?? "",
        definition: (r.definitions ?? []).slice(0, 2).join("; "),
      }));

      const targetHsk = req.targetHsk === "auto" ? String(this.estimateHsk()) : req.targetHsk;

      const initialStory = await this.callOnce(req, targetWords, targetHsk);
      const cfg: ValidatorConfig = {
        targetHsk: parseInt(targetHsk, 10) || 0,
        lengthChars: req.lengthChars,
        tooHardRatioCap: 0.15,
      };
      const targetSurfaces = targetWords.map((t) => t.word);
      const initialReport = await validateStory(initialStory, targetSurfaces, this.tokenizer, cfg);
      // Full history of attempts (initial + every repair candidate) so the
      // repair prompt can show the model what it kept getting wrong, not
      // just the most recent attempt. Lets the model triangulate from
      // multiple examples instead of seeing one stale draft.
      const history: { textChinese: string; missingCount: number }[] = [
        { textChinese: initialStory.textChinese, missingCount: initialReport.missingWords.length },
      ];
      // Best-of-N: each repair can make things worse — track the best
      // story seen so far (fewest missing target words; tie-break on score)
      // and return that, not the last iteration.
      let best = { story: initialStory, report: initialReport };

      const maxIters = this.ai.resolveActive().active.maxRepairIterations;
      let iter = 0;
      while (iter < maxIters && best.report.missingWords.length > 0) {
        iter++;
        const missingTargetWords = targetWords.filter((t) =>
          best.report.missingWords.includes(t.word)
        );
        const repair = buildRepairPrompt({
          priorAttempts: history,
          missingTargetWords,
          tooHardWords: best.report.tooHardWords,
          targetHsk,
          totalTargets: targetWords.length,
        });
        try {
          const out = await this.ai.chatJson(STORY_SYSTEM_PROMPT, repair, "ChineseStory", STORY_SCHEMA);
          const candidate = parseStory(out);
          const candReport = await validateStory(candidate, targetSurfaces, this.tokenizer, cfg);
          history.push({
            textChinese: candidate.textChinese,
            missingCount: candReport.missingWords.length,
          });
          if (
            candReport.missingWords.length < best.report.missingWords.length ||
            (candReport.missingWords.length === best.report.missingWords.length &&
              candReport.score > best.report.score)
          ) {
            best = { story: candidate, report: candReport };
          }
          new Notice(
            `Story iter ${iter}/${maxIters}: ${targetWords.length - best.report.missingWords.length}/${targetWords.length} target words included`,
            3000
          );
        } catch (e) {
          new Notice("Repair iteration failed: " + (e as Error).message);
          break;
        }
      }
      const story = best.story;
      const report = best.report;
      const included = targetWords.length - report.missingWords.length;
      new Notice(
        `Generated story: ${included}/${targetWords.length} target words included` +
          (report.missingWords.length
            ? ` (missing: ${report.missingWords.join(", ")})`
            : "") +
          `. Iterations used: ${iter}/${maxIters}.`,
        6000
      );

      const file = await this.writePreviewFile(story, dueRecords, targetHsk, report.score);

      if (this.settings().exposure.generatedReadingCountsAsExposure) {
        for (const r of dueRecords) this.vocab.recordExposure(
          r.surfaces[0],
          this.settings().exactTimestampRetentionLimit,
          this.settings().storeAllExactTimestamps
        );
      }

      // Story-exposure cooldown: push dueAt forward 1 day for target words
      // that were due now. Avoids the same dozen showing up in every story
      // back-to-back. Ease / interval / lapses are NOT changed — actual
      // SRS state for real reviews is untouched. Additive-only: already
      // future-dated words keep their existing schedule.
      const now = new Date();
      const cooldownDueAt = new Date(now.getTime() + STORY_COOLDOWN_DAYS * 86_400_000).toISOString();
      for (const r of dueRecords) {
        const existing = r.srs?.dueAt ? new Date(r.srs.dueAt).getTime() : 0;
        if (existing <= now.getTime()) {
          this.vocab.updateSrs(r.surfaces[0], { dueAt: cooldownDueAt });
        }
      }

      return { story, targets: dueRecords, targetHsk, score: report.score, file, iterations: iter };
    } finally {
      this.generationInFlight = false;
    }
  }

  /**
   * Promote a preview file to a permanent note inside `story.folder`,
   * using the same slug used by the legacy "Generate Review Story"
   * modal. Reuses the preview content verbatim.
   */
  async commitPreviewAsNote(preview: StoryPreview): Promise<TFile> {
    const settings = this.settings();
    const folder = normalizePath(settings.story.folder);
    await ensureFolder(this.app, folder);
    const stamp = new Date().toISOString().slice(0, 10);
    // Use the LLM-generated title so multiple stories on the same day
    // get genuinely distinguishable filenames instead of bare (1)/(2).
    const titleSlug = sanitizeForFilename(preview.story.title) || "Review Story";
    let filename = `${stamp} - ${titleSlug}.md`;
    let target = normalizePath(`${folder}/${filename}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      filename = `${stamp} - ${titleSlug} (${n}).md`;
      target = normalizePath(`${folder}/${filename}`);
      n++;
    }
    await this.app.fileManager.renameFile(preview.file, target);
    return preview.file;
  }

  /** Delete the preview file if it still exists. */
  async deletePreview(preview: StoryPreview): Promise<void> {
    try {
      await this.app.fileManager.trashFile(preview.file);
    } catch {
      // ignore — already gone
    }
  }

  /**
   * Path that `generatePreview` writes to and that the smart-flashcards
   * panel watches.  Stable so callers can `getAbstractFileByPath` it on
   * panel render.
   */
  previewPath(): string {
    return normalizePath(`${this.settings().story.folder}/CCI Flashcards Preview.md`);
  }

  /** Existing modal-driven entry point. Generates + persists in one shot. */
  async generateAndSave(req: StoryRequest): Promise<TFile> {
    const preview = await this.generatePreview(req);
    const saved = await this.commitPreviewAsNote(preview);
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: saved.path } });
    return saved;
  }

  private async callOnce(req: StoryRequest, target: TargetWord[], targetHsk: string): Promise<GeneratedStory> {
    const user = buildUserPrompt({
      style: req.style,
      targetHsk,
      targetWords: target,
      knownWords: this.sampleKnownWords(),
      lengthChars: req.lengthChars,
    });
    const raw = await this.ai.chatJson(STORY_SYSTEM_PROMPT, user, "ChineseStory", STORY_SCHEMA);
    return parseStory(raw);
  }

  private estimateHsk(): number {
    const all = this.vocab.values();
    const excludeNew = this.settings().statsExcludeNew;
    const byLevel = new Map<number, { total: number; known: number }>();
    for (const r of all) {
      if (r.status === "ignored") continue;
      if (excludeNew && r.status === "new") continue;
      const lvl = parseInt(r.hsk?.levels?.[0] ?? "0", 10);
      if (!lvl) continue;
      const b = byLevel.get(lvl) ?? { total: 0, known: 0 };
      b.total++;
      if (r.status === "known") b.known++;
      byLevel.set(lvl, b);
    }
    let highest = 1;
    const thr = this.settings().story.knownCoverageThreshold;
    for (const [lvl, b] of byLevel) {
      if (b.total > 0 && b.known / b.total >= thr && lvl > highest) highest = lvl;
    }
    return highest;
  }

  private sampleKnownWords(): string[] {
    const story = this.settings().story;
    if (!story.sendKnownWords) return [];
    const pct = Math.max(1, Math.min(100, story.knownWordsSamplePercent ?? 30));
    const words = this.vocab.values()
      .filter((r) => r.status === "known")
      .map((r) => r.simplified ?? r.surfaces[0])
      .filter(Boolean);
    const n = Math.ceil(words.length * pct / 100);
    return words.sort(() => Math.random() - 0.5).slice(0, n);
  }

  private async writePreviewFile(
    story: GeneratedStory,
    targets: WordRecord[],
    targetHsk: string,
    score: number
  ): Promise<TFile> {
    const folder = normalizePath(this.settings().story.folder);
    await ensureFolder(this.app, folder);
    const previewPath = this.previewPath();
    const content = this.formatStoryMarkdown(story, targets, targetHsk, score);
    const existing = this.app.vault.getAbstractFileByPath(previewPath);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, () => content);
      return existing;
    }
    return await this.app.vault.create(previewPath, content);
  }

  private formatStoryMarkdown(
    story: GeneratedStory,
    targets: WordRecord[],
    targetHsk: string,
    score: number
  ): string {
    const { active, provider } = this.ai.resolveActive();
    const fm = [
      "---",
      "chinese_learning_generated: true",
      `generated_at: ${new Date().toISOString()}`,
      `provider: ${provider}`,
      `model: ${active.chatModel}`,
      `target_hsk: ${targetHsk}`,
      "target_words:",
      ...targets.map((r) => `  - ${r.simplified ?? r.surfaces[0]}`),
      `validation_score: ${score.toFixed(3)}`,
      "---",
      "",
    ].join("\n");

    const body: string[] = [];
    body.push(`# ${story.title || "复习故事"}`);
    body.push("");
    body.push(story.textChinese);
    body.push("");
    // Target-word checklist is built from a REAL scan of the story body,
    // not from the LLM's self-reported claim. A checked box means the
    // word literally appears in textChinese. The glossary section that
    // used to live here is gone — the LLM is no longer asked for one.
    if (targets.length) {
      body.push("## Target word checklist");
      for (const t of targets) {
        const surface = t.simplified ?? t.surfaces[0];
        if (!surface) continue;
        body.push(`- [${story.textChinese.includes(surface) ? "x" : " "}] ${surface}`);
      }
      body.push("");
    }
    if (story.notesForLearner) {
      body.push(`> [!note] Notes for learner`);
      body.push(`> ${story.notesForLearner.replace(/\n/g, "\n> ")}`);
    }
    return fm + body.join("\n");
  }
}

export interface StoryPreview {
  story: GeneratedStory;
  targets: WordRecord[];
  targetHsk: string;
  score: number;
  file: TFile;
  iterations: number;
}

function parseStory(raw: string): GeneratedStory {
  if (!raw || raw.trim() === "") {
    throw new Error(
      "AI provider returned an empty response. Open Settings → AI provider → Test connection."
    );
  }

  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Tier 1: outermost {…} slice + strict JSON.parse.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (parsed && (typeof parsed.textChinese === "string" || typeof parsed.text === "string" || typeof parsed.content === "string")) {
        return shapeStory(parsed);
      }
    } catch {
      // fall through to next tier
    }
  }

  // Tier 2: regex-salvage just the `textChinese` field.
  const salvaged = salvageTextChinese(stripped);
  if (salvaged && salvaged.length > 0) {
    new Notice("Story parsed via regex fallback — open the dev console to see the raw response.");
    return shapeStory({ textChinese: salvaged });
  }

  // Tier 3: longest contiguous CJK-ish run (CJK chars + Chinese / ASCII
  // punctuation + whitespace) becomes the story. Triggers when the
  // model returned plain Chinese prose with no JSON wrapping at all.
  const cjk = longestCjkRun(raw);
  if (cjk && cjk.length >= 30) {
    new Notice("Story parsed as raw Chinese — provider did not return JSON. Open the dev console to see the raw response.");
    return shapeStory({ textChinese: cjk });
  }

  const snippet = stripped.length > 240
    ? stripped.slice(0, 120) + "…" + stripped.slice(-120)
    : stripped;
  throw new Error(`AI returned invalid story JSON.\nRaw snippet:\n${snippet}`);
}

function shapeStory(partial: Partial<GeneratedStory>): GeneratedStory {
  const p = partial as Partial<GeneratedStory> & { text?: string; content?: string };
  return {
    title: p.title ?? "复习故事",
    targetLevel: p.targetLevel ?? "",
    textChinese: p.textChinese ?? p.text ?? p.content ?? "",
    // The LLM is no longer asked for these. If a non-conforming provider
    // still emits them, pass through untouched (unused downstream).
    targetWordsUsed: p.targetWordsUsed,
    glossary: p.glossary,
    notesForLearner: p.notesForLearner,
  };
}

/**
 * Find the longest contiguous run made of CJK ideographs + common
 * Chinese / ASCII punctuation + whitespace. Used as a last-resort
 * fallback when the model returned plain prose with no JSON wrapping.
 */
function longestCjkRun(s: string): string {
  const re = /[㐀-鿿豈-﫿，。！？、；：""''「」『』《》（）()…—\-—\s\n\r,.!?:;"'[]]+/g;
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[0].length > best.length) best = m[0];
  }
  return best.trim();
}

/**
 * Last-resort recovery when the model truncated its JSON output before
 * closing. Pulls the value of `"textChinese": "…"` directly out of the
 * raw text, handling escaped quotes and newlines. Returns null if no
 * complete textChinese string is present.
 */
function salvageTextChinese(raw: string): string | null {
  const re = /"textChinese"\s*:\s*"((?:\\.|[^"\\])*)"/;
  const m = re.exec(raw);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return null;
  }
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path) return;
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      try {
        await app.vault.createFolder(cur);
      } catch {
        // ignore concurrent-create races
      }
    }
  }
}
