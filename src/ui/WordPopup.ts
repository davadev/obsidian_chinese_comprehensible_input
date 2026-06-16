import { Platform } from "obsidian";
import type CciPlugin from "../main";
import { KnownAxes, WordRecord } from "../vocabulary/VocabularyTypes";
import { axesFromStatus } from "../vocabulary/axes";
import { promptAsync } from "./confirmInput";

export class WordPopup {
  private el: HTMLElement | null = null;
  private outsideHandler: ((e: MouseEvent) => void) | null = null;

  constructor(private plugin: CciPlugin) {}

  open(surface: string, anchor: HTMLElement, _ev: Event): void {
    this.close();
    (activeDocument.activeElement as HTMLElement | null)?.blur?.();
    const rec = this.plugin.vocab.ensure(surface);

    if (this.plugin.settings.exposure.popupCountsAsExposure) {
      const noteKey = this.plugin.currentNoteKey();
      this.plugin.exposure.commit(surface, noteKey);
    }
    this.plugin.srs.applyPopupSignal(surface);

    const el = activeDocument.createElement("div");
    el.className = "cci-popup";
    if (Platform.isMobile) el.classList.add("cci-bottom-sheet");

    this.renderInto(el, rec);
    activeDocument.body.appendChild(el);
    this.position(el, anchor);
    this.el = el;

    this.outsideHandler = (e: MouseEvent) => {
      if (!this.el) return;
      if (e.target instanceof Node && this.el.contains(e.target)) return;
      this.close();
    };
    window.setTimeout(() => {
      if (this.outsideHandler) activeDocument.addEventListener("click", this.outsideHandler);
    }, 0);
  }

  close(): void {
    if (this.outsideHandler) {
      activeDocument.removeEventListener("click", this.outsideHandler);
      this.outsideHandler = null;
    }
    if (this.el && this.el.parentElement) {
      this.el.parentElement.removeChild(this.el);
    }
    this.el = null;
  }

  private position(el: HTMLElement, anchor: HTMLElement): void {
    if (el.classList.contains("cci-bottom-sheet")) return;
    const r = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - el.offsetHeight - 12, r.bottom + 6);
    const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  private currentAxes(rec: WordRecord): KnownAxes {
    return rec.axes ?? axesFromStatus(rec.status) ?? { chars: false, pinyin: false, meaning: false };
  }

  private renderInto(el: HTMLElement, rec: WordRecord): void {
    el.empty();

    const dictTop = this.plugin.dictionary.lookup(rec.surfaces[0])[0];

    const head = el.createDiv({ cls: "cci-popup-head" });
    head.textContent = rec.simplified ?? rec.surfaces[0];

    const displayPinyin = dictTop?.pinyin ?? rec.pinyin;
    const displayTraditional = dictTop?.traditional ?? rec.traditional;

    if (displayPinyin) {
      const py = el.createDiv({ cls: "cci-popup-pinyin" });
      py.textContent = displayPinyin;
    }

    if (displayTraditional && displayTraditional !== (rec.simplified ?? rec.surfaces[0])) {
      const tr = el.createDiv({ cls: "cci-popup-meta" });
      tr.createSpan({ text: "Traditional:" });
      tr.createSpan({ text: displayTraditional });
    }

    const defs = el.createDiv({ cls: "cci-popup-defs cci-popup-defs-scroll" });
    if (this.plugin.settings.mnemonicsFirst && rec.mnemonic?.text) {
      defs.createEl("div", { text: `🧠 ${rec.mnemonic.text}` });
    }
    for (const d of dictTop?.definitions ?? rec.definitions ?? []) defs.createEl("div", { text: `• ${d}` });

    // Knowledge checkboxes — the primary marking control.
    this.renderAxesCheckboxes(el, rec);

    const meta = el.createDiv({ cls: "cci-popup-meta" });
    if (rec.hsk?.levels?.length) {
      meta.createSpan({ text: "HSK:" });
      meta.createSpan({ text: rec.hsk.levels.join("/") });
    }
    meta.createSpan({ text: "Seen:" });
    meta.createSpan({ text: String(rec.seenCount) });
    meta.createSpan({ text: "Last:" });
    meta.createSpan({ text: rec.lastSeenAt ? rec.lastSeenAt.slice(0, 10) : "—" });
    meta.createSpan({ text: "Status:" });
    meta.createSpan({ text: rec.status });
    meta.createSpan({ text: "Due:" });
    meta.createSpan({ text: rec.srs?.dueAt ? rec.srs.dueAt.slice(0, 10) : "—" });

    this.renderSparkline(el, rec);

    const actions = el.createDiv({ cls: "cci-popup-actions" });
    this.action(actions, "Ignore", () => {
      this.plugin.markWordIgnored(rec.surfaces[0]);
      this.refresh();
    });
    this.action(actions, "Mnemonic…", () => void this.openMnemonicPrompt(rec));
    this.action(actions, "Edit", () => this.openDictionaryEditor(rec));
  }

