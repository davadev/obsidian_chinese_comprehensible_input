import { setIcon } from "obsidian";
import type CciPlugin from "../main";
import { DisplayMode, ViewMode } from "../settings/types";

/**
 * Compact, single-row toolbar.
 *  - Read mode is the implicit default; no button for it. Edit / Mark known /
 *    Mark unknown are toggles — all off = Read mode.
 *  - Display mode is a single select.
 *  - Color toggles + stats + generate are an overflow menu opened by `⋯`.
 *  - The active-marking banner sits below the row.
 */
export class ViewToolbar {
  private bannerEl: HTMLElement | null = null;

  constructor(
    private plugin: CciPlugin,
    private container: HTMLElement,
    private onChange: () => void
  ) {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render() {
    this.container.empty();
    this.container.addClass("cci-toolbar", "cci-toolbar-compact");

    const row = this.container.createDiv({ cls: "cci-toolbar-row" });

    this.iconToggle(row, "pencil", "Edit", () => this.plugin.activeViewMode() === "edit", () =>
      this.toggleMode("edit")
    );
    this.iconToggle(row, "check-circle-2", "Mark known", () => this.plugin.activeViewMode() === "mark-known", () =>
      this.toggleMode("mark-known")
    );
    this.iconToggle(row, "circle-help", "Mark unknown", () => this.plugin.activeViewMode() === "mark-unknown", () =>
      this.toggleMode("mark-unknown")
    );

    // Display mode select
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

    // Overflow menu trigger
    const overflow = row.createEl("button", { cls: "cci-icon-btn", attr: { "aria-label": "More" } });
    setIcon(overflow, "more-horizontal");
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

    this.updateBanner();
  }

  private toggleMode(m: ViewMode) {
    const cur = this.plugin.activeViewMode();
    this.plugin.setActiveViewMode(cur === m ? "read" : m);
    this.refresh();
  }

  private iconToggle(
    parent: HTMLElement,
    icon: string,
    label: string,
    get: () => boolean,
    onClick: () => void
  ) {
    const b = parent.createEl("button", { cls: "cci-icon-btn", attr: { "aria-label": label, title: label } });
    setIcon(b, icon);
    if (get()) b.addClass("is-active");
    b.addEventListener("click", onClick);
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

  private updateBanner() {
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
    const mode = this.plugin.activeViewMode();
    if (mode === "mark-known" || mode === "mark-unknown") {
      const cls = mode === "mark-known" ? "is-known" : "is-unknown";
      const label = mode === "mark-known" ? "Marking KNOWN — tap a word" : "Marking UNKNOWN — tap a word";
      this.bannerEl = this.container.createDiv({ cls: `cci-banner ${cls}` });
      this.bannerEl.createSpan({ text: label });
      const exit = this.bannerEl.createEl("button", { text: "Exit" });
      exit.addEventListener("click", () => {
        this.plugin.setActiveViewMode("read");
        this.refresh();
      });
    }
  }
}
