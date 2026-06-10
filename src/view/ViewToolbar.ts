import type CciPlugin from "../main";
import { DisplayMode, ViewMode } from "../settings/types";

export class ViewToolbar {
  private bannerEl: HTMLElement | null = null;

  constructor(private plugin: CciPlugin, private container: HTMLElement, private onChange: () => void) {
    this.render();
  }

  private render() {
    this.container.empty();
    this.container.addClass("cci-toolbar");

    const modeGroup = this.container.createDiv({ cls: "cci-group" });
    this.modeButton(modeGroup, "Read", "read");
    this.modeButton(modeGroup, "Edit", "edit");
    this.modeButton(modeGroup, "Mark known", "mark-known");
    this.modeButton(modeGroup, "Mark unknown", "mark-unknown");

    const dispGroup = this.container.createDiv({ cls: "cci-group" });
    const dispSelect = dispGroup.createEl("select");
    [
      ["two-line", "Two-line"],
      ["three-line", "Three-line"],
      ["popup-only", "Popup only"],
      ["color-only", "Color only"],
    ].forEach(([v, l]) => {
      const o = dispSelect.createEl("option", { text: l });
      o.value = v;
    });
    dispSelect.value = this.plugin.settings.defaultDisplayMode;
    dispSelect.addEventListener("change", async () => {
      this.plugin.settings.defaultDisplayMode = dispSelect.value as DisplayMode;
      await this.plugin.saveSettings();
      this.onChange();
    });

    const colorGroup = this.container.createDiv({ cls: "cci-group" });
    this.toggle(colorGroup, "Known", () => this.plugin.settings.showKnownColor, async (v) => {
      this.plugin.settings.showKnownColor = v;
      await this.plugin.saveSettings();
      this.onChange();
    });
    this.toggle(colorGroup, "Partial", () => this.plugin.settings.showPartialColor, async (v) => {
      this.plugin.settings.showPartialColor = v;
      await this.plugin.saveSettings();
      this.onChange();
    });
    this.toggle(colorGroup, "Unknown", () => this.plugin.settings.showUnknownColor, async (v) => {
      this.plugin.settings.showUnknownColor = v;
      await this.plugin.saveSettings();
      this.onChange();
    });

    const actionGroup = this.container.createDiv({ cls: "cci-group" });
    const stats = actionGroup.createEl("button", { text: "Stats" });
    stats.addEventListener("click", () => this.plugin.openStatsView());
    const story = actionGroup.createEl("button", { text: "Generate story" });
    story.addEventListener("click", () => this.plugin.openGenerateStoryModal());

    this.updateBanner();
  }

  refresh(): void {
    this.render();
  }

  private modeButton(parent: HTMLElement, label: string, mode: ViewMode): void {
    const b = parent.createEl("button", { text: label });
    if (this.plugin.activeViewMode() === mode) b.addClass("is-active");
    b.addEventListener("click", () => {
      this.plugin.setActiveViewMode(mode);
      this.refresh();
    });
  }

  private toggle(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => Promise<void>) {
    const b = parent.createEl("button", { text: label });
    if (get()) b.addClass("is-active");
    b.addEventListener("click", async () => {
      await set(!get());
      b.toggleClass("is-active", get());
    });
  }

  private updateBanner() {
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
    const mode = this.plugin.activeViewMode();
    if (mode === "mark-known") {
      this.bannerEl = this.container.createDiv({
        cls: "cci-banner is-known",
        text: "Mark known mode — tap words to mark known. Click ✕ to exit.",
      });
      this.bannerEl.createEl("button", { text: "✕ Exit" }).addEventListener("click", () => {
        this.plugin.setActiveViewMode("read");
        this.refresh();
      });
    } else if (mode === "mark-unknown") {
      this.bannerEl = this.container.createDiv({
        cls: "cci-banner is-unknown",
        text: "Mark unknown mode — tap words to mark unknown. Click ✕ to exit.",
      });
      this.bannerEl.createEl("button", { text: "✕ Exit" }).addEventListener("click", () => {
        this.plugin.setActiveViewMode("read");
        this.refresh();
      });
    }
  }
}
