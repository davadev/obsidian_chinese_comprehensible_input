import { ItemView, WorkspaceLeaf } from "obsidian";
import type CciPlugin from "../main";
import { VIEW_TYPE_STATS } from "../constants";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";
import { renderDailyGraph } from "./StatsGraph";

type SortKey = "seenCount" | "lastSeenAt" | "dueAt" | "status" | "hsk";

export class StatsView extends ItemView {
  private query = "";
  private statusFilter: WordStatus | "all" = "all";
  private hskFilter = "all";
  private sortKey: SortKey = "seenCount";
  private sortDesc = true;

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

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.containerEl.children[1].addClass("cci-stats");
    this.render();
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();

    const header = root.createDiv({ cls: "cci-stats-header" });
    const back = header.createEl("button", { cls: "cci-stats-back", text: "← Back" });
    back.addEventListener("click", () => {
      this.leaf.detach();
    });
    header.createEl("h2", { text: "Vocabulary stats", cls: "cci-stats-title" });

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
      ["new", "Status: new"],
      ["known", "Status: known"],
      ["unknown", "Status: unknown"],
      ["meaningKnownPinyinUnknown", "Status: meaning ✓ / pinyin ?"],
      ["pinyinKnownMeaningUnknown", "Status: pinyin ✓ / meaning ?"],
      ["charactersUnknown", "Status: spoken ✓ / chars ?"],
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

    const sortDir = controls.createEl("button", { text: this.sortDesc ? "↓" : "↑", attr: { "aria-label": "Toggle sort direction" } });
    sortDir.addEventListener("click", () => {
      this.sortDesc = !this.sortDesc;
      this.render();
    });

    this.renderSummary(root);

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
      tr.createEl("td", { text: r.simplified ?? r.surfaces[0] });
      tr.createEl("td", { text: r.pinyin ?? "" });
      tr.createEl("td", { cls: "cci-stats-defcol", text: (r.definitions ?? []).slice(0, 1).join("; ") });
      tr.createEl("td", { text: (r.hsk?.levels ?? []).join("/") });
      tr.createEl("td", { text: r.status });
      tr.createEl("td", { text: String(r.seenCount) });
      tr.createEl("td", { text: r.lastSeenAt ? r.lastSeenAt.slice(0, 10) : "—" });
      tr.createEl("td", { text: r.srs?.dueAt ? r.srs.dueAt.slice(0, 10) : "—" });
      tr.addEventListener("click", () => this.openDetail(r));
    }
    if (records.length === 0) {
      root.createEl("p", { text: "No words yet. Open a Chinese note in the Chinese Learning view to start." });
    }
  }

  private filterAndSort(): WordRecord[] {
    let rows = this.plugin.vocab.values();
    if (this.statusFilter !== "all") rows = rows.filter((r) => r.status === this.statusFilter);
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

  private renderSummary(root: HTMLElement) {
    const all = this.plugin.vocab.values();
    const counts = {
      known: 0,
      unknown: 0,
      partial: 0,
      new: 0,
      ignored: 0,
    };
    for (const r of all) {
      if (r.status === "known") counts.known++;
      else if (r.status === "unknown") counts.unknown++;
      else if (r.status === "meaningKnownPinyinUnknown" || r.status === "pinyinKnownMeaningUnknown") counts.partial++;
      else if (r.status === "ignored") counts.ignored++;
      else counts.new++;
    }
    const estimated = estimateLearnerHsk(all, this.plugin.settings.story.knownCoverageThreshold);
    const p = root.createEl("p", { cls: "cci-stats-summary" });
    p.textContent = `Tracked: ${all.length} · known: ${counts.known} · unknown: ${counts.unknown} · partial: ${counts.partial} · new: ${counts.new} · ignored: ${counts.ignored} · est. comfort: ${estimated}`;
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
