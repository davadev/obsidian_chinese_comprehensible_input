import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type CciPlugin from "../main";
import { VIEW_TYPE_CHINESE, VIEW_TYPE_STATS } from "../constants";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { colorClassKey, colorOf } from "../vocabulary/axes";
import { Bucket, bucketTimestamps, renderDailyGraph, renderProgressArea, renderProgressGraph } from "./StatsGraph";
import { HSK_LEVEL_COUNTS } from "../dictionary/hskMap.generated";
import { StoryPreview } from "../ai/StoryGenerator";

type SortKey = "seenCount" | "lastSeenAt" | "dueAt" | "status" | "hsk";
type Tab = "dashboard" | "words" | "flashcards";
type FlashcardsMode = "unclassified" | "due" | "smart";
type ProgressSeriesId = "tracked" | "classified" | "known" | "partial" | "unknown";
type HskBucketId = "known" | "partial" | "unknown" | "new" | "untracked";

export class StatsView extends ItemView {
  private query = "";
  private statusFilter: WordStatus | "all" | "partial" = "all";
  private hskFilter = "all";
  private sortKey: SortKey = "seenCount";
  private sortDesc = true;
  private noteScope = "";
  /** Surfaces found by tokenizing the scoped note's text. Empty when global. */
  private noteSurfaces: Set<string> = new Set();
  private tab: Tab = "dashboard";
  private progressBucket: Bucket = "day";
  private progressWindow = { day: 30, week: 12, month: 12 } as const;
  private triageIndex = 0;
  private triageContextCache = new Map<string, string>();
  private triagePartialAxes: { surface: string; chars: boolean; pinyin: boolean; meaning: boolean } | null = null;
  private triageReveal = 0; // 0 = chars only, 1 = + pinyin, 2 = + definitions
  // Flashcards tab — mode is persisted in settings. Smart story panel
  // caches the AI connection test result for the lifetime of the view.
  private smartReady: boolean | null = null;
  private smartGenerating = false;
  private currentPreview: StoryPreview | null = null;
  private chartStyle: "bars" | "area" = "area";
  // Progress-chart series filter. Order matters for the legend.
  private progressSeries: Record<ProgressSeriesId, boolean> = {
    tracked: false,
    classified: true,
    known: true,
    partial: false,
    unknown: false,
  };
  // HSK coverage chart bucket filter.
  private hskBuckets: Record<HskBucketId, boolean> = {
    known: true,
    partial: false,
    unknown: false,
    new: false,
    untracked: false,
  };

  constructor(leaf: WorkspaceLeaf, private plugin: CciPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STATS;
  }
  getDisplayText(): string {
    return "Chinese Vocabulary Stats";
  }
  getIcon(): string {
    return "bar-chart-3";
  }

  async setScope(notePath: string): Promise<void> {
    this.noteScope = notePath;
    this.noteSurfaces.clear();
    if (notePath) {
      const f = this.app.vault.getAbstractFileByPath(notePath);
      if (f instanceof TFile) {
        try {
          const text = await this.app.vault.cachedRead(f);
          const tokens = await this.plugin.tokenizer.tokenize(text);
          for (const t of tokens) {
            if (t.isWord) this.noteSurfaces.add(t.surface);
          }
        } catch {
          // Graceful: if the file is gone or unreadable, noteSurfaces stays empty.
        }
      }
    }
    if (this.containerEl.children[1]) this.render();
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    if (this.containerEl.children[1]) this.render();
  }

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.containerEl.children[1].addClass("cci-stats");
    this.render();
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();

