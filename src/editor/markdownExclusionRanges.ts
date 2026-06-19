/**
 * Returns disjoint excluded `[start, end)` ranges in the source where annotations
 * should NOT be applied: YAML frontmatter, fenced code, inline code, math blocks,
 * link URLs, HTML tags.
 *
 * Light implementation — sufficient for V1 annotation gating. Greedy / line-based.
 */
export interface Range {
  start: number;
  end: number;
}

export function computeExcludedRanges(text: string): Range[] {
  const out: Range[] = [];

  // YAML frontmatter at very top.
  if (text.startsWith("---\n")) {
    const close = text.indexOf("\n---", 4);
    if (close >= 0) out.push({ start: 0, end: close + 4 });
  }

  // Fenced code blocks ``` ... ``` and ~~~ ... ~~~
  pushFenced(out, text, "```");
  pushFenced(out, text, "~~~");

  // Inline code `...`
  pushInline(out, text, /`[^`\n]+`/g);

  // Math: $$...$$ and $...$
  pushFenced(out, text, "$$");
  pushInline(out, text, /\$[^$\n]+\$/g);

  // Link URL part: [text](URL)
  pushInline(out, text, /\]\(([^)]*)\)/g, 1);

  // HTML tags
  pushInline(out, text, /<\/?[a-zA-Z][^>]*>/g);

  return mergeRanges(out);
}

function pushFenced(out: Range[], text: string, fence: string): void {
  let i = 0;
  while (true) {
    const a = text.indexOf(fence, i);
    if (a < 0) break;
    const b = text.indexOf(fence, a + fence.length);
    if (b < 0) {
      out.push({ start: a, end: text.length });
      break;
    }
    out.push({ start: a, end: b + fence.length });
    i = b + fence.length;
  }
}

function pushInline(out: Range[], text: string, re: RegExp, group = 0): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (group === 0) {
      out.push({ start: m.index, end: m.index + m[0].length });
    } else {
      const innerStart = m.index + m[0].indexOf(m[group]);
      out.push({ start: innerStart, end: innerStart + m[group].length });
    }
  }
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return ranges;
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const out: Range[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function isInExcluded(ranges: Range[], pos: number): boolean {
  for (const r of ranges) {
    if (pos >= r.start && pos < r.end) return true;
    if (r.start > pos) break;
  }
  return false;
}

export function isRangeExcluded(ranges: Range[], start: number, end: number): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
    if (r.start >= end) break;
  }
  return false;
}
