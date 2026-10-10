// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { renderStatusPriorityList } from "../settings/StatusPriorityList";
import { renderFormatOptionsList, type FormatOptionRow } from "../settings/FormatOptionsList";
import type { WordStatus } from "../vocabulary/VocabularyTypes";

/**
 * The two reorderable lists in Settings: sync conflict priority, and the formatting picker. Order is the setting, so
 * every way of changing it (arrow buttons for phones and keyboards, drag and drop on a desktop) has to report exactly
 * the new order, and the first and last rows must not offer a move that falls off the end.
 */

installObsidianDom();

afterEach(() => {
  document.body.innerHTML = "";
});

/** A drag event carrying a DataTransfer-like object, which happy-dom cannot construct itself. */
function dragEvent(type: string, data: { text?: string } = {}) {
  const store = new Map<string, string>(data.text !== undefined ? [["text/plain", data.text]] : []);
  const dt = {
    effectAllowed: "",
    dropEffect: "",
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? "",
  };
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  return { ev, dt };
}
const noTransfer = (type: string) => new Event(type, { bubbles: true, cancelable: true });

describe("renderStatusPriorityList", () => {
  const ORDER: WordStatus[] = ["known", "unknown", "ignored"];
  const mount = (values: WordStatus[] = ORDER) => {
    const parent = document.createElement("div");
    const onChange = vi.fn();
    renderStatusPriorityList(parent, { values, onChange });
    return { parent, onChange };
  };
  const rows = (p: HTMLElement) => Array.from(p.querySelectorAll<HTMLElement>(".cci-status-priority-row"));
  const labels = (p: HTMLElement) => rows(p).map((r) => r.querySelector(".cci-status-priority-label")!.textContent);
  const arrow = (p: HTMLElement, row: number, name: "Move up" | "Move down") =>
    rows(p)[row].querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

  it("lists the statuses in order with their rank and a readable label", () => {
    const { parent } = mount();
    expect(labels(parent)).toEqual(["Known (chars + pinyin + meaning)", "Unknown", "Ignored"]);
    expect(rows(parent).map((r) => r.querySelector(".cci-status-priority-rank")!.textContent)).toEqual(["1.", "2.", "3."]);
  });

  it("shows an unrecognised status as its raw name rather than hiding it", () => {
    const { parent } = mount(["known", "from-a-newer-version" as WordStatus]);
    expect(labels(parent)[1]).toBe("from-a-newer-version");
  });

  it("replaces whatever the parent held", () => {
    const parent = document.createElement("div");
    parent.textContent = "old";
    renderStatusPriorityList(parent, { values: ["known"], onChange: vi.fn() });
    expect(parent.textContent).not.toContain("old");
  });

  it("disables up on the first row and down on the last", () => {
    const { parent } = mount();
    expect(arrow(parent, 0, "Move up").disabled).toBe(true);
    expect(arrow(parent, 0, "Move down").disabled).toBe(false);
    expect(arrow(parent, 2, "Move down").disabled).toBe(true);
    expect(arrow(parent, 2, "Move up").disabled).toBe(false);
  });

  it("the arrows swap neighbours and report the new order each time", () => {
    const { parent, onChange } = mount();
    arrow(parent, 1, "Move up").click();
    expect(onChange).toHaveBeenLastCalledWith(["unknown", "known", "ignored"]);
    arrow(parent, 1, "Move down").click();
    expect(onChange).toHaveBeenLastCalledWith(["unknown", "ignored", "known"]);
    expect(labels(parent)[2]).toBe("Known (chars + pinyin + meaning)");
  });

  it("clicking an arrow that cannot move does nothing", () => {
    const { parent, onChange } = mount();
    arrow(parent, 0, "Move up").disabled = false;
    arrow(parent, 0, "Move up").click();
    arrow(parent, 2, "Move down").disabled = false;
    arrow(parent, 2, "Move down").click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dragging a row onto another moves it there", () => {
    const { parent, onChange } = mount();
    const from = rows(parent)[0];
    const { ev: start, dt } = dragEvent("dragstart");
    from.dispatchEvent(start);
    expect(dt.effectAllowed).toBe("move");
    expect(from.classList.contains("dragging")).toBe(true);
    const target = rows(parent)[2];
    const over = dragEvent("dragover");
    target.dispatchEvent(over.ev);
    expect(over.dt.dropEffect).toBe("move");
    expect(target.classList.contains("drag-over")).toBe(true);
    target.dispatchEvent(dragEvent("drop", { text: "0" }).ev);
    expect(onChange).toHaveBeenLastCalledWith(["unknown", "ignored", "known"]);
  });

  it("drag hover and end only toggle classes", () => {
    const { parent, onChange } = mount();
    const r = rows(parent)[1];
    r.dispatchEvent(dragEvent("dragover").ev);
    r.dispatchEvent(noTransfer("dragleave"));
    expect(r.classList.contains("drag-over")).toBe(false);
    r.dispatchEvent(dragEvent("dragstart").ev);
    r.dispatchEvent(noTransfer("dragend"));
    expect(r.classList.contains("dragging")).toBe(false);
    r.dispatchEvent(noTransfer("dragover"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores drags that carry no data, an unreadable index, or a drop onto itself", () => {
    const { parent, onChange } = mount();
    const r = rows(parent)[1];
    r.dispatchEvent(noTransfer("dragstart")); // no dataTransfer at all
    expect(r.classList.contains("dragging")).toBe(false);
    r.dispatchEvent(noTransfer("drop")); // no dataTransfer: parses as NaN
    r.dispatchEvent(dragEvent("drop", { text: "abc" }).ev);
    r.dispatchEvent(dragEvent("drop", { text: "1" }).ev); // onto itself
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("renderFormatOptionsList", () => {
  const ROWS: FormatOptionRow[] = [
    { id: "bold", label: "Bold", visible: true },
    { id: "hl:pink", label: "Highlight: Pink", visible: false, color: "#f0a" },
    { id: "italic", label: "Italic", visible: true },
  ];
  const mount = (rows: FormatOptionRow[] = ROWS) => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onChange = vi.fn();
    renderFormatOptionsList(parent, { rows, onChange });
    return { parent, onChange };
  };
  const rowEls = (p: HTMLElement) => Array.from(p.querySelectorAll<HTMLElement>(".cci-status-priority-row"));
  const ids = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)![0] as FormatOptionRow[]).map((r) => r.id);
  const arrow = (p: HTMLElement, row: number, name: "Move up" | "Move down") =>
    rowEls(p)[row].querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

  it("shows label, visibility and, for coloured highlights, a swatch", () => {
    const { parent } = mount();
    const rows = rowEls(parent);
    expect(rows.map((r) => r.querySelector(".cci-status-priority-label")!.textContent)).toEqual(["Bold", "Highlight: Pink", "Italic"]);
    expect(rows.map((r) => r.querySelector<HTMLInputElement>("input")!.checked)).toEqual([true, false, true]);
    expect(rows[0].querySelector(".cci-format-swatch")).toBeNull();
    expect(rows[1].querySelector<HTMLElement>(".cci-format-swatch")!.style.background).not.toBe("");
  });

  it("ticking a row's checkbox reports that row's new visibility and keeps the order", () => {
    const { parent, onChange } = mount();
    const box = rowEls(parent)[1].querySelector<HTMLInputElement>("input")!;
    box.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FormatOptionRow[];
    expect(next.map((r) => [r.id, r.visible])).toEqual([["bold", true], ["hl:pink", true], ["italic", true]]);
  });

  it("the checkbox click does not bubble to the row", () => {
    const { parent } = mount();
    const row = rowEls(parent)[0];
    const onRow = vi.fn();
    row.addEventListener("click", onRow);
    row.querySelector<HTMLInputElement>("input")!.click();
    expect(onRow).not.toHaveBeenCalled();
  });

  it("the arrows reorder, and the end rows cannot move off the list", () => {
    const { parent, onChange } = mount();
    expect(arrow(parent, 0, "Move up").disabled).toBe(true);
    expect(arrow(parent, 2, "Move down").disabled).toBe(true);
    arrow(parent, 0, "Move down").click();
    expect(ids(onChange)).toEqual(["hl:pink", "bold", "italic"]);
    arrow(parent, 2, "Move up").click();
    expect(ids(onChange)).toEqual(["hl:pink", "italic", "bold"]);
    const calls = onChange.mock.calls.length;
    arrow(parent, 0, "Move up").disabled = false;
    arrow(parent, 0, "Move up").click();
    arrow(parent, 2, "Move down").disabled = false;
    arrow(parent, 2, "Move down").click();
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it("dragging reorders; bad drags are ignored", () => {
    const { parent, onChange } = mount();
    const rows = rowEls(parent);
    const start = dragEvent("dragstart");
    rows[2].dispatchEvent(start.ev);
    expect(start.dt.effectAllowed).toBe("move");
    expect(rows[2].classList.contains("dragging")).toBe(true);
    rows[2].dispatchEvent(noTransfer("dragend"));
    rows[0].dispatchEvent(dragEvent("dragover").ev);
    expect(rows[0].classList.contains("drag-over")).toBe(true);
    rows[0].dispatchEvent(noTransfer("dragleave"));
    rows[0].dispatchEvent(noTransfer("dragover"));
    rows[0].dispatchEvent(noTransfer("dragstart"));
    rows[0].dispatchEvent(noTransfer("drop"));
    rows[0].dispatchEvent(dragEvent("drop", { text: "x" }).ev);
    rows[0].dispatchEvent(dragEvent("drop", { text: "0" }).ev);
    expect(onChange).not.toHaveBeenCalled();
    rows[0].dispatchEvent(dragEvent("drop", { text: "2" }).ev);
    expect(ids(onChange)).toEqual(["italic", "bold", "hl:pink"]);
  });
});