    this.renderHeader(root);
    this.renderTabs(root);
    if (this.tab === "dashboard") this.renderDashboard(root);
    else if (this.tab === "flashcards") this.renderFlashcards(root);
    else this.renderWords(root);
  }

  private renderHeader(root: HTMLElement) {
    const header = root.createDiv({ cls: "cci-stats-header" });
    const back = header.createEl("button", { cls: "cci-stats-back", text: "← Back" });
    back.addEventListener("click", () => this.leaf.detach());
    header.createEl("h2", { text: "Vocabulary stats", cls: "cci-stats-title" });

    const scopeSel = header.createEl("select", { cls: "cci-stats-scope" });
    const opts: [string, string][] = [["", "Scope: all vocabulary"]];
    for (const p of this.plugin.vocab.knownNotePaths()) opts.push([p, `Note: ${p}`]);
    if (this.noteScope && !opts.find(([v]) => v === this.noteScope)) {
      opts.push([this.noteScope, `Note: ${this.noteScope}`]);
    }
    for (const [v, l] of opts) {
      const o = scopeSel.createEl("option", { text: l });
      o.value = v;
    }
    scopeSel.value = this.noteScope;
    scopeSel.addEventListener("change", async () => {
      await this.setScope(scopeSel.value);
    });
  }

  private renderTabs(root: HTMLElement) {
    const tabs = root.createDiv({ cls: "cci-stats-tabs" });
    const mkTab = (label: string, key: Tab) => {
      const b = tabs.createEl("button", { cls: "cci-stats-tab", text: label });
      if (this.tab === key) b.addClass("is-active");
      b.addEventListener("click", () => {
        this.tab = key;
        this.render();
      });
    };
    mkTab("Dashboard", "dashboard");
    mkTab("Flashcards", "flashcards");
    mkTab("Words", "words");
  }

  // ── Dashboard ──────────────────────────────────────────────────────

  private renderDashboard(root: HTMLElement) {
    const scoped = this.scopedRecords();
    const counts = bucketCounts(scoped);
    const total = scoped.length;
    const excludeNew = this.plugin.settings.statsExcludeNew;
    const denom = excludeNew
      ? counts.known + counts.partial + counts.unknown
      : total - counts.ignored;
    const pct = (n: number) => (denom ? Math.round((n / denom) * 100) : 0);

    // Exclude-"new" toggle row (top of dashboard so it's the first thing
    // the user sees affecting the cards).
    const toggleRow = root.createDiv({ cls: "cci-dash-toggle" });
    const cb = toggleRow.createEl("input", { type: "checkbox" });
    cb.checked = excludeNew;
    cb.addEventListener("change", async () => {
      this.plugin.settings.statsExcludeNew = cb.checked;
      await this.plugin.saveSettings();
      this.render();
    });
    toggleRow.createSpan({
      text: ` Exclude unclassified ("new") words from %`,
    });
    toggleRow.createSpan({
      cls: "cci-dash-toggle-hint",
      text: ` (${counts.new} hidden when on)`,
    });

    const grid = root.createDiv({ cls: "cci-dash-grid" });
    this.statCard(grid, "Tracked", String(total), "Words this plugin has recorded.");
    this.statCard(grid, "Known", `${counts.known} · ${pct(counts.known)}%`, "All three axes ticked.", "cci-color-known");
    this.statCard(grid, "Partial", `${counts.partial} · ${pct(counts.partial)}%`, "Some axes ticked.", "cci-color-partial");
    this.statCard(grid, "Unknown", `${counts.unknown} · ${pct(counts.unknown)}%`, "No axes ticked.", "cci-color-unknown");
    this.statCard(grid, "New", `${counts.new}`, "Seen but not classified yet.", "cci-color-new");
    this.statCard(grid, "Ignored", `${counts.ignored}`, "Excluded from review.");

    // Comfort level is always computed against the GLOBAL vocabulary —
    // it is a learner-wide metric, not a per-note one. The scope dropdown
    // controls the cards above and the per-note table below, but not
    // this card.
    const estimated = estimateLearnerHsk(
      this.plugin.vocab.values(),
      this.plugin.settings.story.knownCoverageThreshold,
      excludeNew
    );
    this.statCard(
      grid,
      "Comfort level",
      estimated,
      "Highest HSK level where ≥ threshold of your classified vocabulary is known. Always global."
    );

    if (!this.noteScope) {
      const globalPct = pct(counts.known);
      this.statCard(grid, "Overall known", `${globalPct}%`, "Known out of the denominator selected above.");
    }

    // Batch action: only meaningful in global scope.
    if (!this.noteScope && counts.new > 0) {
      const actions = root.createDiv({ cls: "cci-dash-actions" });
      const btn = actions.createEl("button", {
        cls: "cci-dash-batch-btn",
        text: `Mark all ${counts.new} new words as Unknown`,
      });
      btn.addEventListener("click", () => {
        if (!confirm(`Mark ${counts.new} unclassified words as "unknown"? This can be reversed per-word.`)) return;
        const n = this.plugin.vocab.markAllNewAs("unknown");
        this.plugin.refreshChineseViews();
        this.plugin.refreshStatsViews();
        // refreshStatsViews re-renders this view, so just return.
        void n;
      });
    }

    this.renderProgressSection(root, scoped);
    this.renderHskCoverageSection(root);

    // Per-note exposure breakdown.
    const notePaths = this.plugin.vocab.knownNotePaths();
    if (notePaths.length > 0 && !this.noteScope) {
      const wrap = root.createDiv({ cls: "cci-dash-notes" });
      wrap.createEl("h3", { text: "Per-note exposure" });
      const tableWrap = wrap.createDiv({ cls: "cci-dash-notes-tablewrap" });
      const tbl = tableWrap.createEl("table", { cls: "cci-dash-notes-table" });
      const head = tbl.createEl("thead").createEl("tr");
      ["Note", "Tracked", "Known", "Known %"].forEach((h) => head.createEl("th", { text: h }));
      const body = tbl.createEl("tbody");
      const allRecords = this.plugin.vocab.values();
      for (const p of notePaths) {
        const recs = allRecords.filter((r) => (r.notesSeenCounts ?? {})[p] > 0);
        const c = bucketCounts(recs);
        const denomP = excludeNew
          ? c.known + c.partial + c.unknown
          : recs.length - c.ignored;
        const pctKnown = denomP ? Math.round((c.known / denomP) * 100) : 0;
        const tr = body.createEl("tr");
        const noteTd = tr.createEl("td", { text: p });
        noteTd.addClass("cci-clickable");
        noteTd.addEventListener("click", async () => {
          await this.setScope(p);
        });
        tr.createEl("td", { text: String(recs.length) });
        tr.createEl("td", { text: String(c.known) });
        tr.createEl("td", { text: `${pctKnown}%` });
      }
    }
  }

  private renderProgressSection(root: HTMLElement, records: WordRecord[]) {
    const wrap = root.createDiv({ cls: "cci-dash-progress" });
    const head = wrap.createDiv({ cls: "cci-dash-progress-head" });
    head.createEl("h3", { text: "Progress" });
    const controls = head.createDiv({ cls: "cci-dash-progress-controls" });

    const styleSel = controls.createEl("select", { cls: "cci-dash-progress-bucket" });
    for (const [v, l] of [["area", "Cumulative"], ["bars", "Per period"]] as ["bars" | "area", string][]) {
      const o = styleSel.createEl("option", { text: l });
      o.value = v;
    }
    styleSel.value = this.chartStyle;
    styleSel.addEventListener("change", () => {
      this.chartStyle = styleSel.value as "bars" | "area";
      this.render();
    });

    const bucketSel = controls.createEl("select", { cls: "cci-dash-progress-bucket" });
    for (const [v, l] of [["day", "Daily (30)"], ["week", "Weekly (12)"], ["month", "Monthly (12)"]] as [Bucket, string][]) {
      const o = bucketSel.createEl("option", { text: l });
      o.value = v;
    }
    bucketSel.value = this.progressBucket;
    bucketSel.addEventListener("change", () => {
      this.progressBucket = bucketSel.value as Bucket;
      this.render();
    });

    // Series filter row — user picks which curves appear on the chart.
    const filterRow = wrap.createDiv({ cls: "cci-dash-progress-filter" });
    const seriesDefs: { id: ProgressSeriesId; label: string; color: string }[] = [
      { id: "tracked",    label: "Tracked",    color: "rgba(150, 150, 150, 0.85)" },
      { id: "classified", label: "Classified", color: "rgba(88, 166, 255, 0.85)" },
      { id: "known",      label: "Known",      color: "rgba(46, 160, 67, 0.85)" },
      { id: "partial",    label: "Partial",    color: "rgba(220, 180, 30, 0.85)" },
      { id: "unknown",    label: "Unknown",    color: "rgba(220, 60, 60, 0.85)" },
    ];
    for (const def of seriesDefs) {
      const lbl = filterRow.createEl("label", { cls: "cci-dash-progress-filter-item" });
      const cb = lbl.createEl("input", { type: "checkbox" });
      cb.checked = this.progressSeries[def.id];
      cb.addEventListener("change", () => {
        this.progressSeries[def.id] = cb.checked;
        this.render();
      });
      const swatch = lbl.createSpan({ cls: "cci-dash-progress-filter-swatch" });
      swatch.style.background = def.color;
      lbl.createSpan({ text: ` ${def.label}` });
    }

    const n = this.progressWindow[this.progressBucket];

    // Build per-series timestamps with the appropriate filter.
    const stampFor = (id: ProgressSeriesId): (string | undefined)[] => {
      switch (id) {
        case "tracked":    return records.map((r) => r.firstSeenAt);
        case "classified": return records.map((r) => r.classifiedAt);
        case "known":      return records.filter((r) => r.status === "known").map((r) => r.knownAt);
        case "partial":    return records
          .filter((r) => {
            const c = colorOf(r);
            return c === "partial";
          })
          .map((r) => r.classifiedAt);
        case "unknown":    return records.filter((r) => r.status === "unknown").map((r) => r.classifiedAt);
      }
    };

    const activeSeries = seriesDefs
      .filter((d) => this.progressSeries[d.id])
      .map((d) => ({
        label: d.label,
        color: d.color,
        data: bucketTimestamps(stampFor(d.id), this.progressBucket, n),
      }));

    const graphHost = wrap.createDiv({ cls: "cci-dash-progress-graph" });
    if (activeSeries.length === 0) {
      graphHost.createEl("p", {
        cls: "cci-dash-progress-summary",
        text: "Pick at least one series above.",
      });
    } else if (this.chartStyle === "area") {
      renderProgressArea(graphHost, activeSeries);
    } else {
      renderProgressGraph(graphHost, activeSeries);
    }

    const range =
      this.progressBucket === "day" ? "30 days" :
      this.progressBucket === "week" ? "12 weeks" : "12 months";
    const summary = activeSeries
      .map((s) => `${s.label} ${s.data.reduce((a, b) => a + b.count, 0)}`)
      .join(", ");
    if (summary) {
      wrap.createEl("p", {
        cls: "cci-dash-progress-summary",
        text: `Last ${range}: ${summary}.`,
      });
    }
  }

  // ── HSK coverage ────────────────────────────────────────────────────
  //
  // Per-level horizontal stacked bars showing what fraction of each
  // HSK level the user has classified into Known / Partial / Unknown /
  // New / still-untracked. User picks which buckets to show via the
  // checkbox row above the chart. Default = Known only.

  private renderHskCoverageSection(root: HTMLElement) {
    const wrap = root.createDiv({ cls: "cci-dash-hsk" });
    const head = wrap.createDiv({ cls: "cci-dash-progress-head" });
    head.createEl("h3", { text: "HSK coverage" });
    const filter = wrap.createDiv({ cls: "cci-dash-progress-filter" });
    const defs: { id: HskBucketId; label: string; color: string }[] = [
      { id: "known",     label: "Known",     color: "rgba(46, 160, 67, 0.85)" },
      { id: "partial",   label: "Partial",   color: "rgba(220, 180, 30, 0.85)" },
      { id: "unknown",   label: "Unknown",   color: "rgba(220, 60, 60, 0.85)" },
      { id: "new",       label: "New",       color: "rgba(88, 166, 255, 0.70)" },
      { id: "untracked", label: "Untracked", color: "rgba(150, 150, 150, 0.55)" },
    ];
    for (const def of defs) {
      const lbl = filter.createEl("label", { cls: "cci-dash-progress-filter-item" });
      const cb = lbl.createEl("input", { type: "checkbox" });
      cb.checked = this.hskBuckets[def.id];
      cb.addEventListener("change", () => {
        this.hskBuckets[def.id] = cb.checked;
        this.render();
      });
      const swatch = lbl.createSpan({ cls: "cci-dash-progress-filter-swatch" });
      swatch.style.background = def.color;
      lbl.createSpan({ text: ` ${def.label}` });
    }

    const all = this.plugin.vocab.values();
    const grid = wrap.createDiv({ cls: "cci-dash-hsk-grid" });
    for (let level = 1; level <= 6; level++) {
      const lvlKey = String(level);
      const recsAtLevel = all.filter((r) => r.hsk?.levels?.[0] === lvlKey);
      let known = 0, partial = 0, unknown = 0, newCount = 0, ignored = 0;
      for (const r of recsAtLevel) {
        const c = colorOf(r);
        if (c === "known") known++;
        else if (c === "partial") partial++;
        else if (c === "unknown") unknown++;
        else if (c === "ignored") ignored++;
        else newCount++;
      }
      const total = HSK_LEVEL_COUNTS[level] ?? 0;
      const tracked = known + partial + unknown + newCount + ignored;
      const untracked = Math.max(0, total - tracked);

      const row = grid.createDiv({ cls: "cci-dash-hsk-row" });
      row.createSpan({ cls: "cci-dash-hsk-label", text: `HSK ${level}` });
      const barWrap = row.createDiv({ cls: "cci-dash-hsk-bar" });
      const counts: Record<HskBucketId, number> = {
        known, partial, unknown, new: newCount, untracked,
      };
      const segPct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
      let combinedPct = 0;
      for (const def of defs) {
        if (!this.hskBuckets[def.id]) continue;
        const c = counts[def.id];
        if (c === 0) continue;
        const pct = segPct(c);
        combinedPct += pct;
        const seg = barWrap.createDiv({ cls: "cci-dash-hsk-seg" });
        seg.style.width = `${pct}%`;
        seg.style.background = def.color;
        seg.setAttribute(
          "title",
          `HSK ${level} · ${def.label}: ${c} / ${total} (${pct.toFixed(1)}%)`
        );
      }
      row.createSpan({
        cls: "cci-dash-hsk-pct",
        text: `${combinedPct.toFixed(0)}% · ${total}`,
      });
    }
    wrap.createEl("p", {
      cls: "cci-dash-progress-summary",
      text: "Percentages are out of the total HSK 2.0 word list for each level.",
    });
  }

  // ── Triage ──────────────────────────────────────────────────────────
  // Card UI: pick the most-frequent unclassified words and let the user
  // mark known/unknown/partial/ignore with one tap. The example sentence
  // is pulled from a note the word was actually seen in so the user can
  // judge from context.

  /**
   * Flashcards tab entry: renders the mode selector and dispatches into
   * the per-mode body. "Unclassified" and "Due" share the card UI; the
   * caller only differs in the queue source. "Smart" is a separate
   * panel that talks to the LLM via StoryGenerator.
   */
  private renderFlashcards(root: HTMLElement) {
    const wrap = root.createDiv({ cls: "cci-triage" });
    this.renderFlashcardsModeSelector(wrap);
    const mode = this.plugin.settings.flashcardsMode;
    if (mode === "smart") {
      this.renderFlashcardsSmart(wrap);
      return;
    }
    this.renderFlashcardsCards(wrap, mode);
  }

  private renderFlashcardsModeSelector(parent: HTMLElement) {
    const row = parent.createDiv({ cls: "cci-fc-mode" });
    const opts: { id: FlashcardsMode; label: string; hint: string }[] = [
      { id: "unclassified", label: "Unclassified", hint: "Frequency-sorted new words" },
      { id: "due",          label: "Due",          hint: "SRS-due reviews"            },
      { id: "smart",        label: "Smart story",  hint: "LLM story over due words"   },
    ];
    for (const opt of opts) {
      const btn = row.createEl("button", {
        cls:
          "cci-fc-mode-btn" +
          (this.plugin.settings.flashcardsMode === opt.id ? " is-active" : ""),
        attr: { title: opt.hint },
      });
      btn.textContent = opt.label;
      btn.addEventListener("click", async () => {
        if (this.plugin.settings.flashcardsMode === opt.id) return;
        this.plugin.settings.flashcardsMode = opt.id;
        await this.plugin.saveSettings();
        this.triageIndex = 0;
        this.triageReveal = 0;
        this.triagePartialAxes = null;
        if (opt.id === "smart") this.smartReady = null;
        this.render();
      });
    }
  }

  /**
   * Single source of truth for what queue each Flashcards mode shows.
   * Reused by the renderer, the Skip button, and the post-classification
   * "advance past the current rec" logic.
   */
  private flashcardsQueue(mode: FlashcardsMode): WordRecord[] {
    if (mode === "due") {
      return this.plugin.srs.due().slice().sort((a, b) => {
        const da = Date.parse(a.srs?.dueAt ?? "");
        const db = Date.parse(b.srs?.dueAt ?? "");
        return (isNaN(da) ? 0 : da) - (isNaN(db) ? 0 : db);
      });
    }
    return this.scopedRecords()
      .filter((r) => r.status === "new")
      .sort((a, b) => (b.seenCount ?? 0) - (a.seenCount ?? 0));
  }

  /**
   * After a classification, advance the index past `markedKey` if the
   * post-mutation queue still contains it (this happens in Due mode
   * when the grade didn't push the word past `dueAt`'s threshold,
   * or in Unclassified if the marked record's seenCount math left it
   * in the bucket). Otherwise leave the index alone — the marked
   * record dropped out of the queue and the next item naturally slid
   * into the same slot.
   */
  private advancePastIfPresent(markedKey: string | undefined): void {
    const queue = this.flashcardsQueue(this.plugin.settings.flashcardsMode);
    if (queue.length === 0) {
      this.triageIndex = 0;
      return;
    }
    if (markedKey && queue.some((r) => r.key === markedKey)) {
      this.triageIndex = (this.triageIndex + 1) % queue.length;
    } else if (this.triageIndex >= queue.length) {
      this.triageIndex = 0;
    }
  }

  private renderFlashcardsCards(root: HTMLElement, mode: FlashcardsMode) {
    const queue = this.flashcardsQueue(mode);

    if (queue.length === 0) {
      root.createEl("p", {
        cls: "cci-triage-empty",
        text:
          mode === "due"
            ? "Nothing due right now. Mark a few words via the popup so SRS has something to schedule."
            : "No unclassified words in this scope. Open a Chinese note (or run Reindex vault) to surface more.",
      });
      return;
    }

    const wrap = root;

    if (this.triageIndex >= queue.length) this.triageIndex = 0;
    const total = queue.length;
    const i = this.triageIndex;
    const rec = queue[i];

    const header = wrap.createDiv({ cls: "cci-triage-header" });
    header.createSpan({
      cls: "cci-triage-progress",
      text: `Word ${i + 1} of ${total}  ·  sorted by frequency`,
    });
    const skipBtn = header.createEl("button", { cls: "cci-triage-skip", text: "Skip →" });
    skipBtn.addEventListener("click", () => {
      this.triageIndex = (this.triageIndex + 1) % total;
      this.triageReveal = 0;
      this.render();
    });

    const card = wrap.createDiv({ cls: "cci-triage-card" });
    const surface = rec.simplified ?? rec.surfaces[0] ?? "";
    const headRow = card.createDiv({ cls: "cci-triage-headrow" });
    const headTerm = headRow.createDiv({ cls: "cci-triage-term" });
    headTerm.textContent = surface;
    const meta = headRow.createDiv({ cls: "cci-triage-meta" });
    // Pinyin + definitions are answer-revealing. Hidden by default so
    // the user assesses from context first. The Reveal button below
    // unlocks them step by step.
    if (rec.pinyin && this.triageReveal >= 1) {
      meta.createDiv({ cls: "cci-triage-pinyin", text: rec.pinyin });
    }
    const seenLine = `Seen ${rec.seenCount}×`;
    meta.createDiv({ cls: "cci-triage-stats", text: seenLine });

    if (rec.definitions && rec.definitions.length > 0 && this.triageReveal >= 2) {
      const defs = card.createDiv({ cls: "cci-triage-defs" });
      defs.textContent = rec.definitions.slice(0, 2).join("; ");
    }

    // Reveal control. Stages: 0 = chars only, 1 = + pinyin, 2 = + defs.
    const canRevealPinyin = !!rec.pinyin;
    const canRevealDefs = !!(rec.definitions && rec.definitions.length);
    const maxStage = canRevealDefs ? 2 : canRevealPinyin ? 1 : 0;
    if (maxStage > 0 && this.triageReveal < maxStage) {
      const revealRow = card.createDiv({ cls: "cci-triage-reveal" });
      const nextLabel =
        this.triageReveal === 0 ? (canRevealPinyin ? "Reveal pinyin" : "Reveal meaning") :
        "Reveal meaning";
      const btn = revealRow.createEl("button", { cls: "cci-triage-reveal-btn", text: nextLabel });
      btn.addEventListener("click", () => {
        this.triageReveal = Math.min(maxStage, this.triageReveal + 1);
        this.render();
      });
    }

    const ctxBox = card.createDiv({ cls: "cci-triage-context" });
    ctxBox.textContent = "Loading context…";
    void this.loadTriageContext(rec).then((ctx) => {
      ctxBox.empty();
      if (!ctx) {
        ctxBox.createSpan({ cls: "cci-triage-context-none", text: "No example sentence found." });
        return;
      }
      const before = ctx.sentence.slice(0, ctx.matchStart);
      const matched = ctx.sentence.slice(ctx.matchStart, ctx.matchStart + surface.length);
      const after = ctx.sentence.slice(ctx.matchStart + surface.length);
      ctxBox.appendText(before);
      ctxBox.createSpan({ cls: "cci-triage-hit", text: matched });
      ctxBox.appendText(after);
      const src = card.createDiv({ cls: "cci-triage-context-src" });
      src.createSpan({ text: "from " });
      const a = src.createEl("a", { text: ctx.notePath, href: "#" });
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const f = this.plugin.app.vault.getAbstractFileByPath(ctx.notePath);
        if (f instanceof TFile) this.plugin.app.workspace.openLinkText(ctx.notePath, "", false);
      });
    });

    const actions = card.createDiv({ cls: "cci-triage-actions" });
    const mkAct = (text: string, cls: string, fn: () => void) => {
      const b = actions.createEl("button", { cls: `cci-triage-act ${cls}`, text });
      b.addEventListener("click", fn);
    };
    mkAct("✓ Known", "is-known", () => this.applyTriage(surface, "known"));
    mkAct("? Partial…", "is-partial", () => this.openTriagePartial(surface, rec));
    mkAct("✗ Unknown", "is-unknown", () => this.applyTriage(surface, "unknown"));
    mkAct("Ignore", "is-ignored", () => this.applyTriage(surface, "ignored"));

    // If the user clicked "Partial…" the inline axes editor stays open
    // for this surface until Save / Cancel.
    if (this.triagePartialAxes && this.triagePartialAxes.surface === surface) {
      this.renderTriagePartialEditor(card, surface);
    }
  }

  private openTriagePartial(surface: string, rec: WordRecord) {
    const cur = rec.axes ?? { chars: false, pinyin: false, meaning: false };
    this.triagePartialAxes = {
      surface,
      chars: cur.chars,
      pinyin: cur.pinyin,
      meaning: cur.meaning,
    };
    this.render();
  }

  private renderTriagePartialEditor(parent: HTMLElement, surface: string) {
    const axes = this.triagePartialAxes!;
    const editor = parent.createDiv({ cls: "cci-triage-partial" });
    editor.createEl("p", {
      cls: "cci-triage-partial-hint",
      text: "Tick what you already know about this word. Status follows automatically.",
    });
    const row = editor.createDiv({ cls: "cci-triage-partial-row" });
    const mkBox = (label: string, key: "chars" | "pinyin" | "meaning") => {
      const wrap = row.createEl("label", { cls: "cci-triage-partial-box" });
      const cb = wrap.createEl("input", { type: "checkbox" });
      cb.checked = axes[key];
      cb.addEventListener("change", () => {
        axes[key] = cb.checked;
      });
      wrap.createSpan({ text: ` ${label}` });
    };
    mkBox("Characters", "chars");
    mkBox("Pinyin", "pinyin");
    mkBox("Meaning", "meaning");

    const btnRow = editor.createDiv({ cls: "cci-triage-partial-buttons" });
    const save = btnRow.createEl("button", { cls: "cci-triage-act is-partial", text: "Save" });
    save.addEventListener("click", () => {
      const before = this.flashcardsQueue(this.plugin.settings.flashcardsMode);
      const markedKey = before[this.triageIndex]?.key;
      this.plugin.vocab.setAxes(surface, {
        chars: axes.chars,
        pinyin: axes.pinyin,
        meaning: axes.meaning,
      });
      try { this.plugin.srs.applyGrade(surface, "hard"); } catch { /* best effort */ }
      this.advancePastIfPresent(markedKey);
      this.triagePartialAxes = null;
      this.triageContextCache.delete(surface);
      this.triageReveal = 0;
      this.plugin.refreshChineseViews();
      this.render();
    });
    const cancel = btnRow.createEl("button", { cls: "cci-triage-act is-ignored", text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.triagePartialAxes = null;
      this.render();
    });
  }

  private applyTriage(surface: string, status: WordStatus) {
    // Capture the key the card represents BEFORE the mutation so we can
    // detect whether the record stayed in the queue and advance past it
    // if so.
    const before = this.flashcardsQueue(this.plugin.settings.flashcardsMode);
    const markedKey = before[this.triageIndex]?.key;

    this.plugin.vocab.setStatus(surface, status);
    // Apply an SRS grade alongside the status change so the word's
    // `dueAt` advances. Without this, words in Due mode classified as
    // Partial / Unknown stayed permanently due and the same card came
    // back on every tap. "ignored" exits the SRS lane entirely — no
    // grade.
    if (status !== "ignored") {
      const grade =
        status === "known" ? "good" :
        status === "unknown" ? "again" :
        "hard";
      try { this.plugin.srs.applyGrade(surface, grade); } catch { /* best effort */ }
    }

    this.advancePastIfPresent(markedKey);
    this.triageContextCache.delete(surface);
    this.triageReveal = 0;
    this.triagePartialAxes = null;
    this.plugin.refreshChineseViews();
    this.render();
  }

  // ── Smart-story flashcards ─────────────────────────────────────────

  private renderFlashcardsSmart(root: HTMLElement) {
    const wrap = root.createDiv({ cls: "cci-fc-smart" });
    const settings = this.plugin.settings;

    // 1. AI gating.
    if (!settings.ai.enabled) {
      this.renderSmartDisabled(wrap, "AI provider is disabled. Enable it in Settings → AI provider, then come back.");
      return;
    }
    if (this.smartReady === null) {
      wrap.createEl("p", { cls: "cci-fc-smart-status", text: "Testing AI connection…" });
      void this.plugin.ai.testConnection().then((ok) => {
        this.smartReady = ok;
        this.render();
      }).catch(() => {
        this.smartReady = false;
        this.render();
      });
      return;
    }
    if (!this.smartReady) {
      this.renderSmartDisabled(wrap, "AI connection failed. Verify Settings → AI provider → Test connection.");
      return;
    }

    // 2. Params recap.
    const dueCount = this.plugin.srs.due().length;
    const params = wrap.createDiv({ cls: "cci-fc-smart-params" });
    params.createEl("h3", { text: "Smart story flashcards" });
    const list = params.createEl("ul");
    list.createEl("li", { text: `Due words today: ${dueCount} (story will use up to ${settings.story.defaultDueCount}).` });
    list.createEl("li", { text: `Target HSK level for filler vocabulary: ${settings.story.defaultStyle === "story" ? "auto" : "(see story settings)"}.` });
    list.createEl("li", { text: `Length: ~${settings.story.defaultLengthChars} characters.` });
    list.createEl("li", { text: `Known-coverage threshold: ${Math.round(settings.story.knownCoverageThreshold * 100)}%.` });
    list.createEl("li", { text: `Max repair iterations: ${settings.ai.maxRepairIterations}.` });

    // 3. Existing preview, if any.
    const previewPath = this.plugin.story.previewPath();
    const previewFile = this.plugin.app.vault.getAbstractFileByPath(previewPath);
    if (previewFile instanceof TFile) {
      if (this.currentPreview?.file.path === previewFile.path) {
        const preview = wrap.createDiv({ cls: "cci-fc-smart-preview" });
        preview.createEl("h4", { text: this.currentPreview.story.title || "Generated story" });
        const text = preview.createDiv({ cls: "cci-fc-smart-preview-text" });
        text.style.whiteSpace = "pre-wrap";
        text.setText(this.currentPreview.story.textChinese);
      }
      const row = wrap.createDiv({ cls: "cci-fc-smart-actions" });
      const open = row.createEl("button", { cls: "cci-triage-act is-known", text: "Open preview" });
      open.addEventListener("click", () => this.openInChineseView(previewFile));
      const save = row.createEl("button", { cls: "cci-triage-act is-partial", text: "Save as note" });
      save.addEventListener("click", async () => {
        await this.commitSavedPreview(previewFile);
      });
      const regen = row.createEl("button", {
        cls: "cci-triage-act is-known",
        text: this.smartGenerating ? "Generating…" : "Generate again",
      });
      if (this.smartGenerating) regen.setAttribute("disabled", "true");
      regen.addEventListener("click", () => this.runSmartGenerate(true));
      const discard = row.createEl("button", { cls: "cci-triage-act is-ignored", text: "Discard" });
      discard.addEventListener("click", async () => {
        try {
          await this.plugin.app.vault.delete(previewFile);
        } catch {}
        this.currentPreview = null;
        this.render();
      });
    } else {
      // 4. Initial Generate button.
      const row = wrap.createDiv({ cls: "cci-fc-smart-actions" });
      const btn = row.createEl("button", {
        cls: "cci-triage-act is-known",
        text: this.smartGenerating ? "Generating…" : "Generate story",
      });
      if (this.smartGenerating || dueCount === 0) btn.setAttribute("disabled", "true");
      if (dueCount === 0) {
        wrap.createEl("p", {
          cls: "cci-triage-empty",
          text: "No due words right now. Mark a few words via the popup, then come back.",
        });
      }
      btn.addEventListener("click", () => this.runSmartGenerate(false));
    }
  }

  private renderSmartDisabled(wrap: HTMLElement, msg: string) {
    const panel = wrap.createDiv({ cls: "cci-fc-smart-disabled" });
    panel.createEl("p", { text: msg });
  }

  private async runSmartGenerate(regen: boolean): Promise<void> {
    if (this.smartGenerating) return;
    this.smartGenerating = true;
    this.render();
    const settings = this.plugin.settings;
    const notice = new Notice("Generating Chinese story…", 0);
    try {
      // If regen, delete the old preview file first so the new write is
      // a fresh create (cleaner content cycling).
      const previewPath = this.plugin.story.previewPath();
      const existing = this.plugin.app.vault.getAbstractFileByPath(previewPath);
      if (regen && existing instanceof TFile) {
        try { await this.plugin.app.vault.delete(existing); } catch {}
      }
      const preview = await this.plugin.story.generatePreview({
        dueCount: settings.story.defaultDueCount,
        lengthChars: settings.story.defaultLengthChars,
        style: settings.story.defaultStyle,
        targetHsk: "auto",
        includeGlossary: settings.story.includeGlossary,
      });
      this.currentPreview = preview;
      notice.setMessage(
        `Story ready · score ${preview.score.toFixed(2)} · ${preview.iterations} repair pass(es).`
      );
      setTimeout(() => notice.hide(), 4000);
    } catch (err) {
      notice.setMessage("Story generation failed: " + (err as Error).message);
      setTimeout(() => notice.hide(), 6000);
    } finally {
      this.smartGenerating = false;
      this.render();
    }
  }

  private async commitSavedPreview(previewFile: TFile): Promise<void> {
    if (!this.currentPreview || this.currentPreview.file.path !== previewFile.path) {
      // Re-hydrate a minimal preview wrapper from the file alone.
      this.currentPreview = {
        story: { textChinese: "", title: "", glossary: [], targetWordsUsed: [] } as never,
        targets: [],
        targetHsk: "0",
        score: 0,
        file: previewFile,
        iterations: 0,
      };
    }
    try {
      const saved = await this.plugin.story.commitPreviewAsNote(this.currentPreview);
      new Notice(`Saved to ${saved.path}.`);
      this.currentPreview = null;
      this.render();
    } catch (err) {
      new Notice("Save failed: " + (err as Error).message);
    }
  }

  private async openInChineseView(file: TFile): Promise<void> {
    const leaf = this.plugin.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_CHINESE, state: { file: file.path } });
  }

  /**
   * Fetch one example sentence containing `surface` from a note the
   * record was seen in. Results are memoised per surface for the
   * lifetime of the StatsView so flipping between cards stays snappy.
   */
  private async loadTriageContext(
    rec: WordRecord
  ): Promise<{ sentence: string; matchStart: number; notePath: string } | null> {
    const key = rec.simplified ?? rec.surfaces[0] ?? rec.key;
    if (!key) return null;
    const cached = this.triageContextCache.get(key);
    if (cached) return JSON.parse(cached);
    const surfaces = [
      key,
      ...rec.surfaces.filter((s) => s && s !== key),
    ];
    const candidates = Object.entries(rec.notesSeenCounts ?? {})
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([p]) => p);
    for (const notePath of candidates) {
      const f = this.plugin.app.vault.getAbstractFileByPath(notePath);
      if (!(f instanceof TFile)) continue;
      let text: string;
      try {
        text = await this.plugin.app.vault.cachedRead(f);
      } catch {
        continue;
      }
      for (const surface of surfaces) {
        const idx = text.indexOf(surface);
        if (idx < 0) continue;
        const sentence = extractSentenceAround(text, idx);
        const matchStart = sentence.matchStart;
        const result = { sentence: sentence.text, matchStart, notePath };
        this.triageContextCache.set(key, JSON.stringify(result));
        return result;
      }
    }
    return null;
  }

  private statCard(parent: HTMLElement, label: string, value: string, hint: string, accent?: string) {
    const card = parent.createDiv({ cls: "cci-dash-card" });
    if (accent) card.addClass(accent);
    card.createDiv({ cls: "cci-dash-card-label", text: label });
    card.createDiv({ cls: "cci-dash-card-value", text: value });
    card.createDiv({ cls: "cci-dash-card-hint", text: hint });
  }

  // ── Words table ────────────────────────────────────────────────────

  private renderWords(root: HTMLElement) {
    const controls = root.createDiv({ cls: "cci-stats-controls" });

    const search = controls.createEl("input", { type: "search", placeholder: "Search…" });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value.toLowerCase();
      this.render();
    });

    const statusSel = controls.createEl("select");
    const statusOptions: [string, string][] = [
      ["all", "Status: all"],
      ["known", "Status: known"],
      ["partial", "Status: partial (any)"],
      ["unknown", "Status: unknown"],
      ["new", "Status: new"],
      ["ignored", "Status: ignored"],
    ];
    for (const [v, l] of statusOptions) {
      const o = statusSel.createEl("option", { text: l });
      o.value = v;
    }
    statusSel.value = this.statusFilter;
    statusSel.addEventListener("change", () => {
      this.statusFilter = statusSel.value as any;
      this.render();
    });

    const hskSel = controls.createEl("select");
    for (const v of ["all", "1", "2", "3", "4", "5", "6", "7+"]) {
      const o = hskSel.createEl("option", { text: v === "all" ? "HSK: all" : `HSK ${v}` });
      o.value = v;
    }
    hskSel.value = this.hskFilter;
    hskSel.addEventListener("change", () => {
      this.hskFilter = hskSel.value;
      this.render();
    });

    const sortSel = controls.createEl("select");
    const sortOptions: [SortKey, string][] = [
      ["seenCount", "Sort: seen"],
      ["lastSeenAt", "Sort: last seen"],
      ["dueAt", "Sort: due"],
      ["status", "Sort: status"],
      ["hsk", "Sort: HSK"],
    ];
    for (const [v, l] of sortOptions) {
      const o = sortSel.createEl("option", { text: l });
      o.value = v;
    }
    sortSel.value = this.sortKey;
    sortSel.addEventListener("change", () => {
      this.sortKey = sortSel.value as SortKey;
      this.render();
    });

    const sortDir = controls.createEl("button", { text: this.sortDesc ? "↓" : "↑" });
    sortDir.addEventListener("click", () => {
      this.sortDesc = !this.sortDesc;
      this.render();
    });

    const records = this.filterAndSort();
    const wrap = root.createDiv({ cls: "cci-stats-tablewrap" });
    const table = wrap.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    ["Word", "Pinyin", "Definition", "HSK", "Status", "Seen", "Last seen", "Due"].forEach((h) =>
      head.createEl("th", { text: h })
    );
    const body = table.createEl("tbody");
    const settings = this.plugin.settings;
    for (const r of records.slice(0, 500)) {
      const tr = body.createEl("tr");
      const c = colorClassKey(r, settings.colorMode, settings.hskSource);
      tr.addClass(`cci-row-color-${c}`);
      tr.createEl("td", { text: r.simplified ?? r.surfaces[0] });
      tr.createEl("td", { text: r.pinyin ?? "" });
      tr.createEl("td", { cls: "cci-stats-defcol", text: (r.definitions ?? []).slice(0, 1).join("; ") });
      tr.createEl("td", { text: (r.hsk?.levels ?? []).join("/") });
      const statusTd = tr.createEl("td", { text: r.status, cls: `cci-status-cell cci-color-${c}` });
      void statusTd;
      tr.createEl("td", { text: String(r.seenCount) });
      tr.createEl("td", { text: r.lastSeenAt ? r.lastSeenAt.slice(0, 10) : "—" });
      tr.createEl("td", { text: r.srs?.dueAt ? r.srs.dueAt.slice(0, 10) : "—" });
      tr.addEventListener("click", () => this.openDetail(r));
    }
    if (records.length === 0) {
      root.createEl("p", { text: "No words match this filter." });
    }
  }

  private filterAndSort(): WordRecord[] {
    let rows = this.scopedRecords();
    if (this.statusFilter !== "all") {
      if (this.statusFilter === "partial") {
        rows = rows.filter((r) => colorOf(r) === "partial");
      } else {
        rows = rows.filter((r) => r.status === this.statusFilter);
      }
    }
    if (this.hskFilter !== "all") {
      rows = rows.filter((r) => {
        const lvls = r.hsk?.levels ?? [];
        if (this.hskFilter === "7+") return lvls.some((l) => parseInt(l, 10) >= 7);
        return lvls.includes(this.hskFilter);
      });
    }
    if (this.query) {
      rows = rows.filter((r) => {
        const t = (r.simplified ?? "") + " " + (r.pinyin ?? "") + " " + (r.definitions ?? []).join(" ");
        return t.toLowerCase().includes(this.query);
      });
    }
    rows.sort((a, b) => {
      const av = sortValue(a, this.sortKey);
      const bv = sortValue(b, this.sortKey);
      if (av < bv) return this.sortDesc ? 1 : -1;
      if (av > bv) return this.sortDesc ? -1 : 1;
      return 0;
    });
    return rows;
  }

  private scopedRecords(): WordRecord[] {
    let rows = this.plugin.vocab.values();
    if (this.noteScope && this.noteSurfaces.size > 0) {
      rows = rows.filter((r) => this.noteSurfaces.has(r.simplified ?? r.surfaces[0]));
    }
    return rows;
  }

  private openDetail(r: WordRecord) {
    const root = this.containerEl.children[1] as HTMLElement;
    const modal = root.createDiv({ cls: "cci-popup" });
    modal.style.position = "fixed";
    modal.style.top = "10%";
    modal.style.left = "10%";
    modal.style.right = "10%";
    modal.style.bottom = "10%";
    modal.style.overflow = "auto";
    modal.createEl("h3", { text: `${r.simplified ?? r.surfaces[0]} (${r.pinyin ?? ""})` });
    modal.createEl("p", { text: (r.definitions ?? []).join("; ") });
    modal.createEl("p", { text: `Status: ${r.status} · HSK: ${(r.hsk?.levels ?? []).join("/")} · Seen: ${r.seenCount}` });
    if (r.mnemonic?.text) modal.createEl("p", { text: `🧠 ${r.mnemonic.text}` });
    const graph = modal.createDiv();
    renderDailyGraph(graph, r.dailySeenCounts);
    if (r.recentSeenAt.length) {
      const ul = modal.createEl("ul");
      for (const t of r.recentSeenAt.slice(-20).reverse()) ul.createEl("li", { text: t });
    }
    const close = modal.createEl("button", { text: "Close" });
    close.addEventListener("click", () => modal.remove());
  }
}

