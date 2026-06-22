import { addIcon, MarkdownView, normalizePath, Notice, Platform, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings/defaults";
import { applyCustomColors, deriveHskColorsFromAccent } from "./ui/colorTheme";
import {
  DictionaryCustomWord,
  DictionaryCustomWords,
  DictionaryOverride,
  DictionaryOverrides,
} from "./dictionary/DictionaryTypes";
import { clearTokenCache } from "./tokenizer/tokenCache";
import { AiUsageEntry, CciSettings, ViewMode } from "./settings/types";
import { migrateAiSettingsToV2 } from "./settings/migrations";
import { CciSettingsTab } from "./settings/SettingsTab";
import { SettingsMirror } from "./settings/SettingsMirror";
import { filterSettingsForSharing } from "./settings/SettingsIO";
import { DictionaryService } from "./dictionary/DictionaryService";
import { DictionaryDownloader } from "./dictionary/DictionaryDownloader";
import { TokenizerService } from "./tokenizer/TokenizerService";
import { VocabularyStore } from "./vocabulary/VocabularyStore";
import { ExposureTracker } from "./vocabulary/ExposureTracker";
import { indexVaultWithNotice } from "./vocabulary/VaultIndexer";
import { SrsScheduler } from "./srs/SrsScheduler";
import { AiProviderService } from "./ai/AiProviderService";
import { saveApiKey } from "./ai/secrets";
import { StoryGenerator } from "./ai/StoryGenerator";
import { EnhanceDictionaryService } from "./ai/EnhanceDictionaryService";
import { ChineseTextFileView } from "./view/ChineseTextFileView";
import {
  highlightColorForId,
  highlightWrap,
  resolveHighlightPalette,
  type HighlightWrap,
} from "./editor/highlightPalette";
import { StatsView } from "./ui/StatsView";
import { WordPopup } from "./ui/WordPopup";
import { GenerateStoryModal } from "./ui/GenerateStoryModal";
import { VIEW_TYPE_CHINESE, VIEW_TYPE_STATS } from "./constants";
import { WordStatus } from "./vocabulary/VocabularyTypes";
import { createQueuedDataBlobUpdater, PluginDataBlob, PluginDataMutation } from "./data/pluginDataUpdater";

export default class CciPlugin extends Plugin {
  settings: CciSettings = DEFAULT_SETTINGS;
  dictionary!: DictionaryService;
  dictDownloader!: DictionaryDownloader;
  settingsMirror!: SettingsMirror;
  tokenizer!: TokenizerService;
  vocab!: VocabularyStore;
  exposure!: ExposureTracker;
  srs!: SrsScheduler;
  ai!: AiProviderService;
  story!: StoryGenerator;
  enhance!: EnhanceDictionaryService;
  popup!: WordPopup;
  /**
   * Per-entry dictionary overrides + user-added custom words. Live at
   * top-level in the plugin data blob so they survive a dictionary
   * redownload (which only rewrites .cci-dictionary.json).
   */
  dictionaryOverrides: DictionaryOverrides = {};
  dictionaryCustomWords: DictionaryCustomWords = {};

  private viewMode: ViewMode = "read";
  /** Surface being assembled while viewMode === "select-word". */
  pendingCustomSurface = "";
  /** Document offset of the first tapped word while viewMode === "format". */
  pendingFormatStart: number | null = null;
  /** Surface of that first tapped word, shown in the banner as feedback (#21). */
  pendingFormatStartSurface: string | null = null;
  private injectedMarkdownViews = new WeakSet<MarkdownView>();

  /** Counter timer that resets the persisted crash counter ~30s after
   *  onload completes (i.e. once we've proven we don't crash). */
  private crashResetTimer: number | null = null;
  private static CRASH_THRESHOLD = 5;
  private static CRASH_RESET_DELAY_MS = 30_000;
  private readonly queuedDataBlobUpdate = createQueuedDataBlobUpdater(
    () => this.loadData(),
    (blob) => this.saveData(blob)
  );

  async updateDataBlob(mutate: PluginDataMutation): Promise<void> {
    await this.queuedDataBlobUpdate(mutate);
  }

  /** Typed wrapper around Obsidian's `loadData()`. Returning a real
   *  `PluginDataBlob` shape stops the `any` taint from `loadData()` from
   *  cascading the `no-unsafe-*` lint cluster through every reader. */
  private async loadPluginData(): Promise<PluginDataBlob> {
    const raw = (await this.loadData()) as PluginDataBlob | null;
    return raw ?? {};
  }

  async onload(): Promise<void> {
    // Crash protection: if previous launches kept dying before the
    // stability mark fired, auto-disable so the user can recover via
    // Community plugins instead of being stuck in a reload loop.
    try {
      const probeBlob = await this.loadPluginData();
      if (probeBlob.__autoDisabled) {
        new Notice(
          "Chinese plugin auto-disabled after repeated crashes. Re-enable in Settings → Community plugins after addressing the cause.",
          0
        );
        // Clear the flag so the next manual enable can run normally.
        probeBlob.__autoDisabled = false;
        await this.saveData(probeBlob);
        void this.app.plugins?.disablePlugin?.(this.manifest.id);
        return;
      }
      const counter = (probeBlob.__crashCounter ?? 0) + 1;
      if (counter > CciPlugin.CRASH_THRESHOLD) {
        probeBlob.__autoDisabled = true;
        probeBlob.__crashCounter = 0;
        await this.saveData(probeBlob);
        new Notice(
          `Chinese plugin auto-disabled: hit ${CciPlugin.CRASH_THRESHOLD} crashes in a row. Open Community plugins to re-enable.`,
          0
        );
        void this.app.plugins?.disablePlugin?.(this.manifest.id);
        return;
      }
      probeBlob.__crashCounter = counter;
      await this.saveData(probeBlob);
    } catch (e) {
      console.warn("CCI crash-counter probe failed", e);
    }

    try {
      await this.onloadInner();
      // Schedule a "we're stable" reset of the crash counter. If anything
      // crashes the app within 30s of onload, the counter survives.
      this.crashResetTimer = window.setTimeout(() => {
        this.resetCrashCounter().catch(() => {});
      }, CciPlugin.CRASH_RESET_DELAY_MS);
      this.registerInterval(this.crashResetTimer);
    } catch (e) {
      console.error("CCI onload failed", e);
      // Sticky Notice so the actual error is visible to the user — on iOS
      // Obsidian's own "encountered an error while loading" is otherwise
      // opaque and there's no console.
      try {
        new Notice(
          `Chinese plugin failed to load: ${(e as Error)?.message ?? String(e)}`,
          0
        );
      } catch {
        /* if even Notice fails, give up — the throw below still flags it */
      }
      throw e;
    }
  }

  private async resetCrashCounter(): Promise<void> {
    try {
      const blob = await this.loadPluginData();
      if (blob.__crashCounter || blob.__autoDisabled) {
        blob.__crashCounter = 0;
        blob.__autoDisabled = false;
        await this.saveData(blob);
      }
    } catch (e) {
      console.warn("CCI crash-counter reset failed", e);
    }
  }

  private async onloadInner(): Promise<void> {
    // Custom icon: the character 中 (zhōng / middle) — clearly signals
    // "Chinese view" and avoids visual collision with Obsidian's native
    // read/edit toggle which uses book-open / pencil.
    addIcon(
      "cci-zhong",
      '<text x="50" y="82" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="95" font-weight="600" fill="currentColor">中</text>'
    );

    // Keep onload light. Load just settings + small services.
    const blob = await this.loadPluginData();
    const rawSettings = blob.settings ?? {};
    // Run pre-merge migrations on the raw blob so legacy flat-shaped
    // ai.* fields (v1) get folded into ai.ollama.* before DEFAULT_SETTINGS
    // injects an empty ai.ollama and erases them.
    const { migrated, rescuedOllamaApiKey } = migrateAiSettingsToV2(rawSettings);
    this.settings = { ...DEFAULT_SETTINGS, ...migrated };
    // Merge ai sub-objects deeply so partial blobs keep their usageLog
    // across reloads when DEFAULT_SETTINGS.ai would otherwise replace it
    // wholesale.
    if (migrated.ai) {
      this.settings.ai = {
        ...DEFAULT_SETTINGS.ai,
        ...migrated.ai,
        ollama: { ...DEFAULT_SETTINGS.ai.ollama, ...(migrated.ai.ollama ?? {}) },
        usageLog: migrated.ai.usageLog ?? [],
      };
      // Belt-and-suspenders: the localStorage move means apiKey must
      // never be persisted to data.json. Force it back to "" in case a
      // hand-edited or older blob slipped one in.
      this.settings.ai.ollama.apiKey = "";
    }
    // Rescue any legacy v1 ai.apiKey (or stray v2 ai.ollama.apiKey) into
    // device-local secret storage so the user doesn't have to re-paste.
    if (rescuedOllamaApiKey) {
      saveApiKey(this.app, "ollama", rescuedOllamaApiKey);
    }
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
      // System-driven save (not a user setting change) — don't mark the
      // device as "touched". Otherwise a fresh install would start
      // broadcasting defaults via the settings mirror.
      void this.saveSettingsSilently();
    }
    applyCustomColors(this.settings);
    // Snapshot the initial filtered-settings fingerprint so saveSettings
    // can tell whether a UI change actually altered a sync-eligible field.
    this.lastSharedFingerprint = JSON.stringify(filterSettingsForSharing(this.settings));

    this.dictionaryOverrides = blob.dictionaryOverrides ?? {};
    this.dictionaryCustomWords = blob.dictionaryCustomWords ?? {};

    this.dictionary = new DictionaryService(this.app);
    this.dictionary.setOverlay(
      () => this.dictionaryOverrides,
      () => this.dictionaryCustomWords
    );
    this.dictDownloader = new DictionaryDownloader(this.app);
    this.settingsMirror = new SettingsMirror(this);
    this.vocab = new VocabularyStore(this, this.dictionary, () => this.settings);
    this.vocab.setDictionaryMirrorBridge({
      getOverrides: () => this.dictionaryOverrides,
      getCustomWords: () => this.dictionaryCustomWords,
      mergeRemote: (o, c) => this.mergeMirroredDictionaryData(o, c),
    });
    await this.vocab.load(blob);
    this.registerSyncMirrorWatchers();
    this.startSyncMirrorPoller();

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
      () => this.settings.story.folder,
      (entry) => this.recordAiUsage(entry)
    );
    this.story = new StoryGenerator(this.app, this.ai, this.tokenizer, this.srs, this.vocab, () => this.settings);
    this.enhance = new EnhanceDictionaryService(this.ai, () => this.settings);
    this.popup = new WordPopup(this);

    this.registerView(VIEW_TYPE_CHINESE, (leaf) => new ChineseTextFileView(leaf, this));
    this.registerView(VIEW_TYPE_STATS, (leaf) => new StatsView(leaf, this));

    this.addSettingTab(new CciSettingsTab(this.app, this));

    this.registerCommands();

    // Ribbon: mobile only. On desktop the MarkdownView header already gets
    // the same action (`injectMarkdownHeaderActions` → `addAction`), so a
    // left-panel ribbon button is redundant. iOS doesn't expose addAction,
    // so the ribbon (== bottom toolbar on mobile) stays as the entry point.
    if (Platform.isMobile) {
      this.addRibbonIcon("cci-zhong", "Open current note in Chinese Learning View", () => {
        void this.openCurrentInChineseView();
      });
    }

    this.registerEvent(
      this.app.workspace.on("file-open", () => this.injectMarkdownHeaderActions())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.injectMarkdownHeaderActions();
        this.restartSyncPollerIfModeChanged();
      })
    );
    // When a Chinese view becomes active, immediately check the mirror so
    // the user sees changes from other devices without waiting for the
    // next poll tick. Also re-evaluate fast / slow poll mode.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.restartSyncPollerIfModeChanged();
        if (leaf && leaf.view?.getViewType?.() === VIEW_TYPE_CHINESE) {
          void this.checkMirrorOnce();
        }
        void this.checkSettingsMirrorOnce();
      })
    );
    // Window focus = user came back to this device, likely after editing
    // settings on the other one. Check the settings mirror immediately.
    this.registerDomEvent(window, "focus", () => {
      void this.checkSettingsMirrorOnce();
    });
    this.app.workspace.onLayoutReady(() => this.injectMarkdownHeaderActions());

    // Background bootstrap: auto-download the dictionary if missing, then
    // index the vault on first run so the stats dashboard reflects every
    // Chinese note, not only the ones the user has visited. Fire-and-forget
    // so we don't block onload — but never leak an unhandled rejection
    // (iOS WKWebView surfaces those as load failures).
    this.bootstrapVault().catch((e) => console.error("CCI bootstrap failed", e));

    // Heavy mirror merge runs after layout-ready, isolated from onload, so
    // a stalled / failed Files-provider read (Nextcloud / iCloud on iOS)
    // can never cascade into a plugin load failure.
    this.app.workspace.onLayoutReady(() => {
      void this.bootstrapVocabMirror();
      void this.settingsMirror.bootstrap().catch((e) =>
        console.error("CCI settings mirror bootstrap failed", e)
      );
      // One-shot auto-story check shortly after layout-ready — covers the
      // case where the user opened the app well after their configured
      // target time and we shouldn't make them wait for the first tick.
      window.setTimeout(() => void this.tickAutoStory(), 3000);
    });
    // Periodic auto-story tick. Cheap when disabled (early-return path).
    const autoStoryHandle = window.setInterval(
      () => void this.tickAutoStory(),
      5 * 60_000
    );
    this.registerInterval(autoStoryHandle);
  }

  /** Wait between concluding "no story yet today" and actually generating
   *  one, so a story written by another device in the same vault has
   *  time to land via the user's sync backend (remotely-save, iCloud,
   *  etc.). Without this, two devices that both hit `tickAutoStory`
   *  near the configured target time would each produce a story. */
  private static AUTO_STORY_SYNC_BUFFER_MS = 3 * 60_000;

  /** Look in the configured story folder for any file whose basename
   *  starts with `${today} - `. `commitPreviewAsNote` uses that exact
   *  prefix, so a true result here means another device (or this device
   *  on a prior tick) already generated today's story. Synced via the
   *  vault, so it survives cross-device. */
  private async todaysStoryExists(today: string): Promise<boolean> {
    const folderPath = normalizePath(this.settings.story.folder);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return false;
    const prefix = `${today} - `;
    for (const child of folder.children) {
      if (child instanceof TFile && child.basename.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /** Periodic check that drives the "one auto-generated story per day"
   *  feature. Early-exits unless enabled, the configured local time has
   *  passed, today hasn't yet produced a story, and the 30-min retry
   *  throttle has elapsed. Failures don't carry across midnight — the
   *  date-string equality check resets state implicitly. */
  private async tickAutoStory(): Promise<void> {
    const s = this.settings.story;
    if (!s?.autoGenerateEnabled) return;
    const now = new Date();
    const today = localDateString(now);
    let blob = await this.loadPluginData();
    if (blob.__autoStoryLastSuccessDate === today) return;

    const target = parseHHMMToDate(s.autoGenerateTime, now);
    if (now.getTime() < target.getTime()) return;

    const lastAtt = blob.__autoStoryLastAttemptAt
      ? new Date(blob.__autoStoryLastAttemptAt)
      : null;
    if (lastAtt && now.getTime() - lastAtt.getTime() < 30 * 60_000) return;

    // Cross-device dedup: another device on the same vault may have
    // already generated today's story. Local `__autoStoryLastSuccessDate`
    // lives in data.json which is per-device, so it can't be trusted on
    // its own. Vault file check is the source of truth.
    if (await this.todaysStoryExists(today)) {
      blob.__autoStoryLastSuccessDate = today;
      await this.saveData(blob);
      return;
    }

    // Mark the attempt before kicking off, so generationInFlight guards
    // can't end up running this tick repeatedly inside the throttle window.
    blob.__autoStoryLastAttemptAt = now.toISOString();
    await this.saveData(blob);

    if (!this.settings.ai?.enabled) return;

    // Sync buffer: pause briefly then re-check. Lets a story file written
    // by another device arrive via remotely-save / iCloud before we
    // duplicate the work.
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, CciPlugin.AUTO_STORY_SYNC_BUFFER_MS)
    );
    if (await this.todaysStoryExists(today)) {
      blob = await this.loadPluginData();
      blob.__autoStoryLastSuccessDate = today;
      await this.saveData(blob);
      return;
    }

    try {
      const preview = await this.story.generatePreview({
        dueCount: s.defaultDueCount,
        lengthChars: s.defaultLengthChars,
        style: s.defaultStyle,
        targetHsk: "auto",
        includeGlossary: s.includeGlossary,
      });
      await this.story.commitPreviewAsNote(preview);
      blob = await this.loadPluginData();
      blob.__autoStoryLastSuccessDate = today;
      await this.saveData(blob);
      new Notice("Daily Chinese story generated.");
    } catch (e) {
      console.warn("CCI auto-story: generation failed", e);
      // No further bookkeeping — the 30-min throttle handles retries.
      // Day-rollover wipes lastAttempt indirectly via the date check.
    }
  }

  private async bootstrapVocabMirror(): Promise<void> {
    try {
      await this.vocab.bootstrapMirrorAfterLoad();
      this.refreshChineseViews();
      this.refreshStatsViews();
    } catch (e) {
      console.error("CCI sync: mirror bootstrap failed", e);
      try {
        new Notice(
          `Chinese plugin: mirror sync failed — ${(e as Error)?.message ?? String(e)}. The plugin is still usable; use "Force re-sync now" in Settings → Sync to retry.`,
          8000
        );
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Auto-download the dictionary (if enabled + missing), then warm the
   * tokenizer, then scan the vault once to seed vocabulary records.
   * Re-running it records exposures again on the same canonical keys.
   */
  private async bootstrapVault(): Promise<void> {
    try {
      if (this.settings.autoDownloadDictionary && !(await this.dictionary.isOnDisk())) {
        const notice = new Notice("Chinese plugin: downloading dictionary…", 0);
        try {
          await this.dictDownloader.run();
          await this.dictionary.reload();
          notice.setMessage("Chinese plugin: dictionary ready.");
          window.setTimeout(() => notice.hide(), 3000);
        } catch (err) {
          notice.setMessage(
            "Chinese plugin: dictionary download failed — " + (err as Error).message
          );
          window.setTimeout(() => notice.hide(), 6000);
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

  onunload(): void {
    // Fire-and-forget the flush chain so Obsidian's void-returning Plugin
    // signature is preserved. Detaching leaves is intentionally skipped:
    // Obsidian's plugin lifecycle documentation forbids it because it
    // resets the user's leaf placement on next enable.
    void (async () => {
      // Clean shutdown = we ran fine. Reset the crash counter eagerly so
      // user-triggered toggles don't accumulate toward the threshold.
      await this.resetCrashCounter();
      await this.vocab.flushSave();
      // Force-flush any pending debounced mirror write so we don't lose
      // the tail of an exposure burst on quit.
      await this.vocab.flushMirrorNow();
      await this.settingsMirror?.flushNow().catch(() => {});
    })();
  }

  /** Fingerprint of the shareable subset of settings at last save. Used
   *  to detect whether a UI change actually altered any sync-eligible
   *  field. Pure sync-config edits (mirror toggle, mirror path, poll
   *  interval) don't change the filtered fingerprint, so they don't
   *  mark the device as touched and don't trigger a clobbering write. */
  private lastSharedFingerprint: string | null = null;

  async saveSettings(): Promise<void> {
    const fp = JSON.stringify(filterSettingsForSharing(this.settings));
    const shareableChanged = fp !== this.lastSharedFingerprint;
    this.lastSharedFingerprint = fp;
    await this.saveSettingsSilently({ markUserTouched: shareableChanged });
    if (shareableChanged) this.settingsMirror?.scheduleWrite();
  }

  /** Persist settings without scheduling a mirror write. Used by
   *  SettingsMirror.absorbExternalChange after applying a remote envelope
   *  (to avoid an echo loop) and by system-driven saves like the HSK
   *  accent derivation at first install (we don't want internal writes
   *  to mark the user as "touched" and start broadcasting defaults). */
  async saveSettingsSilently(opts: { markUserTouched?: boolean } = {}): Promise<void> {
    await this.updateDataBlob((blob) => {
      blob.settings = this.settings;
      if (opts.markUserTouched) {
        blob.__settingsTouchedAt = new Date().toISOString();
      }
    });
    applyCustomColors(this.settings);
  }

  /** Append a token-usage record. Prunes the log to the last 35 days so
   *  the data blob never grows unbounded (one entry per AI call ≈ 60 B).
   *  Debounced save keeps a story-repair-loop burst from thrashing disk. */
  private aiUsageSaveTimer: number | null = null;
  recordAiUsage(entry: AiUsageEntry): void {
    const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const log = (this.settings.ai.usageLog ?? []).filter((e) => e.ts >= cutoff);
    log.push(entry);
    this.settings.ai.usageLog = log;
    if (this.aiUsageSaveTimer != null) window.clearTimeout(this.aiUsageSaveTimer);
    this.aiUsageSaveTimer = window.setTimeout(() => {
      this.aiUsageSaveTimer = null;
      void this.saveSettingsSilently();
    }, 1500);
  }

  /** Has the user changed any setting on this device through the UI? Used
   *  by SettingsMirror to gate writes (fresh device must not overwrite
   *  a remote envelope it hasn't seen yet). */
  async hasUserTouchedSettings(): Promise<boolean> {
    const blob = await this.loadPluginData();
    return !!blob.__settingsTouchedAt;
  }

  /** Persist dictionary overrides + custom words atomically. Also rewrites
   *  the vault mirror (if enabled) so other devices see the change. */
  private async saveDictionaryUserData(): Promise<void> {
    await this.updateDataBlob((blob) => {
      blob.dictionaryOverrides = this.dictionaryOverrides;
      blob.dictionaryCustomWords = this.dictionaryCustomWords;
    });
    // Force a mirror write so the envelope picks up the new dictionary
    // data even when no vocab change is pending.
    await this.vocab.flushSave();
  }

  /**
   * Apply a remote mirror's dictionary user data on top of ours. Per-entry
   * last-write-wins by updatedAt (additive only — no tombstones in v1).
   */
  async mergeMirroredDictionaryData(
    overrides: DictionaryOverrides,
    customWords: DictionaryCustomWords
  ): Promise<void> {
    let mutated = false;
    for (const [k, v] of Object.entries(overrides)) {
      const local = this.dictionaryOverrides[k];
      const localTs = local?.updatedAt ?? "";
      const remoteTs = v?.updatedAt ?? "";
      if (!local || remoteTs > localTs) {
        this.dictionaryOverrides[k] = v;
        mutated = true;
      }
    }
    for (const [k, v] of Object.entries(customWords)) {
      const local = this.dictionaryCustomWords[k];
      const localTs = local?.updatedAt ?? "";
      const remoteTs = v?.updatedAt ?? "";
      if (!local || remoteTs > localTs) {
        this.dictionaryCustomWords[k] = v;
        mutated = true;
      }
    }
    if (!mutated) return;
    // Persist WITHOUT triggering another mirror write loop — the mirror
    // hash will match what was just absorbed, so the watcher would no-op
    // anyway, but skip the redundant work.
    await this.updateDataBlob((blob) => {
      blob.dictionaryOverrides = this.dictionaryOverrides;
      blob.dictionaryCustomWords = this.dictionaryCustomWords;
    });
    await this.dictionary.reload();
    this.refreshTokenizerCustomWords();
    this.refreshChineseViews();
    this.refreshStatsViews();
  }

  async setDictionaryOverride(key: string, ov: DictionaryOverride): Promise<void> {
    this.dictionaryOverrides[key] = { ...ov, updatedAt: new Date().toISOString() };
    await this.saveDictionaryUserData();
    await this.dictionary.reload();
    this.refreshChineseViews();
    // The 3-line ruby gloss reads from the cached token's `selected`
    // field, which is captured at tokenize-time. A plain redecorate
    // keeps the old definition until the cache is cleared. Mirror the
    // setCustomWord path (see `forceRetokenizeViews()` below) so the
    // ruby picks up the new first definition in the same paint.
    clearTokenCache();
    this.forceRetokenizeViews();
    this.refreshStatsViews();
  }

  async deleteDictionaryOverride(key: string): Promise<void> {
    delete this.dictionaryOverrides[key];
    await this.saveDictionaryUserData();
    await this.dictionary.reload();
    this.refreshChineseViews();
    clearTokenCache();
    this.forceRetokenizeViews();
    this.refreshStatsViews();
  }

  async setCustomWord(surface: string, entry: Omit<DictionaryCustomWord, "createdAt" | "updatedAt">): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.dictionaryCustomWords[surface];
    this.dictionaryCustomWords[surface] = {
      ...entry,
      simplified: surface,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.saveDictionaryUserData();
    await this.dictionary.reload();
    this.refreshTokenizerCustomWords();
    this.refreshChineseViews();
    this.forceRetokenizeViews();
    this.refreshStatsViews();
  }

  async deleteCustomWord(surface: string): Promise<void> {
    delete this.dictionaryCustomWords[surface];
    await this.saveDictionaryUserData();
    await this.dictionary.reload();
    this.refreshTokenizerCustomWords();
    this.refreshChineseViews();
    this.forceRetokenizeViews();
    this.refreshStatsViews();
  }

  /**
   * Sync the tokenizer with the current custom-word list. Each custom
   * word becomes a `mergeAs` override so the lattice/trie treats it as a
   * single token. Clears the token cache so the next decoration build
   * re-tokenizes against the new overrides.
   */
  refreshTokenizerCustomWords(): void {
    const overrides = Object.values(this.dictionaryCustomWords).map((w) => ({
      surface: w.simplified,
      mergeAs: w.simplified,
    }));
    this.tokenizer.setOverrides(overrides);
    this.tokenizer.invalidate();
    clearTokenCache();
  }

  /**
   * Called by the Settings tab after the user flips the vocabulary mirror
   * toggle on (or changes the path). Reads the existing mirror first (so
   * a pre-synced file isn't clobbered by the local — possibly empty —
   * store), merges and writes the result, then re-arms the periodic poll.
   */
  async refreshSyncMirror(): Promise<void> {
    await this.vocab.reloadMirror();
    this.startSyncMirrorPoller();
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
    const isSettingsMirrorPath = (path: string): boolean => {
      const p = this.settings.sync?.settingsMirrorPath;
      if (!p || !this.settings.sync?.settingsMirrorEnabled) return false;
      return normalizePath(path) === normalizePath(p);
    };
    this.registerEvent(
      this.app.vault.on("modify", async (file: TAbstractFile) => {
        if (this.settings.sync?.mirrorEnabled && isMirrorPath(file.path)) {
          const changed = await this.vocab.absorbExternalMirrorChange();
          if (changed) {
            this.refreshChineseViews();
            this.refreshStatsViews();
          }
          return;
        }
        if (isSettingsMirrorPath(file.path)) {
          await this.settingsMirror.absorbExternalChange();
          return;
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", async (file: TAbstractFile) => {
        if (
          this.settings.sync?.mirrorEnabled &&
          (isMirrorPath(file.path) || isMirrorConflict(file.path))
        ) {
          await this.vocab.reloadMirror();
          this.refreshChineseViews();
          this.refreshStatsViews();
          return;
        }
        if (isSettingsMirrorPath(file.path)) {
          await this.settingsMirror.bootstrap();
          return;
        }
      })
    );
  }

  /**
   * Belt-and-suspenders for the `modify` watcher: the vault event can be
   * missed when remotely-save writes while the window is backgrounded or
   * when sync happens via a path that bypasses Obsidian's vault layer.
   * Periodically re-check the mirror file's hash and merge if it diverged.
   *
   * Adaptive cadence: when at least one Chinese view is open, poll every
   * 3 s for near-instant cross-device updates. When no Chinese view is
   * open, fall back to the user's configured `mirrorPollIntervalMinutes`.
   * The 3 s tick is virtually free thanks to the mtime gate inside
   * absorbExternalMirrorChange — no 2.9 MB read unless the file moved.
   */
  private mirrorPollTimer: number | null = null;
  private mirrorPollMode: "fast" | "slow" = "slow";
  private static FAST_POLL_MS = 3_000;

  private chineseViewIsOpen(): boolean {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE).length > 0;
  }

  private syncPollerMs(): number {
    if (this.chineseViewIsOpen()) return CciPlugin.FAST_POLL_MS;
    const minutes = this.settings.sync?.mirrorPollIntervalMinutes ?? 5;
    if (!minutes || minutes <= 0) return 0;
    return Math.max(30_000, Math.floor(minutes * 60_000));
  }

  startSyncMirrorPoller(): void {
    if (this.mirrorPollTimer != null) {
      window.clearInterval(this.mirrorPollTimer);
      this.mirrorPollTimer = null;
    }
    this.mirrorPollMode = this.chineseViewIsOpen() ? "fast" : "slow";
    const ms = this.syncPollerMs();
    if (!ms) return;
    const handle = window.setInterval(() => {
      void (async () => {
      if (this.settings.sync?.mirrorEnabled) {
        try {
          const changed = await this.vocab.absorbExternalMirrorChange();
          if (changed) {
            this.refreshChineseViews();
            this.refreshStatsViews();
          }
        } catch (e) {
          console.error("CCI sync: mirror poll failed", e);
        }
      }
      // Settings mirror absorb piggybacks on the same tick. The file is
      // tiny; the absorb call is hash-gated so it's nearly free when
      // nothing changed. Catches external writes that Obsidian's modify
      // event misses (remotely-save / Nextcloud writes outside the TFile
      // layer).
      if (this.settings.sync?.settingsMirrorEnabled) {
        try {
          await this.settingsMirror.absorbExternalChange();
        } catch (e) {
          console.error("CCI settings mirror poll failed", e);
        }
      }
      })();
    }, ms);
    this.mirrorPollTimer = handle;
    this.registerInterval(handle);
  }

  private restartSyncPollerIfModeChanged(): void {
    const want: "fast" | "slow" = this.chineseViewIsOpen() ? "fast" : "slow";
    if (want !== this.mirrorPollMode) {
      this.startSyncMirrorPoller(); // sets this.mirrorPollMode internally
    }
  }

  /** One-shot mirror check, used on Chinese view activation so the user
   *  doesn't have to wait for the next poll tick. */
  private async checkMirrorOnce(): Promise<void> {
    if (!this.settings.sync?.mirrorEnabled) return;
    try {
      const changed = await this.vocab.absorbExternalMirrorChange();
      if (changed) {
        this.refreshChineseViews();
        this.refreshStatsViews();
      }
    } catch (e) {
      console.error("CCI sync: mirror check failed", e);
    }
  }

  /** One-shot settings-mirror absorb. Hooked into active-leaf-change and
   *  window focus so the user sees settings synced from another device
   *  the moment they switch back to this one. */
  private async checkSettingsMirrorOnce(): Promise<void> {
    if (!this.settings.sync?.settingsMirrorEnabled) return;
    try {
      await this.settingsMirror.absorbExternalChange();
    } catch (e) {
      console.error("CCI settings mirror check failed", e);
    }
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

  /** Modes where a tap is a tool action, so link-following must be suppressed. */
  isInteractiveMode(): boolean {
    const m = this.viewMode;
    return (
      m === "format" ||
      m === "mark-known" ||
      m === "mark-unknown" ||
      m === "mark-partial" ||
      m === "select-word"
    );
  }

  appendToCustomWordSelection(surface: string): void {
    this.pendingCustomSurface += surface;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      const v = leaf.view;
      if (v instanceof ChineseTextFileView && typeof v.refreshToolbar === "function") {
        try { v.refreshToolbar(); } catch (e) { console.warn("CCI refreshToolbar failed", e); }
      }
    }
  }

  clearCustomWordSelection(): void {
    this.pendingCustomSurface = "";
  }

  /** First tap in format mode: remember where the span starts (and the tapped
   *  surface, so the banner can confirm which start was registered). */
  beginFormatRange(pos: number, surface?: string): void {
    this.pendingFormatStart = pos;
    this.pendingFormatStartSurface = surface ?? null;
    this.refreshChineseViewToolbars();
  }

  /** Second tap in format mode: wrap [start, end) in the armed formats. */
  applyFormatRange(endPos: number): void {
    const anchor = this.pendingFormatStart;
    this.pendingFormatStart = null;
    this.pendingFormatStartSurface = null;
    if (anchor == null) {
      this.refreshChineseViewToolbars();
      return;
    }
    // Normalize so tapping the end before the start (in document order) still
    // produces a valid non-empty range.
    const start = Math.min(anchor, endPos);
    endPos = Math.max(anchor, endPos);
    const formats = this.settings.enabledFormats;
    const view = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CHINESE)
      .map((l) => l.view)
      .find((v): v is ChineseTextFileView => v instanceof ChineseTextFileView);
    if (!view) {
      this.refreshChineseViewToolbars();
      return;
    }
    // Resolve a colored-highlight wrap when an `hl:<slug>` option is armed.
    let hlWrap: HighlightWrap | undefined;
    const colorId = formats.find((f) => f.startsWith("hl:"));
    if (colorId) {
      const palette = resolveHighlightPalette(this.app, this.settings);
      const hc = highlightColorForId(colorId, palette);
      if (hc) hlWrap = highlightWrap(hc, this.app);
    }
    // Empty `formats` is intentional: it strips existing formatting from the span.
    view.applyFormatToRange(start, endPos, formats, hlWrap, this.settings.formatReverseMode);
    this.refreshChineseViewToolbars();
  }

  private refreshChineseViewToolbars(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      const v = leaf.view;
      if (v instanceof ChineseTextFileView && typeof v.refreshToolbar === "function") {
        try { v.refreshToolbar(); } catch (e) { console.warn("CCI refreshToolbar failed", e); }
      }
    }
  }

  setActiveViewMode(m: ViewMode): void {
    const prev = this.viewMode;
    this.viewMode = m;
    // Whenever we leave OR enter select-word mode, clear the running
    // surface so the next pass starts fresh.
    if (prev !== m && (prev === "select-word" || m === "select-word")) {
      this.pendingCustomSurface = "";
    }
    // Entering or leaving format mode drops any half-finished range.
    if (prev !== m && (prev === "format" || m === "format")) {
      this.pendingFormatStart = null;
      this.pendingFormatStartSurface = null;
    }
    const editBoundaryCrossed = (prev === "edit") !== (m === "edit");
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      const v = leaf.view;
      if (!(v instanceof ChineseTextFileView)) continue;
      try {
        if (typeof v.refreshToolbar === "function") v.refreshToolbar();
        if (editBoundaryCrossed) {
          if (typeof v.reconfigureEditor === "function") v.reconfigureEditor();
        } else {
          if (typeof v.redecorate === "function") v.redecorate();
        }
      } catch (e) {
        console.warn("CCI view refresh failed", e);
      }
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
      // iOS Obsidian's MarkdownView doesn't expose `addAction` — guard so
      // an iPad load doesn't crash here. Desktop / Android still get the
      // header button.
      if (typeof (view as unknown as { addAction?: unknown }).addAction !== "function") {
        this.injectedMarkdownViews.add(view);
        continue;
      }
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
    const setting = this.app.setting;
    if (setting && typeof setting.close === "function") {
      try { setting.close(); } catch { /* best effort */ }
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS);
    if (existing.length) {
      void this.app.workspace.revealLeaf(existing[0]);
      this.app.workspace.setActiveLeaf(existing[0], { focus: true });
      const view = existing[0].view as StatsView;
      await view.setScope(useScope);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_STATS });
    void this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view as StatsView;
    await view.setScope(useScope);
  }

  refreshStatsViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS)) {
      const v = leaf.view;
      // iOS deferred / restored views may not yet have our class methods
      // attached. instanceof + typeof guard prevents
      // `e.view.render is not a function` from leaking into a Notice.
      if (v instanceof StatsView && typeof v.render === "function") {
        try { v.render(); } catch (e) { console.warn("CCI stats render failed", e); }
      }
    }
  }

  openGenerateStoryModal(): void {
    if (!this.settings.ai.enabled) {
      new Notice("Enable AI in plugin settings first.");
      return;
    }
    new GenerateStoryModal(this.app, this).open();
  }

  openWordPopup(surface: string, target: HTMLElement, ev: Event, sentence?: string): void {
    this.popup.open(surface, target, ev, sentence);
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
      const v = leaf.view;
      if (!(v instanceof ChineseTextFileView)) continue;
      if (typeof v.redecorate === "function") {
        try { v.redecorate(); } catch (e) { console.warn("CCI redecorate failed", e); }
      }
      if (typeof v.refreshToolbar === "function") {
        try { v.refreshToolbar(); } catch (e) { console.warn("CCI refreshToolbar failed", e); }
      }
    }
  }

  /** Force a full re-tokenization on all Chinese views. Needed after custom-word
   *  changes because the cached token list inside the ViewPlugin is stale. */
  forceRetokenizeViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHINESE)) {
      const v = leaf.view;
      if (v instanceof ChineseTextFileView && typeof v.forceRetokenize === "function") {
        try { v.forceRetokenize(); } catch (e) { console.warn("CCI forceRetokenize failed", e); }
      }
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
    const hskKnown = new Map<string, number>();
    for (const tok of tokens) {
      if (!tok.isWord || tok.candidates.length === 0) continue;
      counts.total++;
      const hsk = tok.selected?.hsk?.levels?.[0];
      const rec = this.vocab.bySurface(tok.surface);
      const status = rec?.status ?? "new";
      if (status === "ignored") {
        counts.total--; // don't count ignored
        continue;
      }
      if (hsk) {
        hskCounts.set(hsk, (hskCounts.get(hsk) ?? 0) + 1);
        if (status === "known") hskKnown.set(hsk, (hskKnown.get(hsk) ?? 0) + 1);
      }
      if (status === "new") counts.newCount++;
      else if (status === "known") counts.known++;
      else if (status === "unknown") counts.unknown++;
      else counts.partial++;
    }
    const threshold = this.settings.topHskComfortThreshold ?? 0.67;
    const MIN_SAMPLE = 5;
    let cumTotal = 0;
    let cumKnown = 0;
    let topHsk = "";
    for (const lvl of ["1", "2", "3", "4", "5", "6", "7"]) {
      cumTotal += hskCounts.get(lvl) ?? 0;
      cumKnown += hskKnown.get(lvl) ?? 0;
      if (cumTotal >= MIN_SAMPLE && cumKnown / cumTotal >= threshold) {
        topHsk = lvl;
      }
    }
    return { ...counts, topHsk };
  }
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseHHMMToDate(hhmm: string, ref: Date): Date {
  const [hh, mm] = (hhmm ?? "08:00").split(":").map((s) => parseInt(s, 10));
  const out = new Date(ref);
  out.setHours(Number.isFinite(hh) ? hh : 8, Number.isFinite(mm) ? mm : 0, 0, 0);
  return out;
}
