import { Platform } from "obsidian";
import type CciPlugin from "../main";
import { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";

export class WordPopup {
  private el: HTMLElement | null = null;
  private outsideHandler: ((e: MouseEvent) => void) | null = null;

  constructor(private plugin: CciPlugin) {}

  open(surface: string, anchor: HTMLElement, _ev: Event): void {
    this.close();
    // Drop focus from any editor input so the on-screen keyboard hides on mobile.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const rec = this.plugin.vocab.ensure(surface);

    if (this.plugin.settings.exposure.popupCountsAsExposure) {
      const noteKey = this.plugin.currentNoteKey();
      this.plugin.exposure.commit(surface, noteKey);
    }
    this.plugin.srs.applyPopupSignal(surface);

    const el = document.createElement("div");
    el.className = "cci-popup";
    if (Platform.isMobile) el.classList.add("cci-bottom-sheet");

    this.renderInto(el, rec);
    document.body.appendChild(el);
    this.position(el, anchor);
    this.el = el;

    this.outsideHandler = (e: MouseEvent) => {
      if (!this.el) return;
      if (e.target instanceof Node && this.el.contains(e.target)) return;
      this.close();
    };
    window.setTimeout(() => {
      if (this.outsideHandler) document.addEventListener("click", this.outsideHandler);
    }, 0);
  }

  close(): void {
    if (this.outsideHandler) {
      document.removeEventListener("click", this.outsideHandler);
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

  private renderInto(el: HTMLElement, rec: WordRecord): void {
    el.empty();

    const head = el.createDiv({ cls: "cci-popup-head" });
    head.textContent = rec.simplified ?? rec.surfaces[0];

    if (rec.pinyin) {
      const py = el.createDiv({ cls: "cci-popup-pinyin" });
      py.textContent = rec.pinyin;
    }

    if (rec.traditional && rec.traditional !== rec.simplified) {
      const tr = el.createDiv({ cls: "cci-popup-meta" });
      tr.createSpan({ text: "Traditional:" });
      tr.createSpan({ text: rec.traditional });
    }

    const defs = el.createDiv({ cls: "cci-popup-defs" });
    if (this.plugin.settings.mnemonicsFirst && rec.mnemonic?.text) {
      defs.createEl("div", { text: `🧠 ${rec.mnemonic.text}` });
    }
    for (const d of rec.definitions ?? []) defs.createEl("div", { text: `• ${d}` });

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
    this.action(actions, "✓ Known", () => this.mark(rec, "known"));
    this.action(actions, "✗ Unknown", () => this.mark(rec, "unknown"));
    this.action(actions, "Meaning ✓, pinyin ?", () => this.mark(rec, "meaningKnownPinyinUnknown"));
    this.action(actions, "Pinyin ✓, meaning ?", () => this.mark(rec, "pinyinKnownMeaningUnknown"));
    this.action(actions, "Spoken ✓, chars ?", () => this.mark(rec, "charactersUnknown"));
    this.action(actions, "Ignore", () => this.mark(rec, "ignored"));
    this.action(actions, "Mnemonic…", () => this.openMnemonicPrompt(rec));
  }

  private renderSparkline(el: HTMLElement, rec: WordRecord): void {
    const days = lastNDays(14);
    const counts = days.map((d) => rec.dailySeenCounts[d] ?? 0);
    const max = Math.max(1, ...counts);
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "cci-sparkline");
    svg.setAttribute("viewBox", `0 0 ${days.length * 10} 30`);
    counts.forEach((c, i) => {
      const h = Math.round((c / max) * 28);
      const r = document.createElementNS(svgNs, "rect");
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
      this.refresh();
    });
  }

  private mark(rec: WordRecord, status: WordStatus) {
    const surface = rec.surfaces[0];
    this.plugin.markWord(surface, status);
    this.plugin.srs.applyGrade(surface, status === "known" ? "good" : "again");
  }

  private openMnemonicPrompt(rec: WordRecord) {
    const surface = rec.surfaces[0];
    const existing = rec.mnemonic?.text ?? "";
    const text = window.prompt("Mnemonic for " + surface, existing);
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