function sortValue(r: WordRecord, key: SortKey): number | string {
  switch (key) {
    case "seenCount":
      return r.seenCount;
    case "lastSeenAt":
      return r.lastSeenAt ?? "";
    case "dueAt":
      return r.srs?.dueAt ?? "";
    case "status":
      return r.status;
    case "hsk":
      return parseInt(r.hsk?.levels?.[0] ?? "0", 10);
  }
}

function bucketCounts(rows: WordRecord[]): {
  known: number;
  partial: number;
  unknown: number;
  new: number;
  ignored: number;
} {
  const out = { known: 0, partial: 0, unknown: 0, new: 0, ignored: 0 };
  for (const r of rows) {
    const c = colorOf(r);
    if (c === "known") out.known++;
    else if (c === "unknown") out.unknown++;
    else if (c === "partial") out.partial++;
    else if (c === "ignored") out.ignored++;
    else out.new++;
  }
  return out;
}

/**
 * Find the sentence containing `text[matchOffset]`. Sentence boundaries are
 * Chinese full-stop / exclamation / question marks plus their ASCII
 * equivalents and newlines. Returns the surrounding sentence and the
 * position of `matchOffset` within that sentence. Caps the slice to
 * 200 chars on each side so a punctuation-less paragraph does not blow
 * out the card.
 */
