/**
 * Sortable list with per-row visibility toggles, used in Advanced display to
 * order the formatting-mode options and hide the ones the user doesn't want
 * cluttering the picker dropdown (#21 phase 2).
 *
 * Mirrors StatusPriorityList's drag-and-drop + up/down arrows, adding a
 * visibility checkbox and an optional color swatch per row. No dependency.
 */

export interface FormatOptionRow {
  id: string;
  label: string;
  visible: boolean;
  /** Set for colored highlights — renders a swatch. */
  color?: string;
}

export interface FormatOptionsListProps {
  rows: FormatOptionRow[];
  onChange: (rows: FormatOptionRow[]) => void | Promise<void>;
}

export function renderFormatOptionsList(parent: HTMLElement, props: FormatOptionsListProps): void {
  parent.empty();
  const wrap = parent.createDiv({ cls: "cci-status-priority-list" });

  let current = [...props.rows];

  const commit = () => {
    void props.onChange(current);
    rerender();
  };

  const rerender = () => {
    wrap.empty();
    current.forEach((opt, idx) => {
      const row = wrap.createDiv({ cls: "cci-status-priority-row" });
      row.setAttr("draggable", "true");
      row.dataset.idx = String(idx);

      const handle = row.createSpan({ cls: "cci-status-priority-handle", text: "⋮⋮" });
      handle.setAttr("aria-hidden", "true");

      row.createSpan({ cls: "cci-status-priority-rank", text: String(idx + 1) + "." });

      if (opt.color) {
        const sw = row.createSpan({ cls: "cci-format-swatch" });
        sw.style.background = opt.color;
      }

      row.createSpan({ cls: "cci-status-priority-label", text: opt.label });

      const vis = row.createEl("input", { type: "checkbox" });
      vis.checked = opt.visible;
      vis.setAttr("aria-label", "Show in picker");
      vis.setAttr("title", "Show in picker");
      vis.onclick = (e) => e.stopPropagation();
      vis.onchange = () => {
        current = current.map((o, i) => (i === idx ? { ...o, visible: vis.checked } : o));
        commit();
      };

      const buttons = row.createDiv({ cls: "cci-status-priority-buttons" });
      const upBtn = buttons.createEl("button", { text: "↑" });
      upBtn.setAttr("aria-label", "Move up");
      upBtn.disabled = idx === 0;
      upBtn.onclick = (e) => {
        e.preventDefault();
        if (idx > 0) swap(idx, idx - 1);
      };
      const downBtn = buttons.createEl("button", { text: "↓" });
      downBtn.setAttr("aria-label", "Move down");
      downBtn.disabled = idx === current.length - 1;
      downBtn.onclick = (e) => {
        e.preventDefault();
        if (idx < current.length - 1) swap(idx, idx + 1);
      };

      row.addEventListener("dragstart", (ev) => {
        if (!ev.dataTransfer) return;
        ev.dataTransfer.setData("text/plain", String(idx));
        ev.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("drag-over");
        const from = parseInt(ev.dataTransfer?.getData("text/plain") ?? "", 10);
        if (Number.isNaN(from) || from === idx) return;
        move(from, idx);
      });
    });
  };

  const swap = (a: number, b: number) => {
    const next = [...current];
    [next[a], next[b]] = [next[b], next[a]];
    current = next;
    commit();
  };
  const move = (from: number, to: number) => {
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    current = next;
    commit();
  };

  rerender();
}
