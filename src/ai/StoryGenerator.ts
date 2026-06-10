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

  async generateAndSave(req: StoryRequest): Promise<TFile> {
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

    const file = await this.saveNote(story, dueRecords, targetHsk, report.score);

    if (this.settings().exposure.generatedReadingCountsAsExposure) {
      for (const r of dueRecords) this.vocab.recordExposure(
        r.surfaces[0],
        this.settings().exactTimestampRetentionLimit,
        this.settings().storeAllExactTimestamps
      );
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: file.path } });
    return file;
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
    const byLevel = new Map<number, { total: number; known: number }>();
    for (const r of all) {
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

  private async saveNote(
    story: GeneratedStory,
    targets: WordRecord[],
    targetHsk: string,
    score: number
  ): Promise<TFile> {
    const settings = this.settings();
    const folder = normalizePath(settings.story.folder);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${stamp} - Review Story.md`;
    const path = normalizePath(`${folder}/${filename}`);

    await ensureFolder(this.app, folder);

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

    const content = fm + body.join("\n");
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, () => content);
      return existing;
    }
    return await this.app.vault.create(path, content);
  }
}

function parseStory(raw: string): GeneratedStory {
  let txt = raw.trim();
  // Strip code fences if model wrapped output.
  txt = txt.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(txt);
  if (!parsed || typeof parsed.textChinese !== "string") {
    throw new Error("AI returned invalid story JSON.");
  }
  return parsed as GeneratedStory;
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