function extractSentenceAround(text: string, matchOffset: number): { text: string; matchStart: number } {
  const BOUNDARY = /[。！？!?；;\n\r…]/;
  const MAX_BACK = 200;
  const MAX_FWD = 200;
  let start = matchOffset;
  while (start > 0 && matchOffset - start < MAX_BACK && !BOUNDARY.test(text[start - 1])) {
    start--;
  }
  let end = matchOffset;
  while (end < text.length && end - matchOffset < MAX_FWD && !BOUNDARY.test(text[end])) {
    end++;
  }
  if (end < text.length && BOUNDARY.test(text[end])) end++; // include the closing punctuation
  const sentence = text.slice(start, end).trim();
  // Recompute matchStart against the (possibly trimmed) slice.
  const adjusted = text.slice(start, end);
  const trimLead = adjusted.length - adjusted.trimStart().length;
  return { text: sentence, matchStart: matchOffset - start - trimLead };
}

function estimateLearnerHsk(all: WordRecord[], threshold: number, excludeNew: boolean): string {
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
  let highest = 0;
  for (const [lvl, b] of byLevel) {
    if (b.total > 0 && b.known / b.total >= threshold && lvl > highest) highest = lvl;
  }
  return highest > 0 ? `HSK ${highest}` : "n/a";
}
