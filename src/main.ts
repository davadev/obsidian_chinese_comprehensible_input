import { addIcon, MarkdownView, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings/defaults";
import { applyCustomColors, deriveHskColorsFromAccent } from "./ui/colorTheme";
import { CciSettings, ViewMode } from "./settings/types";
import { CciSettingsTab } from "./settings/SettingsTab";
import { DictionaryService } from "./dictionary/DictionaryService";
import { DictionaryDownloader } from "./dictionary/DictionaryDownloader";
import { TokenizerService } from "./tokenizer/TokenizerService";
import { VocabularyStore } from "./vocabulary/VocabularyStore";
import { ExposureTracker } from "./vocabulary/ExposureTracker";
import { indexVaultWithNotice } from "./vocabulary/VaultIndexer";
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
  private injectedMarkdownViews = new WeakSet<MarkdownView>();

  async onload(): Promise<void> {
    // Custom icon: the character 中 (zhōng / middle) — clearly signals
    // "Chinese view" and avoids visual collision with Obsidian's native
    // read/edit toggle which uses book-open / pencil.
    addIcon(
      "cci-zhong",
      '<text x="50" y="82" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="95" font-weight="600" fill="currentColor">中</text>'
    );

    // Keep onload light. Load just settings + small services.
    const blob = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...((blob.settings as Partial<CciSettings>) ?? {}) };
    // One-time display-mode migration: popup-only and color-only used to be
    // separate options but rendered identically (no inline annotation, with
    // a color tint). Collapse both into "none". Run before applyCustomColors
    // and before any view picks up the value.
    const dm = this.settings.defaultDisplayMode as string;
    if (dm === "popup-only" || dm === "color-only") {
      this.settings.defaultDisplayMode = "none";
    }
    // Merge customColors deeply so older blobs missing hsk subkeys get the defaults.
    this.settings.customColors = {
      ...DEFAULT_SETTINGS.customColors,
      ...(this.settings.customColors ?? {}),
      hsk: {
        ...DEFAULT_SETTINGS.customColors.hsk,
        ...((this.settings.customColors?.hsk as Partial<CciSettings["customColors"]["hsk"]>) ?? {}),
      },
    };
    // First install: derive the HSK palette from the active Obsidian
    // accent color so the default looks intentional rather than rainbow.
    // Subsequent loads honor whatever the user has saved.
    if (!this.settings.hskColorsDerivedFromAccent) {
      this.settings.customColors.hsk = deriveHskColorsFromAccent();
      this.settings.hskColorsDerivedFromAccent = true;
      void this.saveSettings();
    }
    applyCustomColors(this.settings);

    this.dictionary = new DictionaryService(this.app);
    this.dictDownloader = new DictionaryDownloader(this.app);
    this.vocab = new VocabularyStore(this, this.dictionary, () => this.settings);
    await this.vocab.load(blob);
    this.registerSyncMirrorWatchers();

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
    this.ai = new AiProviderService(
      () => this.settings.ai,
      this.app,
      () => this.settings.story.folder
    );
    this.story = new StoryGenerator(this.app, this.ai, this.tokenizer, this.srs, this.vocab, () => this.settings);
    this.popup = new WordPopup(this);

    this.registerView(VIEW_TYPE_CHINESE, (leaf) => new ChineseTextFileView(leaf, this));
    this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsView(leaf, this));

    this.addSettingTab(new CciSettingsTab(this.app, this));

    this.registerCommands();

    this.addRibbonIcon("cci-zhong", "Open current note in Chinese Learning View", () => {
      this.openCurrentInChineseView();
    });

    this.registerEvent(
      this.app.workspace.on("file-open", () => this.injectMarkdownHeaderActions())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.injectMarkdownHeaderActions())
    );
    this.app.workspace.onLayoutReady(() => this.injectMarkdownHeaderActions());

    // Background bootstrap: auto-download the dictionary if missing, then
    // index the vault on first run so the stats dashboard reflects every
    // Chinese note, not only the ones the user has visited. Fire-and-forget
    // so we don't block onload.
    void this.bootstrapVault();
  }

  /**
   * Auto-download the dictionary (if enabled + missing), then warm the
   * tokenizer, then scan the vault once to seed vocabulary records. Idempotent
   * — re-running it just re-records exposures on the canonical keys.
   */
  private async bootstrapVault(): Promise<void> {
    try {
      if (this.settings.autoDownloadDictionary && !(await this.dictionary.isOnDisk())) {
        const notice = new Notice("Chinese plugin: downloading dictionary…", 0);
        try {
          await this.dictDownloader.run();
          await this.dictionary.reload();
          notice.setMessage("Chinese plugin: dictionary ready.");
          setTimeout(() => notice.hide(), 3000);
        } catch (err) {
          notice.setMessage(
            "Chinese plugin: dictionary download failed — " + (err as Error).message
          );
          setTimeout(() => notice.hide(), 6000);
          return;
        }
      } else {
        // Dictionary is already on disk (or auto-download disabled). Make
        // sure it is loaded into memory.
        await this.dictionary.ensureLoaded();
      }
      if (!this.settings.vaultIndexed) {
        await indexVaultWithNotice(this);
      }
    } catch (err) {
      console.error("CCI bootstrap failed", err);
    }
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
    applyCustomColors(this.settings);
  }

  /**
   * Called by the Settings tab after the user flips the vocabulary mirror
   * toggle on (or changes the path). Forces a save so the mirror file
   * appears immediately, then absorbs any existing mirror at the new path.
   */
  async refreshSyncMirror(): Promise<void> {
    await this.vocab.flushSave();
    await this.vocab.absorbExternalMirrorChange();
    this.refreshChineseViews();
    this.refreshStatsViews();
  }

  /**
   * Watch the vault for external changes to the mirror file (remotely-save
   * pulled a newer remote version) and for conflict files written by
   * remotely-save. Our own writes are filtered out via the content hash
   * cached inside VocabularyStore.
   */
  private registerSyncMirrorWatchers(): void {
    const isMirrorPath = (path: string): boolean => {
      const mirror = this.settings.sync?.mirrorPath;
      return !!mirror && path === mirror;
    };
    const isMirrorConflict = (path: string): boolean => {
      const mirror = this.settings.sync?.mirrorPath;
      if (!mirror) return false;
      const slash = mirror.lastIndexOf("/");
      const folder = slash >= 0 ? mirror.slice(0, slash) : "";
      const baseFull = slash >= 0 ? mirror.slice(slash + 1) : mirror;
      const base = baseFull.replace(/\.json$/i, "");
      const fileFolderSlash = path.lastIndexOf("/");
      const fileFolder = fileFolderSlash >= 0 ? path.slice(0, fileFolderSlash) : "";
      const name = fileFolderSlash >= 0 ? path.slice(fileFolderSlash + 1) : path;
      return (
        fileFolder === folder &&
        name.startsWith(base) &&
        /conflict/i.test(name) &&
        name.toLowerCase().endsWith(".json")
      );
    };
    this.registerEvent(
      this.app.vault.on("modify", async (file: TAbstractFile) => {
        if (!this.settings.sync?.mirrorEnabled) return;
        if (!isMirrorPath(file.path)) return;
        const changed = await this.vocab.absorbExternalMirrorChange();
        if (changed) {
          this.refreshChineseViews();
          this.refreshStatsViews();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", async (file: TAbstractFile) => {
        if (!this.settings.sync?.mirrorEnabled) return;
        if (!isMirrorConflict(file.path)) return;
        await this.vocab.reloadMirror();
        this.refreshChineseViews();
        this.refreshStatsViews();
      })
    );
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
      name: "Data Management",
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

  /**
   * Add a "Open in Chinese Learning View" action to every MarkdownView's
   * header so the round trip from Obsidian's Markdown editor back to our
   * annotated view is one tap. WeakSet dedupes — file-open fires on every
   * file switch, but MarkdownView instances are reused per leaf.
   */
  private injectMarkdownHeaderActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      if (this.injectedMarkdownViews.has(view)) continue;
      view.addAction("cci-zhong", "Open in Chinese Learning View", () => {
        if (view.file) void this.openFileInChineseView(view.file);
      });
      this.injectedMarkdownViews.add(view);
    }
  }

  async openFileInChineseView(file: TFile): Promise<WorkspaceLeaf> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: file.path } });
    return leaf;
  }

  /**
   * Open the global stats view scoped to all vocabulary. The per-note view
   * is reached explicitly via `openStatsForNote(notePath)` (used by the
   * toolbar badge); the command palette / ribbon use this method.
   */
  async openStatsView(): Promise<void> {
    return this.openStatsScoped("");
  }

  async openStatsForNote(notePath: string): Promise<void> {
    const useScope = notePath && notePath !== "_no_note" ? notePath : "";
    return this.openStatsScoped(useScope);
  }

  private async openStatsScoped(useScope: string): Promise<void> {
    // If the call originated from the Settings modal, close it so the
    // user actually sees the stats tab they just asked for.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setting = (this.app as any)?.setting;
    if (setting && typeof setting.close === "function") {
      try { setting.close(); } catch { /* best effort */ }
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      this.app.workspace.setActiveLeaf(existing[0], { focus: true });
      const view = existing[0].view as StatsView;
      view.setScope(useScope);
      view.render();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_STATS });
    this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view as StatsView;
    view.setScope(useScope);
    view.render();
  }

  refreshStatsViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS)) {
      (leaf.view as StatsView).render();
    }
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
    this.refreshChineseViews();
    this.refreshStatsViews();
  }

  markWordIgnored(surface: string, reason?: string): void {
    this.vocab.setStatus(surface, "ignored", reason);
    new Notice(`${surface} → ignored`);
    this.refreshChineseViews();
    this.refreshStatsViews();
  }

  refreshChineseViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      const v = leaf.view as ChineseTextFileView;
      v.redecorate();
      v.refreshToolbar();
    }
  }

  /**
   * Tokenize a Chinese-bearing text and return how many word-level CJK
   * tokens fall into each color bucket. Cached via tokenizer; cheap to
   * call from the toolbar after every redecorate.
   */
  async computeNoteStats(text: string): Promise<{
    total: number;
    known: number;
    partial: number;
    unknown: number;
    newCount: number;
    topHsk: string;
  }> {
    const tokens = await this.tokenizer.tokenize(text);
    const counts = { total: 0, known: 0, partial: 0, unknown: 0, newCount: 0 };
    const hskCounts = new Map<string, number>();
    for (const tok of tokens) {
      if (!tok.isWord || tok.candidates.length === 0) continue;
      counts.total++;
      const hsk = tok.selected?.hsk?.levels?.[0];
      if (hsk) hskCounts.set(hsk, (hskCounts.get(hsk) ?? 0) + 1);
      const rec = this.vocab.bySurface(tok.surface);
      const status = rec?.status ?? "new";
      if (status === "ignored") {
        counts.total--; // don't count ignored
        continue;
      }
      if (status === "new") counts.newCount++;
      else if (status === "known") counts.known++;
      else if (status === "unknown") counts.unknown++;
      else counts.partial++;
    }
    let topHsk = "";
    let topCount = 0;
    for (const [hsk, count] of hskCounts) {
      if (count > topCount) {
        topHsk = hsk;
        topCount = count;
      }
    }
    return { ...counts, topHsk };
  }
}
