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

/** Existing heading / quote line prefix. */
const EXISTING_BLOCK_RE = /^(#{1,6}[ \t]+|>[ \t]?)/;

/**
 * Set each covered line's block prefix to `desired` ("" to strip it), replacing
 * any existing heading/quote prefix. When an inline replace covers [from,to)
 * (`inlinePresent`), only the first line (start ≤ from) is touched so the
 * zero-/small-width prefix edit can't overlap the inline change.
 */
function blockPrefixChanges(
  doc: string,
  from: number,
  to: number,
  desired: string,
  inlinePresent: boolean
): FormatChange[] {
  const changes: FormatChange[] = [];
  for (const ls of coveredLineStarts(doc, from, to)) {
    if (inlinePresent && ls > from) continue;
    const nl = doc.indexOf("\n", ls);
    const lineEnd = nl === -1 ? doc.length : nl;
    const existing = EXISTING_BLOCK_RE.exec(doc.slice(ls, lineEnd))?.[1] ?? "";
    if (existing === desired) continue;
    changes.push({ from: ls, to: ls + existing.length, insert: desired });
  }
  return changes;
}

/** Expand [from,to) over adjacent inline delimiters and a surrounding `<mark>`. */
function expandFormattedRegion(doc: string, from: number, to: number): [number, number] {
  let s = from;
  let e = to;
  while (s > 0 && INLINE_DELIM_CHARS.has(doc[s - 1])) s--;
  while (e < doc.length && INLINE_DELIM_CHARS.has(doc[e])) e++;
  const openMatch = /<mark\b[^>]*>$/i.exec(doc.slice(Math.max(0, s - 256), s));
  if (openMatch) s -= openMatch[0].length;
  const closeMatch = /^<\/mark>/i.exec(doc.slice(e, e + 8));
  if (closeMatch) e += closeMatch[0].length;
  return [s, e];
}

/**
 * Add mode: additively apply `formats` to the span [from, to). Inline formats
 * wrap the slice; a checked block format replaces any existing heading/quote
 * prefix on the covered lines (so applying H2 over an H1 normalizes the level),
 * while leaving the line prefix untouched when no block is checked. Returns an
 * empty array when nothing applies or the range is empty.
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
    changes.push(...blockPrefixChanges(doc, from, to, BLOCK_PREFIX[block], inline.length > 0));
  }

  changes.sort((a, b) => a.from - b.from);
  return changes;
}

/**
 * Exact mode: make the span [from, to) have *exactly* `formats`. Strips all
 * existing inline formatting (and a surrounding `<mark>`) from the expanded
 * region, re-wraps the core with the checked inline formats, and sets each
 * covered line's block prefix to the checked block (or strips it when none is
 * checked). Empty `formats` ⇒ clears everything.
 */
export function buildSetFormatChanges(
  doc: string,
  from: number,
  to: number,
  formats: string[],
  hlWrap?: HighlightWrap
): FormatChange[] {
  if (from > to) [from, to] = [to, from];
  if (from === to) return [];

  const changes: FormatChange[] = [];

  const [s, e] = expandFormattedRegion(doc, from, to);
  const region = doc.slice(s, e);
  const core = stripInlineDelims(region);
  const inlineChecked = formats.filter(isInline);
  const newInline = composeInline(core, inlineChecked, hlWrap);
  const inlinePresent = newInline !== region;
  if (inlinePresent) changes.push({ from: s, to: e, insert: newInline });

  const block = formats.find(isBlock);
  const desired = block ? BLOCK_PREFIX[block] : "";
  changes.push(...blockPrefixChanges(doc, from, to, desired, inlinePresent));

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
  // Clearing everything is exactly "set to no formats".
  return buildSetFormatChanges(doc, from, to, []);
}

/** Apply a sorted, non-overlapping `FormatChange[]` to a string (for guards/tests). */
export function applyChangesToString(doc: string, changes: FormatChange[]): string {
  let out = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

/**
 * The note's actual content with all markdown formatting removed: inline
 * delimiters / `<mark>` tags and leading heading/quote prefixes. Formatting
 * edits must never change this — used by `formattingPreservesContent` as a
 * data-loss guard before any formatting transaction is dispatched.
 */
export function formattingPlainText(s: string): string {
  return s
    .split("\n")
    .map((line) => stripInlineDelims(line.replace(/^(\s*)(?:#{1,6}[ \t]+|>[ \t]?)+/, "$1")))
    .join("\n");
}

/**
 * True when applying `changes` only adds/removes markup — never alters the
 * underlying content. A formatting op that fails this would lose text and must
 * be aborted.
 */
export function formattingPreservesContent(doc: string, changes: FormatChange[]): boolean {
  return formattingPlainText(applyChangesToString(doc, changes)) === formattingPlainText(doc);
}
