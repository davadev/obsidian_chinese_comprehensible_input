import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings/defaults";
import { CciSettings, ViewMode } from "./settings/types";
import { CciSettingsTab } from "./settings/SettingsTab";
import { DictionaryService } from "./dictionary/DictionaryService";
import { DictionaryDownloader } from "./dictionary/DictionaryDownloader";
import { TokenizerService } from "./tokenizer/TokenizerService";
import { VocabularyStore } from "./vocabulary/VocabularyStore";
import { ExposureTracker } from "./vocabulary/ExposureTracker";
import { SrsScheduler } from "./srs/SrsScheduler";
import { AiProviderService } from "./ai/AiProviderService";
import { StoryGenerator } from "./ai/StoryGenerator";
import { ChineseTextFileView } from "./view/ChineseTextFileView";
import { StatsView } from "./ui/StatsView";
import { WordPopup } from "./ui/WordPopup";
import { GenerateStoryModal } from "./ui/GenerateStoryModal";
import { VIEW_TYPE_CHINESE, VIEW_TYPE_STATS } from "./constants";
import { WordStatus } from "./vocabulary/VocabularyTypes";

export default class CciPlugin extends Plugin {
  settings: CciSettings = DEFAULT_SETTINGS;
  dictionary!: DictionaryService;
  dictDownloader!: DictionaryDownloader;
  tokenizer!: TokenizerService;
  vocab!: VocabularyStore;
  exposure!: ExposureTracker;
  srs!: SrsScheduler;
  ai!: AiProviderService;
  story!: StoryGenerator;
  popup!: WordPopup;

  private viewMode: ViewMode = "read";

  async onload(): Promise<void> {
    // Keep onload light. Load just settings + small services.
    const blob = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...((blob.settings as Partial<CciSettings>) ?? {}) };

    this.dictionary = new DictionaryService(this.app);
    this.dictDownloader = new DictionaryDownloader(this.app);
    this.vocab = new VocabularyStore(this, this.dictionary);
    await this.vocab.load(blob);

    this.tokenizer = new TokenizerService(this.dictionary, {
      hasRecord: (s) => !!this.vocab.bySurface(s),
      knownBoost: (s) => {
        const r = this.vocab.bySurface(s);
        if (!r) return 0;
        if (r.status === "known") return 0.3;
        if (r.status === "unknown") return 0.2;
        return 0.1;
      },
    }, () => this.settings);

    this.exposure = new ExposureTracker(this.vocab, () => this.settings);
    this.srs = new SrsScheduler(this.vocab, () => this.settings);
    this.ai = new AiProviderService(() => this.settings.ai);
    this.story = new StoryGenerator(this.app, this.ai, this.tokenizer, this.srs, this.vocab, () => this.settings);
    this.popup = new WordPopup(this);

    this.registerView(VIEW_TYPE_CHINESE, (leaf) => new ChineseTextFileView(leaf, this));
    this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsView(leaf, this));

    this.addSettingTab(new CciSettingsTab(this.app, this));

    this.registerCommands();

    this.addRibbonIcon("book-open-check", "Open current note in Chinese Learning View", () => {
      this.openCurrentInChineseView();
    });
  }

  async onunload(): Promise<void> {
    await this.vocab.flushSave();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHINESE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS);
  }

  async saveSettings(): Promise<void> {
    const blob = (await this.loadData()) ?? {};
    blob.settings = this.settings;
    await this.saveData(blob);
  }

  // Commands -----------------------------------------------------------

  private registerCommands(): void {
    this.addCommand({
      id: "open-current-in-chinese-view",
      name: "Open current note in Chinese Learning View",
      callback: () => this.openCurrentInChineseView(),
    });
    this.addCommand({
      id: "generate-review-story",
      name: "Generate Chinese Review Story",
      callback: () => this.openGenerateStoryModal(),
    });
    this.addCommand({
      id: "open-vocab-stats",
      name: "Open Chinese Vocabulary Stats",
      callback: () => this.openStatsView(),
    });
    this.addCommand({
      id: "toggle-mark-known",
      name: "Toggle Chinese mark-known mode",
      callback: () => this.setActiveViewMode(this.viewMode === "mark-known" ? "read" : "mark-known"),
    });
    this.addCommand({
      id: "toggle-mark-unknown",
      name: "Toggle Chinese mark-unknown mode",
      callback: () => this.setActiveViewMode(this.viewMode === "mark-unknown" ? "read" : "mark-unknown"),
    });
    this.addCommand({
      id: "clear-marking-mode",
      name: "Clear Chinese marking mode",
      callback: () => this.setActiveViewMode("read"),
    });
  }

  // View helpers -------------------------------------------------------

  activeViewMode(): ViewMode {
    return this.viewMode;
  }

  setActiveViewMode(m: ViewMode): void {
    const prev = this.viewMode;
    this.viewMode = m;
    const editBoundaryCrossed = (prev === "edit") !== (m === "edit");
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      const v = leaf.view as ChineseTextFileView;
      v.refreshToolbar();
      if (editBoundaryCrossed) v.reconfigureEditor();
      else v.redecorate();
    }
  }

  currentNoteKey(): string {
    const f = this.app.workspace.getActiveFile();
    return f?.path ?? "_no_note";
  }

  async openCurrentInChineseView(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note.");
      return;
    }
    await this.openFileInChineseView(file);
  }

  async openFileInChineseView(file: TFile): Promise<WorkspaceLeaf> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: file.path } });
    return leaf;
  }

  async openStatsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      (existing[0].view as StatsView).render();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_STATS });
  }

  openGenerateStoryModal(): void {
    if (!this.settings.ai.enabled) {
      new Notice("Enable AI in plugin settings first.");
      return;
    }
    new GenerateStoryModal(this.app, this).open();
  }

  openWordPopup(surface: string, target: HTMLElement, ev: Event): void {
    this.popup.open(surface, target, ev);
  }

  markWord(surface: string, status: WordStatus): void {
    this.vocab.setStatus(surface, status);
    new Notice(`${surface} → ${status}`);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      (leaf.view as ChineseTextFileView).redecorate();
    }
  }
}
