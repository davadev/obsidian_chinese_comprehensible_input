import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { HEADING_SCALE } from "./headingScale";

/**
 * Markdown syntax highlighting tuned for the Chinese reader.
 * Larger headings, bold/italic, code dim, list markers de-emphasized.
 */
export const cciMarkdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: `${HEADING_SCALE[1]}em`, fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading2, fontSize: `${HEADING_SCALE[2]}em`, fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading3, fontSize: `${HEADING_SCALE[3]}em`, fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading4, fontSize: `${HEADING_SCALE[4]}em`, fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading5, fontSize: "1em", fontWeight: "700", color: "var(--text-normal)" },
  { tag: t.heading6, fontSize: "1em", fontWeight: "700", color: "var(--text-muted)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-muted)" },
  { tag: t.link, color: "var(--text-accent)" },
  { tag: t.url, color: "var(--text-accent)" },
  { tag: t.monospace, fontFamily: "var(--font-monospace, ui-monospace, monospace)", background: "var(--background-secondary)" },
  { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--text-muted)" },
  { tag: t.processingInstruction, color: "var(--text-faint)" }, // markdown markers like # *
]);
