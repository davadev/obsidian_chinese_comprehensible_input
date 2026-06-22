import { Platform, setIcon } from "obsidian";
import type CciPlugin from "../main";
import { ColorMode, DisplayMode, ViewMode } from "../settings/types";
import { conflictDisabled } from "../editor/formatApply";
import { orderedFormatOptions } from "../editor/formatOptions";

/**
 * Compact toolbar.
 *   Row 1: Edit | Known | Unknown | Partial | display select | overflow menu
 *   Row 2 (always present, may be empty): active-mode banner. Reserved
 *   height so toggling marking mode does not shift editor scroll position.
 */
export class ViewToolbar {
  private bannerEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private formatLabelEl: HTMLElement | null = null;
  private getDocText: () => string;

  constructor(
    private plugin: CciPlugin,
    private container: HTMLElement,
    private onChange: () => void,
    getDocText?: () => string,
    private onCommitCustomWord?: (surface: string) => void
  ) {
    this.getDocText = getDocText ?? (() => "");
    this.render();
  }

  refresh(): void {
    this.updateActiveStates();
    this.updateBanner();
    void this.updateBadge();
  }

  private render() {
    this.container.empty();
    this.container.addClass("cci-toolbar", "cci-toolbar-compact");

    const row = this.container.createDiv({ cls: "cci-toolbar-row" });

    // Desktop keeps the in-place edit toggle. On mobile the header action
    // (added in ChineseTextFileView via addAction) is the entry point — no
    // toolbar Edit button on mobile.
    if (!Platform.isMobile) {
      this.modeBtn(row, "pencil", "Edit", "edit");
    }
    this.modeBtn(row, "check-circle-2", "Known", "mark-known");
    this.modeBtn(row, "x-circle", "Unknown", "mark-unknown");
    this.modeBtn(row, "circle-help", "Partial", "mark-partial");

    if (this.onCommitCustomWord) {
      this.modeBtn(row, "square-plus", "Add custom word (tap chars)", "select-word");
    }

    this.modeBtn(row, "highlighter", "Format (tap start + end word)", "format");

    this.colorModeSwitch(row);

    const overflow = row.createEl("button", {
      cls: "clickable-icon cci-icon-btn cci-overflow-btn-trigger",
      attr: { "aria-label": "More", title: "More" },
    });
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

    // Reserved slot: active marking banner, otherwise note vocabulary stats.
    this.bannerEl = this.container.createDiv({ cls: "cci-banner-slot" });
    this.updateBanner();
  }

