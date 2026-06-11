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

export class StoryGenerator {
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
    const dueRecords = this.srs.due().slice(0, req.dueCount);
    if (dueRecords.length === 0) {
      throw new Error("No due words to review yet. Mark some words first.");
    }
    const targetWords: TargetWord[] = dueRecords.map((r) => ({
      word: r.simplified ?? r.surfaces[0],
      pinyin: r.pinyin ?? "",
      definition: (r.definitions ?? []).slice(0, 2).join("; "),
    }));

    const targetHsk = req.targetHsk === "auto" ? String(this.estimateHsk()) : req.targetHsk;

    let story = await this.callOnce(req, targetWords, targetHsk);
    const cfg: ValidatorConfig = {
      targetHsk: parseInt(targetHsk, 10) || 0,
      lengthChars: req.lengthChars,
      tooHardRatioCap: 0.15,
    };
    let report = await validateStory(
      story,
      targetWords.map((t) => t.word),
      this.tokenizer,
      cfg
    );

    const maxIters = this.settings().ai.maxRepairIterations;
    let iter = 0;
    while (!report.ok && iter < maxIters) {
      iter++;
      const repair = buildRepairPrompt({
        originalText: story.textChinese,
        missingWords: report.missingWords,
        tooHardWords: report.tooHardWords,
        targetHsk,
      });
      try {
        const out = await this.ai.chatJson(STORY_SYSTEM_PROMPT, repair, "ChineseStory", STORY_SCHEMA);
        story = parseStory(out);
      } catch (e) {
        new Notice("Repair iteration failed: " + (e as Error).message);
        break;
      }
      report = await validateStory(
        story,
        targetWords.map((t) => t.word),
        this.tokenizer,
        cfg
      );
    }

    const file = await this.writePreviewFile(story, dueRecords, targetHsk, report.score);

    if (this.settings().exposure.generatedReadingCountsAsExposure) {
      for (const r of dueRecords) this.vocab.recordExposure(
        r.surfaces[0],
        this.settings().exactTimestampRetentionLimit,
        this.settings().storeAllExactTimestamps
      );
    }

    return { story, targets: dueRecords, targetHsk, score: report.score, file, iterations: iter };
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
    let filename = `${stamp} - Review Story.md`;
    let target = normalizePath(`${folder}/${filename}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      filename = `${stamp} - Review Story (${n}).md`;
      target = normalizePath(`${folder}/${filename}`);
      n++;
    }
    await this.app.fileManager.renameFile(preview.file, target);
    return preview.file;
  }

  /** Delete the preview file if it still exists. */
  async deletePreview(preview: StoryPreview): Promise<void> {
    try {
      await this.app.vault.delete(preview.file);
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
    return normalizePath(`${this.settings().story.folder}/.cci-flashcards-preview.md`);
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
    const settings = this.settings();
    const fm = [
      "---",
      "chinese_learning_generated: true",
      `generated_at: ${new Date().toISOString()}`,
      `provider: ${settings.ai.providerName}`,
      `model: ${settings.ai.chatModel}`,
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
    if (settings.story.includeGlossary && story.glossary?.length) {
      body.push("## 生词 Glossary");
      for (const g of story.glossary) body.push(`- **${g.word}** *(${g.pinyin})* — ${g.definition}`);
      body.push("");
    }
    if (story.targetWordsUsed?.length) {
      body.push("## Target word checklist");
      for (const t of story.targetWordsUsed) body.push(`- [${t.used ? "x" : " "}] ${t.word}`);
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
  // Always log so the user/maintainer can see what the model returned
  // when a fallback path triggers.
  // eslint-disable-next-line no-console
  console.log("[CCI Story] raw LLM response:", raw);

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
      if (parsed && typeof parsed.textChinese === "string") {
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
  return {
    title: partial.title ?? "复习故事",
    targetLevel: partial.targetLevel ?? "",
    textChinese: partial.textChinese ?? "",
    targetWordsUsed: partial.targetWordsUsed ?? [],
    glossary: partial.glossary ?? [],
    notesForLearner: partial.notesForLearner,
  };
}

/**
 * Find the longest contiguous run made of CJK ideographs + common
 * Chinese / ASCII punctuation + whitespace. Used as a last-resort
 * fallback when the model returned plain prose with no JSON wrapping.
 */
function longestCjkRun(s: string): string {
  const re = /[㐀-鿿豈-﫿，。！？、；：""''「」『』《》（）()…—\-—\s\n\r,.!?:;"'\[\]]+/g;
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
