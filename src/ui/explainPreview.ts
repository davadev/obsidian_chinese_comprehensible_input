import type { Block, Inline } from "../ai/explain";

function fill(el: HTMLElement, inline: Inline[]): void {
  for (const part of inline) {
    if (typeof part === "string") el.appendChild(activeDocument.createTextNode(part));
    else if ("b" in part) el.createEl("strong", { text: part.b });
    else el.createEl("em", { text: part.i });
  }
}

/**
 * Draw the note's blocks (see `explainBlocks`) into the dialog. Consecutive list items share one list; nesting is
 * carried by a depth class so the stylesheet decides the indent.
 */
export function renderExplainBlocks(parent: HTMLElement, blocks: Block[]): void {
  let list: HTMLElement | null = null;
  for (const b of blocks) {
    if (b.kind !== "li") list = null;
    if (b.kind === "h") {
      parent.createEl(b.level === 1 ? "h3" : b.level === 2 ? "h4" : "h5", { text: b.text, cls: `cci-explain-h${b.level}` });
    } else if (b.kind === "p") {
      fill(parent.createEl("p", { cls: b.callout ? "cci-explain-callout" : "cci-explain-p" }), b.inline);
    } else {
      list ??= parent.createEl("ul", { cls: "cci-explain-list" });
      const item = list.createEl("li", { cls: `cci-explain-d${b.depth}` });
      if (b.number) item.createSpan({ text: `${b.number}. `, cls: "cci-explain-num" });
      fill(item, b.inline);
    }
  }
}
