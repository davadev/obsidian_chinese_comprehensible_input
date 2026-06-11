import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type CciPlugin from "../main";
import { VIEW_TYPE_STATS } from "../constants";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { colorOf } from "../vocabulary/axes";
import { Bucket, bucketTimestamps, renderDailyGraph, renderProgressGraph } from "./StatsGraph";

type SortKey = "seenCount" | "lastSeenAt" | "dueAt" | "status" | "hsk";
type Tab = "dashboard" | "words" | "triage";

export class StatsView extends ItemView {
  private query = "";
  private statusFilter: WordStatus | "all" | "partial" = "all";
  private hskFilter = "all";
  private sortKey: SortKey = "seenCount";
  private sortDesc = true;
  private noteScope = "";
  private tab: Tab = "dashboard";
  private progressBucket: Bucket = "day";
  private progressWindow = { day: 30, week: 12, month: 12 } as const;
  private triageIndex = 0;
  private triageContextCache = new Map<string, string>();

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

  setScope(notePath: string): void {
    this.noteScope = notePath;
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
    else if (this.tab === "triage") this.renderTriage(root);
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
    scopeSel.addEventListener("change", () => {
      this.noteScope = scopeSel.value;
      this.render();
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
    mkTab("Triage", "triage");
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

    const estimated = estimateLearnerHsk(
      scoped,
      this.plugin.settings.story.knownCoverageThreshold,
      excludeNew
    );
    this.statCard(grid, "Comfort level", estimated, "Highest HSK level where known-coverage ≥ threshold.");

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

    // Per-note exposure breakdown.
    const notePaths = this.plugin.vocab.knownNotePaths();
    if (notePaths.length > 0 && !this.noteScope) {
      const wrap = root.createDiv({ cls: "cci-dash-notes" });
      wrap.createEl("h3", { text: "Per-note exposure" });
      const tbl = wrap.createEl("table", { cls: "cci-dash-notes-table" });
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
        noteTd.addEventListener("click", () => {
          this.noteScope = p;
          this.render();
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
    const sel = head.createEl("select", { cls: "cci-dash-progress-bucket" });
    for (const [v, l] of [["day", "Daily (30)"], ["week", "Weekly (12)"], ["month", "Monthly (12)"]] as [Bucket, string][]) {
      const o = sel.createEl("option", { text: l });
      o.value = v;
    }
    sel.value = this.progressBucket;
    sel.addEventListener("change", () => {
      this.progressBucket = sel.value as Bucket;
      this.render();
    });

    const trackedStamps = records.map((r) => r.firstSeenAt);
    const knownStamps = records.map((r) => r.knownAt);
    const n = this.progressWindow[this.progressBucket];
    const trackedSeries = bucketTimestamps(trackedStamps, this.progressBucket, n);
    const knownSeries = bucketTimestamps(knownStamps, this.progressBucket, n);

    const graphHost = wrap.createDiv({ cls: "cci-dash-progress-graph" });
    renderProgressGraph(graphHost, [
      { label: "Tracked added", color: "rgba(88, 166, 255, 0.85)", data: trackedSeries },
      { label: "Learned", color: "rgba(46, 160, 67, 0.85)", data: knownSeries },
    ]);

    const trackedRecent = trackedSeries.reduce((a, b) => a + b.count, 0);
    const knownRecent = knownSeries.reduce((a, b) => a + b.count, 0);
    const range =
      this.progressBucket === "day" ? "30 days" :
      this.progressBucket === "week" ? "12 weeks" : "12 months";
    wrap.createEl("p", {
      cls: "cci-dash-progress-summary",
      text: `Last ${range}: ${trackedRecent} tracked, ${knownRecent} learned.`,
    });
  }

  // ── Triage ──────────────────────────────────────────────────────────
  // Card UI: pick the most-frequent unclassified words and let the user
  // mark known/unknown/partial/ignore with one tap. The example sentence
  // is pulled from a note the word was actually seen in so the user can
  // judge from context.

  private renderTriage(root: HTMLElement) {
    const wrap = root.createDiv({ cls: "cci-triage" });
    const queue = this.scopedRecords()
      .filter((r) => r.status === "new")
      .sort((a, b) => (b.seenCount ?? 0) - (a.seenCount ?? 0));

    if (queue.length === 0) {
      wrap.createEl("p", {
        cls: "cci-triage-empty",
        text: "No unclassified words in this scope. Open a Chinese note (or run Reindex vault) to surface more.",
      });
      return;
    }

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
      this.render();
    });

    const card = wrap.createDiv({ cls: "cci-triage-card" });
    const surface = rec.simplified ?? rec.surfaces[0] ?? "";
    const headRow = card.createDiv({ cls: "cci-triage-headrow" });
    const headTerm = headRow.createDiv({ cls: "cci-triage-term" });
    headTerm.textContent = surface;
    const meta = headRow.createDiv({ cls: "cci-triage-meta" });
    if (rec.pinyin) meta.createDiv({ cls: "cci-triage-pinyin", text: rec.pinyin });
    const levelLine = `Seen ${rec.seenCount}× ${rec.hsk?.levels?.length ? `· HSK ${rec.hsk.levels[0]}` : ""}`;
    meta.createDiv({ cls: "cci-triage-stats", text: levelLine });

    if (rec.definitions && rec.definitions.length > 0) {
      const defs = card.createDiv({ cls: "cci-triage-defs" });
      defs.textContent = rec.definitions.slice(0, 2).join("; ");
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
    mkAct("? Partial", "is-partial", () => this.applyTriage(surface, "pinyinKnownMeaningUnknown"));
    mkAct("✗ Unknown", "is-unknown", () => this.applyTriage(surface, "unknown"));
    mkAct("Ignore", "is-ignored", () => this.applyTriage(surface, "ignored"));
  }

  private applyTriage(surface: string, status: WordStatus) {
    this.plugin.vocab.setStatus(surface, status);
    // Cleanup context cache for this word — it won't be re-shown.
    this.triageContextCache.delete(surface);
    this.plugin.refreshChineseViews();
    // Don't increment index; the filtered queue rebuilds on next render
    // and the next "new" word slots in at this position automatically.
    this.render();
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
    for (const r of records.slice(0, 500)) {
      const tr = body.createEl("tr");
      const c = colorOf(r);
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
    if (this.noteScope) {
      rows = rows.filter((r) => (r.notesSeenCounts ?? {})[this.noteScope] > 0);
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
