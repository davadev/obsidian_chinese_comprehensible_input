/**
 * `~~strike~~` spans, written the way Obsidian reads them.
 *
 * The Markdown grammar the reader parses with (GFM) only treats `~~` as strikethrough when the text touches both
 * delimiters: `~~test~~` works, `~~test ~~` and `~~ test ~~` do not. Obsidian's own views are more forgiving and
 * strike those through, so a note that looks right everywhere else showed raw `~~` here. This finds the spans the
 * grammar leaves alone, so the renderer can hide the delimiters and strike the text itself.
 *
 * A span is `~~`, then text on one line that contains something other than spaces and no `~`, then `~~`.
 * Fenced code, inline code and math are the caller's business (it skips excluded ranges).
 */

export interface StrikeSpan {
  /** Start of the opening `~~`. */
  openFrom: number;
  /** Start of the struck text. */
  contentFrom: number;
  /** End of the struck text. */
  contentTo: number;
  /** End of the closing `~~`. */
  closeTo: number;
}

export function findLooseStrikeSpans(text: string, parsed: ReadonlyArray<{ from: number; to: number }> = []): StrikeSpan[] {
  const out: StrikeSpan[] = [];
  const re = /~~([^~\n]*[^~\s][^~\n]*)~~/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const openFrom = m.index;
    const closeTo = openFrom + m[0].length;
    // Already handled by the grammar (its own hidden marks and style): nothing to add.
    if (parsed.some((p) => openFrom < p.to && closeTo > p.from)) continue;
    out.push({ openFrom, contentFrom: openFrom + 2, contentTo: closeTo - 2, closeTo });
  }
  return out;
}