  private openDictionaryEditor(rec: WordRecord): void {
    const surface = rec.surfaces[0];
    const entries = this.plugin.dictionary.lookup(surface);
    const raw = this.plugin.dictionary.lookupRaw(surface);
    const custom = this.plugin.dictionaryCustomWords[surface];
    if (custom) {
      void import("./EditDictionaryModal").then(({ EditDictionaryModal }) => {
        new EditDictionaryModal(this.plugin.app, this.plugin, {
          mode: "custom",
          surface,
          isExistingCustom: true,
          initial: {
            traditional: custom.traditional,
            pinyin: custom.pinyin,
            definitions: custom.definitions,
            hskLevel: custom.hsk?.levels?.[0],
          },
        }).open();
        this.close();
      });
      return;
    }
    const top = entries[0];
    if (!top) {
      void import("./EditDictionaryModal").then(({ EditDictionaryModal }) => {
        new EditDictionaryModal(this.plugin.app, this.plugin, {
          mode: "custom",
          surface,
          initial: { pinyin: rec.pinyin },
        }).open();
        this.close();
      });
      return;
    }
    const rawTop = raw[0];
    void import("./EditDictionaryModal").then(({ EditDictionaryModal }) => {
      new EditDictionaryModal(this.plugin.app, this.plugin, {
        mode: "override",
        surface,
        originalEntry: rawTop ?? top,
        initial: {
          traditional: top.traditional,
          pinyin: top.pinyin,
          definitions: top.definitions,
          hskLevel: top.hsk?.levels?.[0],
        },
      }).open();
      this.close();
    });
  }

  private renderAxesCheckboxes(parent: HTMLElement, rec: WordRecord): void {
    const axes = this.currentAxes(rec);
    const wrap = parent.createDiv({ cls: "cci-popup-axes" });
    wrap.createDiv({ cls: "cci-popup-axes-hint", text: "I know:" });
    const row = wrap.createDiv({ cls: "cci-popup-axes-row" });

    const surface = rec.surfaces[0];
    const cb = (label: string, key: keyof KnownAxes) => {
      const item = row.createEl("label", { cls: "cci-popup-axis" });
      const input = item.createEl("input", { type: "checkbox" });
      input.checked = !!axes[key];
      item.createSpan({ text: label });
      input.addEventListener("change", (e) => {
        e.stopPropagation();
        const cur = this.currentAxes(this.plugin.vocab.bySurface(surface) ?? rec);
        cur[key] = input.checked;
        this.plugin.vocab.setAxes(surface, cur);
        this.plugin.refreshChineseViews();
        this.refresh();
      });
    };
    cb("Characters", "chars");
    cb("Pinyin", "pinyin");
    cb("Translation", "meaning");
  }

  private renderSparkline(el: HTMLElement, rec: WordRecord): void {
    const days = lastNDays(14);
    const counts = days.map((d) => rec.dailySeenCounts[d] ?? 0);
    const max = Math.max(1, ...counts);
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = activeDocument.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "cci-sparkline");
    svg.setAttribute("viewBox", `0 0 ${days.length * 10} 30`);
    counts.forEach((c, i) => {
      const h = Math.round((c / max) * 28);
      const r = activeDocument.createElementNS(svgNs, "rect");
      r.setAttribute("x", String(i * 10));
      r.setAttribute("y", String(30 - h));
      r.setAttribute("width", "8");
      r.setAttribute("height", String(h));
      r.setAttribute("fill", "currentColor");
      r.setAttribute("opacity", "0.55");
      svg.appendChild(r);
    });
    el.appendChild(svg);
  }

  private action(parent: HTMLElement, label: string, fn: () => void): void {
    const b = parent.createEl("button", { text: label });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
  }

  private async openMnemonicPrompt(rec: WordRecord): Promise<void> {
    const surface = rec.surfaces[0];
    const existing = rec.mnemonic?.text ?? "";
    const text = await promptAsync(this.plugin.app, "Mnemonic for " + surface, existing);
    if (text == null) return;
    this.plugin.vocab.updateMnemonic(surface, { text });
    this.refresh();
  }

  private refresh() {
    if (!this.el) return;
    const surface = this.el.querySelector(".cci-popup-head")?.textContent;
    if (!surface) return;
    const rec = this.plugin.vocab.bySurface(surface);
    if (!rec) return;
    this.renderInto(this.el, rec);
  }
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
