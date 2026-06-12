import { WordStatus } from "../vocabulary/VocabularyTypes";

/**
 * Vertical sortable list used in the Sync settings section. The user
 * reorders WordStatus values to set conflict priority — earlier in the
 * list wins when two devices set different statuses on the same word.
 *
 * Supports HTML5 drag-and-drop (desktop) plus per-row up/down arrow
 * buttons (mobile / accessibility). No external dependency.
 */

const LABELS: Record<WordStatus, string> = {
  known: "Known (chars + pinyin + meaning)",
  meaningKnownPinyinUnknown: "Meaning known, pinyin unknown",
  pinyinKnownMeaningUnknown: "Pinyin known, meaning unknown",
  charactersUnknown: "Characters unknown",
  unknown: "Unknown",
  ignored: "Ignored",
  new: "New (unclassified)",
};

export interface StatusPriorityListProps {
  values: WordStatus[];
  onChange: (next: WordStatus[]) => void | Promise<void>;
}

export function renderStatusPriorityList(
  parent: HTMLElement,
  props: StatusPriorityListProps
): void {
  parent.empty();
  const wrap = parent.createDiv({ cls: "cci-status-priority-list" });

  let current = [...props.values];

  const rerender = () => {
    wrap.empty();
    current.forEach((status, idx) => {
      const row = wrap.createDiv({ cls: "cci-status-priority-row" });
      row.setAttr("draggable", "true");
      row.dataset.idx = String(idx);

      const handle = row.createSpan({ cls: "cci-status-priority-handle", text: "⋮⋮" });
      handle.setAttr("aria-hidden", "true");

      row.createSpan({
        cls: "cci-status-priority-rank",
        text: String(idx + 1) + ".",
      });

      row.createSpan({
        cls: "cci-status-priority-label",
        text: LABELS[status] ?? status,
      });

      const buttons = row.createDiv({ cls: "cci-status-priority-buttons" });
      const upBtn = buttons.createEl("button", { text: "↑" });
      upBtn.setAttr("aria-label", "Move up");
      upBtn.disabled = idx === 0;
      upBtn.onclick = (e) => {
        e.preventDefault();
        if (idx === 0) return;
        swap(idx, idx - 1);
      };
      const downBtn = buttons.createEl("button", { text: "↓" });
      downBtn.setAttr("aria-label", "Move down");
      downBtn.disabled = idx === current.length - 1;
      downBtn.onclick = (e) => {
        e.preventDefault();
        if (idx === current.length - 1) return;
        swap(idx, idx + 1);
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
    void props.onChange(current);
    rerender();
  };
  const move = (from: number, to: number) => {
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    current = next;
    void props.onChange(current);
    rerender();
  };

  rerender();
}
