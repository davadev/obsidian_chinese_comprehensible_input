import type { FormatId } from "../settings/types";
import type { HighlightWrap } from "./highlightPalette";

/**
 * Pure formatting logic for the in-view formatting mode (#21 phase 1).
 *
 * Formats split into three buckets:
 *  - inline (combinable): bold / italic / highlight / strike — wrap the span,
 *    nesting outward in a fixed order so output is deterministic.
 *  - inline-exclusive: code — a literal span, incompatible with the other
 *    inline formats.
 *  - block (one at a time): h1 / h2 / h3 / quote — a line-start prefix.
 *
 * `buildFormatChanges` is doc-string-pure (takes text + range) so it is fully
 * unit-testable without a live CodeMirror editor.
 */

export const INLINE_FORMATS: readonly FormatId[] = ["bold", "italic", "highlight", "strike"];
export const BLOCK_FORMATS: readonly FormatId[] = ["h1", "h2", "h3", "quote"];

/** Non-highlight inline delimiters nested inner→outer around the span. */
const NESTED_INLINE: ReadonlyArray<{ id: FormatId; delim: string }> = [
  { id: "bold", delim: "**" },
  { id: "italic", delim: "*" },
  { id: "strike", delim: "~~" },
];

/** Line-start prefixes for block formats. */
const BLOCK_PREFIX: Record<string, string> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  quote: "> ",
};

export const FORMAT_LABELS: Record<FormatId, string> = {
  bold: "Bold",
  italic: "Italic",
  highlight: "Highlight",
  strike: "Strikethrough",
  code: "Code",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  quote: "Quote",
};

export interface FormatChange {
  from: number;
  to: number;
  insert: string;
}

/** A highlight is the plain `==` option or a colored `hl:<slug>` option. */
export function isHighlight(id: string): boolean {
  return id === "highlight" || id.startsWith("hl:");
}

function isBlock(id: string): boolean {
  return (BLOCK_FORMATS as readonly string[]).includes(id);
}

function isInline(id: string): boolean {
  return (
    id === "code" ||
    id === "bold" ||
    id === "italic" ||
    id === "strike" ||
    isHighlight(id)
  );
}

/**
 * Would arming `id` conflict with the currently-`enabled` set? Drives which
 * checkboxes are greyed out. `id` itself being enabled never counts as a
 * conflict (so an armed box stays toggleable).
 */
export function conflictDisabled(id: string, enabled: string[]): boolean {
  if (enabled.includes(id)) return false;
  const others = enabled;
  if (id === "code") {
    // code is exclusive with every other inline format
    return others.some((o) => isInline(o));
  }
  if (isHighlight(id)) {
    // one highlight at a time, and never alongside code
    return others.includes("code") || others.some((o) => isHighlight(o));
  }
  if (id === "bold" || id === "italic" || id === "strike") {
    return others.includes("code");
  }
  // block: only one block prefix at a time
  return others.some((o) => isBlock(o));
}

/**
 * Wrap `text` in the selected inline delimiters. `code` short-circuits to a
 * literal span. Bold/italic/strike nest inner→outer; a highlight wraps
 * outermost using `hlWrap` (colored `<mark>` when given, plain `==` otherwise).
 * Returns `text` unchanged when no inline format is selected.
 */
export function composeInline(text: string, formats: string[], hlWrap?: HighlightWrap): string {
  if (formats.includes("code")) return "`" + text + "`";
  let out = text;
  for (const { id, delim } of NESTED_INLINE) {
    if (formats.includes(id)) out = delim + out + delim;
  }
  if (formats.some(isHighlight)) {
    const w = hlWrap ?? { open: "==", close: "==" };
    out = w.open + out + w.close;
  }
  return out;
}

