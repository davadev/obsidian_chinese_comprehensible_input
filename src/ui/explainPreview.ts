import type { Block, Inline } from "../ai/explain";

const SHOWN_ISSUES = 3;

/**
 * The line under a note the plugin could not fully verify. A model that ignores the format can break a dozen rules at once;
 * the first few are enough to see what is wrong, and the rest would bury the note.
 */
export function describeIssues(issues: string[]): string {
  const shown = issues.slice(0, SHOWN_ISSUES).join(" ");
  const more = issues.length > SHOWN_ISSUES ? ` (and ${issues.length - SHOWN_ISSUES} more)` : "";
  return `The plugin could not get every rule right even after asking again: ${shown}${more} Regenerate often fixes it; a larger model follows the format more reliably.`;
}

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