  private modeBtn(parent: HTMLElement, icon: string, label: string, mode: ViewMode) {
    const b = parent.createEl("button", {
      cls: "clickable-icon cci-icon-btn",
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

  /**
   * Two-pill segmented switch. Both labels visible so the user always
   * sees the alternative. Active pill highlighted with the Obsidian
   * accent treatment used by marking buttons.
   */
  private colorModeSwitch(parent: HTMLElement): void {
    const wrap = parent.createDiv({
      cls: "cci-color-mode-switch",
      attr: { role: "tablist", "aria-label": "Color mode" },
    });

    const pills: Array<{ value: ColorMode; label: string; el: HTMLButtonElement }> = [];
    const make = (value: ColorMode, label: string) => {
      const el = wrap.createEl("button", {
        cls: "cci-color-mode-pill",
        text: label,
        attr: {
          role: "tab",
          "aria-pressed": String(this.plugin.settings.colorMode === value),
          "data-color-mode": value,
          title: `Color by ${label}`,
        },
      });
      if (this.plugin.settings.colorMode === value) el.addClass("is-active");
      el.addEventListener("click", () => {
        void (async () => {
        if (this.plugin.settings.colorMode === value) return;
        this.plugin.settings.colorMode = value;
        await this.plugin.saveSettings();
        for (const p of pills) {
          const active = p.value === value;
          p.el.toggleClass("is-active", active);
          p.el.setAttribute("aria-pressed", String(active));
        }
        this.onChange();
        })();
      });
      pills.push({ value, label, el });
    };
    make("status", "Status");
    make("hsk", "HSK");
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
    if (!this.statsEl) return;
    const text = this.getDocText();
    if (!text) {
      this.statsEl.textContent = "No Chinese words in this note";
      this.statsEl.setAttribute("data-state", "empty");
      return;
    }
    try {
      const s = await this.plugin.computeNoteStats(text);
      if (!this.statsEl) return;
      if (s.total === 0) {
        this.statsEl.textContent = "No Chinese words in this note";
        this.statsEl.setAttribute("data-state", "empty");
        return;
      }
      const pct = (n: number) => Math.round((n / s.total) * 100);
      const knownPct = pct(s.known);
      this.statsEl.textContent = `Known ${knownPct}% · Partial ${pct(s.partial)}% · Unknown ${pct(s.unknown)}% · New ${pct(s.newCount)}%${s.topHsk ? ` · Top HSK ${s.topHsk}` : ""}`;
      this.statsEl.setAttribute(
        "title",
        `${knownPct}% of ${s.total} words known · partial ${s.partial} · unknown ${s.unknown} · new ${s.newCount}${s.topHsk ? ` · top HSK ${s.topHsk}` : ""}`
      );
      this.statsEl.setAttribute(
        "data-state",
        knownPct >= 80 ? "high" : knownPct >= 50 ? "mid" : "low"
      );
    } catch {
      // Tokenizer not ready yet — leave placeholder.
    }
  }

  private updateBanner() {
    if (!this.bannerEl) return;
    this.bannerEl.empty();
    const mode = this.plugin.activeViewMode();
    this.statsEl = null;
    if (mode === "read" || mode === "edit") {
      this.statsEl = this.bannerEl.createDiv({
        cls: "cci-note-stats-row",
        attr: { title: "Words in this note — tap for stats" },
      });
      this.statsEl.textContent = "Loading note stats...";
      this.statsEl.addEventListener("click", () => {
        void this.plugin.openStatsForNote(this.plugin.currentNoteKey());
      });
      void this.updateBadge();
      return;
    }
    if (mode === "select-word") {
      const banner = this.bannerEl.createDiv({ cls: "cci-banner is-select-word" });
      const surface = this.plugin.pendingCustomSurface;
      const label = surface
        ? `Selected: ${surface}`
        : "Tap one or more characters to build a custom word";
      banner.createSpan({ text: label });
      const create = banner.createEl("button", { text: "Create entry" });
      create.disabled = !surface;
      create.addEventListener("click", () => {
        const s = this.plugin.pendingCustomSurface;
        if (!s) return;
        this.onCommitCustomWord?.(s);
        this.plugin.setActiveViewMode("read");
        this.refresh();
      });
      const exit = banner.createEl("button", { text: "Cancel" });
      exit.addEventListener("click", () => {
        this.plugin.setActiveViewMode("read");
        this.refresh();
      });
      return;
    }
    if (mode === "format") {
      this.renderFormatBanner();
      return;
    }
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

  private formatLabel(id: string): string {
    const opt = orderedFormatOptions(this.plugin.app, this.plugin.settings, true).find(
      (o) => o.id === id
    );
    return opt?.label ?? id;
  }

  private formatBannerText(): string {
    const enabled = this.plugin.settings.enabledFormats;
    const reverse = this.plugin.settings.formatReverseMode;
    const pending = this.plugin.pendingFormatStart != null;
    const verb =
      enabled.length === 0
        ? "remove all formatting"
        : reverse
        ? "remove the selected formatting"
        : "add formatting";
    // After the first tap, confirm WHICH start was registered so the user knows
    // it took (no end preview — that would add a delay).
    if (pending) {
      const s = (this.plugin.pendingFormatStartSurface ?? "").trim();
      const startNote = s ? `Start “${s}” selected` : "Start selected";
      return `${startNote} — tap the end word to ${verb}`;
    }
    if (enabled.length === 0) {
      return `Formatting (clear) — tap start word, then end word to ${verb}`;
    }
    const names = enabled.map((f) => this.formatLabel(f)).join(", ");
    return `Formatting (${names}) — tap start word, then end word to ${verb}`;
  }

  private renderFormatBanner() {
    if (!this.bannerEl) return;
    const banner = this.bannerEl.createDiv({ cls: "cci-banner is-format" });
    this.formatLabelEl = banner.createSpan({ text: this.formatBannerText() });

    const formatsBtn = banner.createEl("button", { text: "Formats ▾" });
    let menu: HTMLElement | null = null;
    formatsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu) {
        menu.remove();
        menu = null;
        return;
      }
      menu = this.buildFormatMenu(formatsBtn, () => {
        menu = null;
      });
    });

    const exit = banner.createEl("button", { text: "Exit" });
    exit.addEventListener("click", () => {
      this.plugin.setActiveViewMode("read");
      this.refresh();
    });
  }

  private buildFormatMenu(anchor: HTMLElement, onClose: () => void): HTMLElement {
    const menu = activeDocument.createElement("div");
    menu.className = "cci-overflow-menu";
    activeDocument.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(8, r.left)}px`;

    const close = () => {
      menu.remove();
      activeDocument.removeEventListener("click", onDocClick, true);
      onClose();
    };
    const onDocClick = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node) && ev.target !== anchor) close();
    };
    // Defer so the opening click doesn't immediately close it.
    window.setTimeout(() => activeDocument.addEventListener("click", onDocClick, true), 0);

    // Rebuild the rows in place after each toggle so conflict states refresh
    // without destroying the menu (which would detach the anchor and reposition
    // the popup at the top-left corner).
    const populate = () => {
      menu.empty();

      // Add / reverse-mode toggle at the top.
      const reverse = this.plugin.settings.formatReverseMode;
      const modeItem = menu.createDiv({ cls: "cci-overflow-item" });
      const modeCb = modeItem.createEl("input", { type: "checkbox" });
      modeCb.checked = reverse;
      modeItem.createSpan({ text: "Reverse mode (remove selected)" });
      const toggleMode = () => {
        void (async () => {
          this.plugin.settings.formatReverseMode = modeCb.checked;
          await this.plugin.saveSettings();
          populate();
          if (this.formatLabelEl) this.formatLabelEl.setText(this.formatBannerText());
        })();
      };
      modeCb.addEventListener("change", toggleMode);
      modeItem.addEventListener("click", (ev) => {
        if (ev.target !== modeCb) {
          modeCb.checked = !modeCb.checked;
          toggleMode();
        }
      });

      const hint = menu.createDiv({ cls: "cci-overflow-hint" });
      hint.setText(reverse ? "Formats to remove" : "Formats to apply (none = remove)");

      const options = orderedFormatOptions(this.plugin.app, this.plugin.settings, false);
      for (const opt of options) {
        const id = opt.id;
        const enabled = this.plugin.settings.enabledFormats;
        const item = menu.createDiv({ cls: "cci-overflow-item" });
        const cb = item.createEl("input", { type: "checkbox" });
        cb.checked = enabled.includes(id);
        // No conflict gating in reverse mode — you can remove several at once.
        cb.disabled = reverse ? false : conflictDisabled(id, enabled);
        if (opt.color) {
          const sw = item.createSpan({ cls: "cci-format-swatch" });
          sw.style.background = opt.color;
        }
        item.createSpan({ text: opt.label });
        if (cb.disabled) item.addClass("is-disabled");
        const toggle = () => {
          if (cb.disabled) return;
          void (async () => {
            const cur = this.plugin.settings.enabledFormats;
            this.plugin.settings.enabledFormats = cb.checked
              ? [...cur, id]
              : cur.filter((f) => f !== id);
            await this.plugin.saveSettings();
            populate();
            if (this.formatLabelEl) this.formatLabelEl.setText(this.formatBannerText());
          })();
        };
        cb.addEventListener("change", toggle);
        item.addEventListener("click", (ev) => {
          if (ev.target !== cb && !cb.disabled) {
            cb.checked = !cb.checked;
            toggle();
          }
        });
      }
    };
    populate();
    return menu;
  }

  private buildOverflowMenu(anchor: HTMLElement): HTMLElement {
    const menu = activeDocument.createElement("div");
    menu.className = "cci-overflow-menu";
    activeDocument.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;

    const checkRow = (label: string, get: () => boolean, set: (v: boolean) => Promise<void>) => {
      const item = menu.createDiv({ cls: "cci-overflow-item" });
      const cb = item.createEl("input", { type: "checkbox" });
      cb.checked = get();
      item.createSpan({ text: label });
      cb.addEventListener("change", () => {
        void (async () => {
          await set(cb.checked);
          this.onChange();
        })();
      });
      item.addEventListener("click", (ev) => {
        if (ev.target !== cb) cb.click();
      });
    };

    const hint = menu.createDiv({ cls: "cci-overflow-hint" });
    hint.setText(
      this.plugin.settings.colorMode === "hsk"
        ? "Show / hide HSK levels"
        : "Show / hide status colors"
    );
    if (this.plugin.settings.colorMode === "hsk") {
      const levels: Array<keyof typeof this.plugin.settings.showHskColors> = [
        "1", "2", "3", "4", "5", "6", "7",
      ];
      for (const lvl of levels) {
        checkRow(
          `HSK ${lvl}`,
          () => this.plugin.settings.showHskColors[lvl],
          async (v) => {
            this.plugin.settings.showHskColors[lvl] = v;
            await this.plugin.saveSettings();
          }
        );
      }
    } else {
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
      checkRow("Color new (untracked)", () => this.plugin.settings.showNewColor, async (v) => {
        this.plugin.settings.showNewColor = v;
        await this.plugin.saveSettings();
      });
    }

    const sep0 = menu.createDiv({ cls: "cci-overflow-sep" });
    sep0.setAttr("role", "separator");

    const displayHint = menu.createDiv({ cls: "cci-overflow-hint" });
    displayHint.setText("Display mode");
    const radioRow = (label: string, value: DisplayMode) => {
      const item = menu.createDiv({ cls: "cci-overflow-item" });
      const cb = item.createEl("input", { type: "radio" });
      cb.name = "cci-display-mode";
      cb.checked = this.plugin.settings.defaultDisplayMode === value;
      item.createSpan({ text: label });
      cb.addEventListener("change", () => {
        void (async () => {
          if (!cb.checked) return;
          this.plugin.settings.defaultDisplayMode = value;
          await this.plugin.saveSettings();
          this.onChange();
        })();
      });
      item.addEventListener("click", (ev) => {
        if (ev.target !== cb) cb.click();
      });
    };
    radioRow("2-line (pinyin)", "two-line");
    radioRow("3-line (pinyin + gloss)", "three-line");
    radioRow("None (no inline annotation)", "none");

    const sepDisplay = menu.createDiv({ cls: "cci-overflow-sep" });
    sepDisplay.setAttr("role", "separator");

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
    slider.addEventListener("input", () => {
      void (async () => {
        const px = parseInt(slider.value, 10);
        this.plugin.settings.readerFontPx = px;
        sizeLabel.setText(`${px}px`);
        await this.plugin.saveSettings();
        this.onChange();
      })();
    });

    const lineRow = menu.createDiv({ cls: "cci-overflow-item cci-overflow-slider" });
    lineRow.createSpan({ text: "Line spacing" });
    const lineSlider = lineRow.createEl("input", { type: "range" });
    lineSlider.min = "0.15";
    lineSlider.max = "1.2";
    lineSlider.step = "0.05";
    lineSlider.value = String(this.plugin.settings.readerLineSpacing ?? 1.0);
    const lineLabel = lineRow.createSpan({
      cls: "cci-slider-value",
      text: `${Number(lineSlider.value).toFixed(2)}×`,
    });
    lineSlider.addEventListener("input", () => {
      void (async () => {
        const m = parseFloat(lineSlider.value);
        this.plugin.settings.readerLineSpacing = m;
        lineLabel.setText(`${m.toFixed(2)}×`);
        await this.plugin.saveSettings();
        this.onChange();
      })();
    });

    const sep2 = menu.createDiv({ cls: "cci-overflow-sep" });
    sep2.setAttr("role", "separator");

    const stats = menu.createEl("button", { cls: "cci-overflow-btn", text: "Stats" });
    stats.addEventListener("click", () => {
      menu.remove();
      void this.plugin.openStatsView();
    });
    const story = menu.createEl("button", { cls: "cci-overflow-btn", text: "Generate story" });
    story.addEventListener("click", () => {
      menu.remove();
      this.plugin.openGenerateStoryModal();
    });

    const off = (e: MouseEvent) => {
      if (e.target instanceof Node && menu.contains(e.target)) return;
      menu.remove();
      activeDocument.removeEventListener("click", off);
    };
    window.setTimeout(() => activeDocument.addEventListener("click", off), 0);
    return menu;
  }
}
