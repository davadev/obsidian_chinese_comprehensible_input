import { ItemView, WorkspaceLeaf } from "obsidian";
import type CciPlugin from "../main";
import { VIEW_TYPE_STATS } from "../constants";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { colorOf } from "../vocabulary/axes";
import { renderDailyGraph } from "./StatsGraph";

type SortKey = "seenCount" | "lastSeenAt" | "dueAt" | "status" | "hsk";
type Tab = "dashboard" | "words";

export class StatsView extends ItemView {
  private query = "";
  private statusFilter: WordStatus | "all" | "partial" = "all";
  private hskFilter = "all";
  private sortKey: SortKey = "seenCount";
  private sortDesc = true;
  private noteScope = "";
  private tab: Tab = "dashboard";

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
    mkTab("Words", "words");
  }

  // ── Dashboard ──────────────────────────────────────────────────────

  private renderDashboard(root: HTMLElement) {
    const scoped = this.scopedRecords();
    const counts = bucketCounts(scoped);
    const total = scoped.length;
    const totalActive = total - counts.ignored;
    const pct = (n: number) => (totalActive ? Math.round((n / totalActive) * 100) : 0);

    const grid = root.createDiv({ cls: "cci-dash-grid" });
    this.statCard(grid, "Tracked", String(total), "Words this plugin has recorded.");
    this.statCard(grid, "Known", `${counts.known} · ${pct(counts.known)}%`, "All three axes ticked.", "cci-color-known");
    this.statCard(grid, "Partial", `${counts.partial} · ${pct(counts.partial)}%`, "Some axes ticked.", "cci-color-partial");
    this.statCard(grid, "Unknown", `${counts.unknown} · ${pct(counts.unknown)}%`, "No axes ticked.", "cci-color-unknown");
    this.statCard(grid, "New", `${counts.new}`, "Seen but not classified yet.", "cci-color-new");
    this.statCard(grid, "Ignored", `${counts.ignored}`, "Excluded from review.");

    const estimated = estimateLearnerHsk(scoped, this.plugin.settings.story.knownCoverageThreshold);
    this.statCard(grid, "Comfort level", estimated, "Highest HSK level where known-coverage ≥ threshold.");

    if (!this.noteScope) {
      // Global %: known / all words tracked across vocabulary.
      const globalPct = totalActive ? Math.round((counts.known / totalActive) * 100) : 0;
      this.statCard(grid, "Overall known", `${globalPct}%`, "Known out of all words this plugin has tracked across notes.");
    }

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
        const active = recs.length - c.ignored;
        const pctKnown = active ? Math.round((c.known / active) * 100) : 0;
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

function estimateLearnerHsk(all: WordRecord[], threshold: number): string {
  const byLevel = new Map<number, { total: number; known: number }>();
  for (const r of all) {
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
