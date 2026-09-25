import { Platform, setIcon } from "obsidian";
import type CciPlugin from "../main";
import { ColorMode, DisplayMode, LineContent, ScriptVariant, ViewMode } from "../settings/types";
import { indexedSetChanged } from "../settings/scriptChange";
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

    this.formatModeBtn(row);

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
   * Tri-state highlighter button (#21). Cycles:
   *   off → BLUE (add formatting) → RED (reverse = remove selected) → off.
   * Add/remove map to `settings.formatReverseMode`; the color is applied in
   * `styleFormatBtn` (also re-run from `updateActiveStates` on every refresh).
   */
  private formatModeBtn(parent: HTMLElement): void {
    const b = parent.createEl("button", {
      cls: "clickable-icon cci-icon-btn cci-format-btn",
      attr: { "data-mode": "format" },
    });
    setIcon(b, "highlighter");
    this.styleFormatBtn(b);
    b.addEventListener("click", () => {
      void (async () => {
        const inFormat = this.plugin.activeViewMode() === "format";
        const reverse = this.plugin.settings.formatReverseMode;
        if (!inFormat) {
          this.plugin.settings.formatReverseMode = false;
          await this.plugin.saveSettings();
          this.plugin.setActiveViewMode("format"); // → BLUE
        } else if (!reverse) {
          this.plugin.settings.formatReverseMode = true;
          await this.plugin.saveSettings();
          this.refresh(); // → RED
        } else {
          this.plugin.setActiveViewMode("read"); // → off
        }
      })();
    });
  }

  private styleFormatBtn(b: HTMLElement): void {
    const inFormat = this.plugin.activeViewMode() === "format";
    const reverse = this.plugin.settings.formatReverseMode;
    b.toggleClass("is-active", inFormat);
    b.toggleClass("cci-format-add", inFormat && !reverse);
    b.toggleClass("cci-format-remove", inFormat && reverse);
    const title = !inFormat
      ? "Highlighter (tap start + end word)"
      : reverse
      ? "Highlighter: remove — tap to exit"
      : "Highlighter: add — tap for remove mode";
    b.setAttribute("aria-label", title);
    b.setAttribute("title", title);
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
      if (m === "format") {
        // Tri-state colors (blue add / red remove) instead of plain is-active.
        this.styleFormatBtn(b);
        return;
      }
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
    // Color the banner red while in remove (reverse) mode to match the button.
    banner.toggleClass("is-remove", this.plugin.settings.formatReverseMode);
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
    const menu = createDiv();
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

      // Add vs remove is chosen by the tri-state highlighter button (blue/red),
      // not a checkbox here — this menu only arms WHICH formats are affected.
      const reverse = this.plugin.settings.formatReverseMode;
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
    const menu = createDiv();
    menu.className = "cci-overflow-menu";
    activeDocument.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;

    // Returns the checkbox so a caller with several mutually-exclusive rows can
    // repaint the others — this menu stays open after a toggle and is never
    // rebuilt, so nothing else would.
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
      return cb;
    };

    // Script first: on mobile, opening Settings mid-read to flip this is
    // painful, and a Traditional reader needs it before anything else works.
    //
    // Three explicit rows rather than one "Traditional characters" checkbox.
    // A checkbox has nowhere to put "Automatic": unchecking it would have to
    // mean Simplified, so from the default two taps would silently drop the
    // reader into the one mode where a Traditional note shatters into single
    // characters — with nothing said. Radio-style rows cost one extra line and
    // make the third state reachable, which is the point of the escape hatch.
    const scriptHint = menu.createDiv({ cls: "cci-overflow-hint" });
    scriptHint.setText("Script");
    // These three are one setting, so they have to behave like radios. The
    // menu stays open and is never rebuilt after a toggle, so every row has to
    // be repainted by hand — otherwise picking Traditional while Automatic is
    // checked leaves BOTH ticked, and clicking the already-active row unticks
    // it while the setting stays put.
    const scriptRows: { value: ScriptVariant; cb: HTMLInputElement }[] = [];
    const repaintScriptRows = () => {
      for (const r of scriptRows) r.cb.checked = this.plugin.settings.scriptVariant === r.value;
    };
    const scriptRow = (label: string, value: ScriptVariant) => {
      const cb = checkRow(
        label,
        () => this.plugin.settings.scriptVariant === value,
        async () => {
          if (this.plugin.settings.scriptVariant !== value) {
            const prev = this.plugin.settings.scriptVariant;
            this.plugin.settings.scriptVariant = value;
            // saveSettings routes through applyScriptSideEffects(), which
            // rebuilds the trie and re-tokenizes. The colour checkboxes below
            // get away with a plain redecorate; this one must not —
            // segmentation itself changes, and a redecorate would reuse the
            // stale tokens.
            await this.plugin.saveSettings();
            if (indexedSetChanged(prev, value)) this.plugin.offerReindexAfterScriptChange();
          }
          // Unconditional: a click on the already-active row still unticks its
          // own box, and only a repaint puts it back.
          repaintScriptRows();
        }
      );
      scriptRows.push({ value, cb });
    };
    scriptRow("Automatic", "auto");
    scriptRow("Traditional characters", "traditional");
    scriptRow("Simplified characters", "simplified");

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
    // Labels name the CONTENT the user has chosen for each row (#56) rather
    // than hardcoding "pinyin" / "pinyin + gloss", which stopped being true
    // once the rows became configurable.
    const CONTENT_LABEL: Record<LineContent, string> = {
      pinyin: "pinyin",
      english: "English",
      mnemonic: "mnemonic",
    };
    const l2 = CONTENT_LABEL[this.plugin.settings.line2Content] ?? "pinyin";
    const l3 = CONTENT_LABEL[this.plugin.settings.line3Content] ?? "English";
    radioRow(`2-line (${l2})`, "two-line");
    radioRow(`3-line (${l3} + ${l2})`, "three-line");
    radioRow("None (no inline annotation)", "none");

    const sepDisplay = menu.createDiv({ cls: "cci-overflow-sep" });
    sepDisplay.setAttr("role", "separator");

    checkRow("Known-word popups", () => this.plugin.settings.knownWordPopups, async (v) => {
      this.plugin.settings.knownWordPopups = v;
      await this.plugin.saveSettings();
    });

    const sep1 = menu.createDiv({ cls: "cci-overflow-sep" });
    sep1.setAttr("role", "separator");

    /** One labelled range row. Four of these differ only in bounds, formatting
     *  and which setting they write, so they share a builder rather than
     *  repeating the save/relabel/onChange dance four times. */
    const sliderRow = (
      label: string,
      opts: {
        min: number;
        max: number;
        step: number;
        value: number;
        format: (v: number) => string;
        apply: (v: number) => void;
      }
    ): void => {
      const row = menu.createDiv({ cls: "cci-overflow-item cci-overflow-slider" });
      row.createSpan({ text: label });
      const input = row.createEl("input", { type: "range" });
      input.min = String(opts.min);
      input.max = String(opts.max);
      input.step = String(opts.step);
      input.value = String(opts.value);
      const valueLabel = row.createSpan({
        cls: "cci-slider-value",
        text: opts.format(opts.value),
      });
      input.addEventListener("input", () => {
        void (async () => {
          const v = parseFloat(input.value);
          opts.apply(v);
          valueLabel.setText(opts.format(v));
          await this.plugin.saveSettings();
          // Applies the CSS variables and restores the scroll position.
          this.onChange();
        })();
      });
    };

    sliderRow("Font size", {
      min: 14,
      max: 40,
      step: 1,
      value: this.plugin.settings.readerFontPx ?? 22,
      format: (v) => `${v}px`,
      apply: (v) => (this.plugin.settings.readerFontPx = v),
    });

    sliderRow("Line spacing", {
      min: 0.15,
      max: 1.2,
      step: 0.05,
      value: this.plugin.settings.readerLineSpacing ?? 1.0,
      format: (v) => `${v.toFixed(2)}×`,
      apply: (v) => (this.plugin.settings.readerLineSpacing = v),
    });

    // #103: the size of the characters relative to the rows above them, and of
    // those rows. Mirrored here from Settings because both are things a reader
    // adjusts while reading, like font size — not once during setup.
    sliderRow("Chinese size", {
      min: 80,
      max: 200,
      step: 5,
      value: this.plugin.settings.charScalePercent ?? 100,
      format: (v) => `${v}%`,
      apply: (v) => (this.plugin.settings.charScalePercent = v),
    });

    sliderRow("Annotation size", {
      min: 80,
      max: 200,
      step: 5,
      value: this.plugin.settings.annotationScalePercent ?? 100,
      format: (v) => `${v}%`,
      apply: (v) => (this.plugin.settings.annotationScalePercent = v),
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
