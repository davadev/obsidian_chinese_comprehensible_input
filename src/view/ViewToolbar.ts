import { setIcon } from "obsidian";
import type CciPlugin from "../main";
import { DisplayMode, ViewMode } from "../settings/types";

/**
 * Compact toolbar.
 *   Row 1: Edit | Known | Unknown | Partial | display select | overflow menu
 *   Row 2 (always present, may be empty): active-mode banner. Reserved
 *   height so toggling marking mode does not shift editor scroll position.
 */
export class ViewToolbar {
  private bannerEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private getDocText: () => string;

  constructor(
    private plugin: CciPlugin,
    private container: HTMLElement,
    private onChange: () => void,
    getDocText?: () => string
  ) {
    this.getDocText = getDocText ?? (() => "");
    this.render();
  }

  refresh(): void {
    this.updateActiveStates();
    this.updateBanner();
    this.updateBadge();
  }

  private render() {
    this.container.empty();
    this.container.addClass("cci-toolbar", "cci-toolbar-compact");

    const row = this.container.createDiv({ cls: "cci-toolbar-row" });

    this.modeBtn(row, "pencil", "Edit", "edit");
    this.modeBtn(row, "check-circle-2", "Known", "mark-known");
    this.modeBtn(row, "x-circle", "Unknown", "mark-unknown");
    this.modeBtn(row, "circle-help", "Partial", "mark-partial");

    const sel = row.createEl("select", { cls: "cci-display-sel" });
    [
      ["two-line", "2-line"],
      ["three-line", "3-line"],
      ["popup-only", "Popup"],
      ["color-only", "Color"],
    ].forEach(([v, l]) => {
      const o = sel.createEl("option", { text: l });
      o.value = v;
    });
    sel.value = this.plugin.settings.defaultDisplayMode;
    sel.addEventListener("change", async () => {
      this.plugin.settings.defaultDisplayMode = sel.value as DisplayMode;
      await this.plugin.saveSettings();
      this.onChange();
    });

    const overflow = row.createEl("button", {
      cls: "cci-icon-btn cci-overflow-btn-trigger",
      attr: { "aria-label": "More" },
    });
    setIcon(overflow, "more-horizontal");

    this.badgeEl = row.createDiv({
      cls: "cci-known-badge",
      attr: { title: "Words in this note that you know — tap for stats" },
    });
    this.badgeEl.textContent = "—";
    this.badgeEl.addEventListener("click", () => this.plugin.openStatsView());
    this.updateBadge();
    let menu: HTMLElement | null = null;
    overflow.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu) {
        menu.remove();
        menu = null;
        return;
      }
      menu = this.buildOverflowMenu(overflow);
    });

    // Reserved slot so toolbar height is constant whether or not a banner is active.
    this.bannerEl = this.container.createDiv({ cls: "cci-banner-slot" });
    this.updateBanner();
  }

  private modeBtn(parent: HTMLElement, icon: string, label: string, mode: ViewMode) {
    const b = parent.createEl("button", {
      cls: "cci-icon-btn",
      attr: { "aria-label": label, title: label, "data-mode": mode },
    });
    setIcon(b, icon);
    if (this.plugin.activeViewMode() === mode) b.addClass("is-active");
    b.addEventListener("click", () => {
      const cur = this.plugin.activeViewMode();
      this.plugin.setActiveViewMode(cur === mode ? "read" : mode);
      this.refresh();
    });
  }

  private updateActiveStates() {
    const cur = this.plugin.activeViewMode();
    const btns = this.container.querySelectorAll<HTMLButtonElement>(".cci-icon-btn[data-mode]");
    btns.forEach((b) => {
      const m = b.getAttribute("data-mode");
      b.toggleClass("is-active", m === cur);
    });
  }

  private async updateBadge() {
    if (!this.badgeEl) return;
    const text = this.getDocText();
    if (!text) {
      this.badgeEl.textContent = "—";
      this.badgeEl.setAttribute("data-state", "empty");
      return;
    }
    try {
      const s = await this.plugin.computeNoteStats(text);
      if (!this.badgeEl) return;
      if (s.total === 0) {
        this.badgeEl.textContent = "—";
        this.badgeEl.setAttribute("data-state", "empty");
        return;
      }
      const pct = Math.round((s.known / s.total) * 100);
      this.badgeEl.textContent = `${pct}%`;
      this.badgeEl.setAttribute(
        "title",
        `${pct}% of ${s.total} words known · partial ${s.partial} · unknown ${s.unknown} · new ${s.newCount}`
      );
      this.badgeEl.setAttribute(
        "data-state",
        pct >= 80 ? "high" : pct >= 50 ? "mid" : "low"
      );
    } catch {
      // Tokenizer not ready yet — leave placeholder.
    }
  }

  private updateBanner() {
    if (!this.bannerEl) return;
    this.bannerEl.empty();
    const mode = this.plugin.activeViewMode();
    if (mode === "read" || mode === "edit") return;
    const cls =
      mode === "mark-known" ? "is-known" : mode === "mark-unknown" ? "is-unknown" : "is-partial";
    const label =
      mode === "mark-known"
        ? "Marking KNOWN — tap a word"
        : mode === "mark-unknown"
        ? "Marking UNKNOWN — tap a word"
        : "Marking PARTIAL — tap a word to open the checkboxes";
    const banner = this.bannerEl.createDiv({ cls: `cci-banner ${cls}` });
    banner.createSpan({ text: label });
    const exit = banner.createEl("button", { text: "Exit" });
    exit.addEventListener("click", () => {
      this.plugin.setActiveViewMode("read");
      this.refresh();
    });
  }

  private buildOverflowMenu(anchor: HTMLElement): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "cci-overflow-menu";
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;

    const checkRow = (label: string, get: () => boolean, set: (v: boolean) => Promise<void>) => {
      const item = menu.createDiv({ cls: "cci-overflow-item" });
      const cb = item.createEl("input", { type: "checkbox" });
      cb.checked = get();
      item.createSpan({ text: label });
      cb.addEventListener("change", async () => {
        await set(cb.checked);
        this.onChange();
      });
      item.addEventListener("click", (ev) => {
        if (ev.target !== cb) cb.click();
      });
    };

    checkRow("Color known", () => this.plugin.settings.showKnownColor, async (v) => {
      this.plugin.settings.showKnownColor = v;
      await this.plugin.saveSettings();
    });
    checkRow("Color partial", () => this.plugin.settings.showPartialColor, async (v) => {
      this.plugin.settings.showPartialColor = v;
      await this.plugin.saveSettings();
    });
    checkRow("Color unknown", () => this.plugin.settings.showUnknownColor, async (v) => {
      this.plugin.settings.showUnknownColor = v;
      await this.plugin.saveSettings();
    });
    checkRow("Known-word popups", () => this.plugin.settings.knownWordPopups, async (v) => {
      this.plugin.settings.knownWordPopups = v;
      await this.plugin.saveSettings();
    });

    const sep1 = menu.createDiv({ cls: "cci-overflow-sep" });
    sep1.setAttr("role", "separator");

    const fontRow = menu.createDiv({ cls: "cci-overflow-item cci-overflow-slider" });
    fontRow.createSpan({ text: "Font size" });
    const slider = fontRow.createEl("input", { type: "range" });
    slider.min = "14";
    slider.max = "40";
    slider.step = "1";
    slider.value = String(this.plugin.settings.readerFontPx ?? 22);
    const sizeLabel = fontRow.createSpan({ cls: "cci-slider-value", text: `${slider.value}px` });
    slider.addEventListener("input", async () => {
      const px = parseInt(slider.value, 10);
      this.plugin.settings.readerFontPx = px;
      sizeLabel.setText(`${px}px`);
      await this.plugin.saveSettings();
      this.onChange();
    });

    const sep2 = menu.createDiv({ cls: "cci-overflow-sep" });
    sep2.setAttr("role", "separator");

    const stats = menu.createEl("button", { cls: "cci-overflow-btn", text: "Stats" });
    stats.addEventListener("click", () => {
      menu.remove();
      this.plugin.openStatsView();
    });
    const story = menu.createEl("button", { cls: "cci-overflow-btn", text: "Generate story" });
    story.addEventListener("click", () => {
      menu.remove();
      this.plugin.openGenerateStoryModal();
    });

    const off = (e: MouseEvent) => {
      if (e.target instanceof Node && menu.contains(e.target)) return;
      menu.remove();
      document.removeEventListener("click", off);
    };
    setTimeout(() => document.addEventListener("click", off), 0);
    return menu;
  }
}
