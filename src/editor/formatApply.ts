import type { FormatId } from "../settings/types";

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

/** Delimiters wrapped around the span. Listed inner→outer; applied in order. */
const INLINE_DELIM: Record<string, string> = {
  bold: "**",
  italic: "*",
  highlight: "==",
  strike: "~~",
};

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

function isInline(id: FormatId): boolean {
  return id === "code" || INLINE_FORMATS.includes(id);
}

/**
 * Would arming `id` conflict with the currently-`enabled` set? Drives which
 * checkboxes are greyed out. `id` itself being enabled never counts as a
 * conflict (so an armed box stays toggleable).
 */
export function conflictDisabled(id: FormatId, enabled: FormatId[]): boolean {
  if (enabled.includes(id)) return false;
  const others = enabled;
  if (id === "code") {
    // code is exclusive with every other inline format
    return others.some((o) => isInline(o));
  }
  if (INLINE_FORMATS.includes(id)) {
    return others.includes("code");
  }
  // block: only one block prefix at a time
  return others.some((o) => BLOCK_FORMATS.includes(o));
}

/**
 * Wrap `text` in the selected inline delimiters. `code` short-circuits to a
 * literal span. Returns `text` unchanged when no inline format is selected.
 */
export function composeInline(text: string, formats: FormatId[]): string {
  if (formats.includes("code")) return "`" + text + "`";
  let out = text;
  for (const id of INLINE_FORMATS) {
    if (formats.includes(id)) {
      const d = INLINE_DELIM[id];
      out = d + out + d;
    }
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
  formats: FormatId[]
): FormatChange[] {
  if (from > to) [from, to] = [to, from];
  if (from === to || formats.length === 0) return [];

  const changes: FormatChange[] = [];

  const inline = formats.filter(isInline);
  if (inline.length > 0) {
    const slice = doc.slice(from, to);
    changes.push({ from, to, insert: composeInline(slice, inline) });
  }

  const block = formats.find((f) => BLOCK_FORMATS.includes(f));
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