/** Line-start offsets covered by [from, to) within `doc`. */
function coveredLineStarts(doc: string, from: number, to: number): number[] {
  const starts: number[] = [];
  let lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  starts.push(lineStart);
  for (let i = from; i < to; i++) {
    if (doc[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * Build the CodeMirror change list for applying `formats` to the span
 * [from, to) of `doc`. Inline formats replace the slice with its wrapped form;
 * block formats insert a prefix at each covered line start. Returns an empty
 * array when nothing applies or the range is empty.
 */
export function buildFormatChanges(
  doc: string,
  from: number,
  to: number,
  formats: string[],
  hlWrap?: HighlightWrap
): FormatChange[] {
  if (from > to) [from, to] = [to, from];
  if (from === to || formats.length === 0) return [];

  const changes: FormatChange[] = [];

  const inline = formats.filter(isInline);
  if (inline.length > 0) {
    const slice = doc.slice(from, to);
    changes.push({ from, to, insert: composeInline(slice, inline, hlWrap) });
  }

  const block = formats.find(isBlock);
  if (block) {
    const prefix = BLOCK_PREFIX[block];
    for (const ls of coveredLineStarts(doc, from, to)) {
      // Skip if the line already starts with this exact prefix.
      if (doc.startsWith(prefix, ls)) continue;
      // A zero-width insert strictly inside the inline replace range would
      // overlap it (CM forbids that). When inline is also applied, only prefix
      // the first line (line start ≤ from); block formats are line-level so
      // this matches the common single-line case.
      if (inline.length > 0 && ls > from) continue;
      changes.push({ from: ls, to: ls, insert: prefix });
    }
  }

  // CodeMirror requires changes sorted by `from` and non-overlapping. The
  // inline change covers [from,to); block inserts are zero-width at line
  // starts ≤ from or strictly inside the span — sort ascending by `from`.
  changes.sort((a, b) => a.from - b.from);
  return changes;
}

/** Characters that make up the inline delimiters we strip when unformatting. */
const INLINE_DELIM_CHARS = new Set(["*", "=", "~", "`"]);

/** Remove inline delimiters (`**` `*` `==` `~~` `` ` ``) and `<mark>` tags. */
function stripInlineDelims(s: string): string {
  return s
    .replace(/<\/?mark\b[^>]*>/gi, "")
    .replace(/\*\*/g, "")
    .replace(/==/g, "")
    .replace(/~~/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "");
}

/**
 * Build changes that strip markdown formatting from the span [from, to) — used
 * when the formatting mode has nothing armed. Expands over delimiters that sit
 * just outside the tapped words (so `==你好==` clears cleanly when 你 and 好 are
 * tapped) and removes heading / quote line prefixes on covered lines.
 */
export function buildUnformatChanges(doc: string, from: number, to: number): FormatChange[] {
  if (from > to) [from, to] = [to, from];

  // Expand outward over adjacent inline delimiter characters.
  let s = from;
  let e = to;
  while (s > 0 && INLINE_DELIM_CHARS.has(doc[s - 1])) s--;
  while (e < doc.length && INLINE_DELIM_CHARS.has(doc[e])) e++;
  // Swallow an immediately-preceding `<mark …>` and a following `</mark>`.
  const openMatch = /<mark\b[^>]*>$/i.exec(doc.slice(Math.max(0, s - 256), s));
  if (openMatch) s -= openMatch[0].length;
  const closeMatch = /^<\/mark>/i.exec(doc.slice(e, e + 8));
  if (closeMatch) e += closeMatch[0].length;

  const changes: FormatChange[] = [];
  const region = doc.slice(s, e);
  const cleaned = stripInlineDelims(region);
  const hasInline = cleaned !== region;
  if (hasInline) changes.push({ from: s, to: e, insert: cleaned });

  // Block prefixes live at line starts (≤ from). Strip them, but when an inline
  // change is present skip interior lines (ls > from) to avoid overlapping it.
  let lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  const lineStarts: number[] = [lineStart];
  for (let i = from; i < to; i++) if (doc[i] === "\n") lineStarts.push(i + 1);
  for (const ls of lineStarts) {
    if (hasInline && ls > from) continue;
    const nl = doc.indexOf("\n", ls);
    const lineEnd = nl === -1 ? doc.length : nl;
    const m = /^(#{1,6}[ \t]+|>[ \t]?)/.exec(doc.slice(ls, lineEnd));
    if (m) changes.push({ from: ls, to: ls + m[1].length, insert: "" });
  }

  changes.sort((a, b) => a.from - b.from);
  return changes;
}
