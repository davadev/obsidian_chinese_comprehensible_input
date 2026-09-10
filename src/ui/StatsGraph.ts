export function renderDailyGraph(container: HTMLElement, dailyCounts: Record<string, number>, days = 60): void {
  container.empty();
  const today = new Date();
  const labels: string[] = [];
  const values: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    labels.push(key);
    values.push(dailyCounts[key] ?? 0);
  }
  const max = Math.max(1, ...values);
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "cci-stats-graph");
  svg.setAttribute("viewBox", `0 0 ${days * 6} 80`);
  values.forEach((v, i) => {
    const h = Math.round((v / max) * 76);
    const r = activeDocument.createElementNS(svgNs, "rect");
    r.setAttribute("x", String(i * 6));
    r.setAttribute("y", String(80 - h));
    r.setAttribute("width", "4");
    r.setAttribute("height", String(h));
    r.setAttribute("fill", "currentColor");
    r.setAttribute("opacity", "0.65");
    svg.appendChild(r);
  });
  container.appendChild(svg);

}

export type Bucket = "day" | "week" | "month";

/**
 * Drop ISO timestamps into time buckets relative to today, return the last
 * `windowSize` buckets in chronological order with their counts. Missing
 * buckets render as zero so the chart stays evenly spaced.
 */
export function bucketTimestamps(
  stamps: (string | undefined)[],
  bucket: Bucket,
  windowSize: number
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const iso of stamps) {
    if (!iso) continue;
    const key = bucketKey(new Date(iso), bucket);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const labels = recentBucketLabels(bucket, windowSize);
  return labels.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

/**
 * How many stamps fall BEFORE the window `bucketTimestamps` would return.
 *
 * `bucketTimestamps` drops everything older than its first bucket, so a
 * cumulative chart built from it alone restarts its running total at zero on
 * every window — a learner whose classifying happened two months ago saw a flat
 * line on the floor in the 30-day view. This supplies the opening balance.
 *
 * The cutoff is an INSTANT, deliberately, rather than a comparison against the
 * first bucket's key: `yyyy-Www` week keys do not sort across a year boundary
 * ("2026-W01" < "2025-W52" lexically), so a string comparison would silently
 * miscount every January.
 */
export function countBeforeWindow(
  stamps: (string | undefined)[],
  bucket: Bucket,
  windowSize: number
): number {
  const cutoff = windowStart(bucket, windowSize);
  let n = 0;
  for (const iso of stamps) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    // Strictly before: NaN (an unparseable stamp) and future stamps both fail
    // this and are correctly left out of the opening balance.
    if (t < cutoff) n++;
  }
  return n;
}

/** Start instant of the oldest bucket `recentBucketLabels` would produce.
 *  Mirrors that function's arithmetic per bucket — including the UTC month
 *  construction it already uses, for the reason recorded there. */
function windowStart(bucket: Bucket, n: number): number {
  const today = new Date();
  if (bucket === "day") {
    const d = new Date(today.getTime() - (n - 1) * 86400000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (bucket === "month") {
    return Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (n - 1), 1);
  }
  return startOfIsoWeekUtc(new Date(today.getTime() - (n - 1) * 7 * 86400000));
}

/** Monday 00:00 UTC of the ISO week containing `d`. */
function startOfIsoWeekUtc(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (dayNum - 1));
  return t.getTime();
}

function bucketKey(d: Date, bucket: Bucket): string {
  if (bucket === "day") return d.toISOString().slice(0, 10);
  if (bucket === "month") return d.toISOString().slice(0, 7);
  // ISO week (week starting Monday). yyyy-Www format.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function recentBucketLabels(bucket: Bucket, n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  if (bucket === "day") {
    for (let i = n - 1; i >= 0; i--) {
      out.push(bucketKey(new Date(today.getTime() - i * 86400000), "day"));
    }
  } else if (bucket === "week") {
    for (let i = n - 1; i >= 0; i--) {
      out.push(bucketKey(new Date(today.getTime() - i * 7 * 86400000), "week"));
    }
  } else {
    // Build first-of-month in UTC. The local-time `new Date(yyyy, m, 1)`
    // form was rolling into the previous month under .toISOString() in any
    // positive-UTC timezone, producing labels that never matched
    // bucketKey()'s UTC YYYY-MM keys -> no bars rendered.
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)
      );
      out.push(bucketKey(d, "month"));
    }
  }
  return out;
}

/**
 * Reassurance for an empty Progress chart, or undefined when there is
 * something to plot.
 *
 * A first vault index inventories every Chinese word already in the notes, and
 * those are marked as a baseline rather than plotted — so a brand-new user's
 * chart is a flat line reading zero, under a card saying they have thousands of
 * words. That reads as breakage. It is not: the chart plots classifying, and
 * they have not classified anything yet.
 *
 * Pure, and separate from the rendering, because the tests run without a DOM
 * and this decision is the only part with any behaviour in it.
 */
export function progressEmptyHint(
  seriesTotals: number[],
  backfilledCount: number
): string | undefined {
  // No series selected is already handled by its own message; and anything
  // non-zero means the chart has a story to tell on its own.
  if (seriesTotals.length === 0) return undefined;
  if (seriesTotals.some((t) => t > 0)) return undefined;
  const base = "Nothing to plot yet — this chart fills in as you mark words known, partial or unknown.";
  return backfilledCount > 0
    ? `${base} The ${backfilledCount} words already found in your notes are counted on the cards above.`
    : base;
}

/**
 * Running total per bucket, opened at `prior`.
 *
 * Seeded, so the curve is a running total to DATE rather than a running total
 * within whatever window happens to be selected — the latter drew a flat line
 * on the floor for any learner whose work predated the window.
 *
 * Exported and separate from the rendering because the tests run without a DOM,
 * and this is the part with behaviour worth pinning.
 */
export function cumulativeCounts(data: { count: number }[], prior = 0): number[] {
  let acc = prior;
  return data.map((d) => (acc += d.count));
}

/**
 * Cumulative-area variant of `renderProgressGraph`. Each series is the
 * running total of its `count`s, so the curve climbs over time — a more
 * motivating progress view than per-period bars. Renders one filled
 * polygon + line per series, plus the legend.
 */
export function renderProgressArea(
  container: HTMLElement,
  series: {
    label: string;
    color: string;
    data: { label: string; count: number }[];
    /** Opening balance: events before the window, from countBeforeWindow().
     *  Optional so existing callers keep working; omitted means "start at 0",
     *  which is the pre-0.6.0 behaviour. */
    prior?: number;
  }[]
): void {
  container.empty();
  if (series.length === 0 || series[0].data.length === 0) return;
  const buckets = series[0].data.map((d) => d.label);
  const n = buckets.length;
  const cumulative = series.map((s) => cumulativeCounts(s.data, s.prior));
  const maxVal = Math.max(1, ...cumulative.flatMap((arr) => arr));
  const W = 600;
  const H = 100;
  const padX = 6;
  const padY = 12;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padY + innerH - (v / maxVal) * innerH;

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "cci-progress-graph");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");

  series.forEach((s, si) => {
    const pts = cumulative[si].map((v, i) => `${x(i)},${y(v)}`);
    const fillPts = [`${x(0)},${y(0)}`, ...pts, `${x(n - 1)},${y(0)}`];
    const fill = activeDocument.createElementNS(svgNs, "polygon");
    fill.setAttribute("points", fillPts.join(" "));
    fill.setAttribute("fill", s.color);
    fill.setAttribute("opacity", "0.22");
    svg.appendChild(fill);
    const line = activeDocument.createElementNS(svgNs, "polyline");
    line.setAttribute("points", pts.join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", s.color);
    line.setAttribute("stroke-width", "1.6");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);
    // End-point dot with tooltip.
    const last = cumulative[si][n - 1];
    const dot = activeDocument.createElementNS(svgNs, "circle");
    dot.setAttribute("cx", String(x(n - 1)));
    dot.setAttribute("cy", String(y(last)));
    dot.setAttribute("r", "2.5");
    dot.setAttribute("fill", s.color);
    const t = activeDocument.createElementNS(svgNs, "title");
    t.textContent = `${s.label}: ${last}`;
    dot.appendChild(t);
    svg.appendChild(dot);
  });

  // Sparse x-axis tick labels: first, last, midpoint.
  const tickIdx = [0, Math.floor(n / 2), n - 1];
  for (const i of tickIdx) {
    const t = activeDocument.createElementNS(svgNs, "text");
    t.setAttribute("x", String(x(i)));
    t.setAttribute("y", String(H - 2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "8");
    t.setAttribute("fill", "currentColor");
    t.setAttribute("opacity", "0.55");
    t.textContent = buckets[i];
    svg.appendChild(t);
  }

  container.appendChild(svg);

  const legend = container.createDiv();
  legend.className = "cci-progress-legend";
  series.forEach((s, si) => {
    const item = legend.createSpan();
    item.className = "cci-progress-legend-item";
    const swatch = item.createSpan();
    swatch.className = "cci-progress-legend-swatch";
    swatch.style.background = s.color;
    item.appendChild(swatch);
    item.appendChild(activeDocument.createTextNode(`${s.label} (${cumulative[si][n - 1]})`));
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

/**
 * Two-series bar chart (Tracked added, Learned). Both series share the same
 * Y axis. SVG only — no charting library.
 */
export function renderProgressGraph(
  container: HTMLElement,
  series: { label: string; color: string; data: { label: string; count: number }[] }[]
): void {
  container.empty();
  if (series.length === 0 || series[0].data.length === 0) return;
  const buckets = series[0].data.map((d) => d.label);
  const n = buckets.length;
  const maxVal = Math.max(
    1,
    ...series.flatMap((s) => s.data.map((d) => d.count))
  );
  const cellW = 12;
  const barW = Math.max(2, Math.floor((cellW - 2) / series.length));
  const W = n * cellW;
  const H = 100;
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "cci-progress-graph");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  series.forEach((s, si) => {
    s.data.forEach((d, i) => {
      const h = Math.round((d.count / maxVal) * (H - 14));
      const r = activeDocument.createElementNS(svgNs, "rect");
      r.setAttribute("x", String(i * cellW + si * barW + 1));
      r.setAttribute("y", String(H - 14 - h));
      r.setAttribute("width", String(barW));
      r.setAttribute("height", String(h));
      r.setAttribute("fill", s.color);
      r.setAttribute("opacity", "0.85");
      const title = activeDocument.createElementNS(svgNs, "title");
      title.textContent = `${d.label} · ${s.label}: ${d.count}`;
      r.appendChild(title);
      svg.appendChild(r);
    });
  });
  // Sparse x-axis tick labels: first, last, midpoint.
  const tickIdx = [0, Math.floor(n / 2), n - 1];
  for (const i of tickIdx) {
    const t = activeDocument.createElementNS(svgNs, "text");
    t.setAttribute("x", String(i * cellW + cellW / 2));
    t.setAttribute("y", String(H - 2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "8");
    t.setAttribute("fill", "currentColor");
    t.setAttribute("opacity", "0.55");
    t.textContent = buckets[i];
    svg.appendChild(t);
  }
  container.appendChild(svg);

  // Legend
  const legend = container.createDiv();
  legend.className = "cci-progress-legend";
  for (const s of series) {
    const item = legend.createSpan();
    item.className = "cci-progress-legend-item";
    const swatch = item.createSpan();
    swatch.className = "cci-progress-legend-swatch";
    swatch.style.background = s.color;
    item.appendChild(swatch);
    const total = s.data.reduce((a, b) => a + b.count, 0);
    item.appendChild(activeDocument.createTextNode(`${s.label} (${total})`));
    legend.appendChild(item);
  }
  container.appendChild(legend);
}

// ── Topic coverage radar ────────────────────────────────────────────────────

/**
 * Evenly spaced points on a circle, first at 12 o'clock, going clockwise.
 *
 * Exported and separate from the rendering because the tests run without a DOM,
 * and the geometry is the part with behaviour worth pinning.
 */
export function radarPoints(count: number, radius: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (count <= 0) return out;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return out;
}

/**
 * Hint shown instead of the chart when there is nothing to draw. A brand-new
 * vault would otherwise render a polygon collapsed to a dot at the origin,
 * which reads as a bug rather than as "no data yet".
 */
export function topicEmptyHint(spokes: { coverage: number; total: number }[]): string | undefined {
  if (spokes.length === 0) return "Pick at least one topic to see coverage.";
  if (spokes.some((s) => s.coverage > 0)) return undefined;
  if (spokes.every((s) => s.total === 0)) {
    return "No vocabulary in these topics yet.";
  }
  return "Nothing to plot yet — this chart fills in as you meet and mark words from these topics.";
}

export interface RadarSpoke {
  label: string;
  /** One value per series, in the same order as `opts.series`. */
  values: number[];
  max: number;
  lowData: boolean;
  tooltip: string;
}

/**
 * Radar canvas geometry. Exported so a test can assert the axis labels fit —
 * at 200 wide the longest label ("Character") ran to x~216 and the viewBox
 * silently clipped it.
 */
export const RADAR_LAYOUT = {
  width: 270,
  height: 200,
  radius: 70,
  /** Label anchor sits this far along the axis, as a multiple of the radius. */
  labelMult: 1.3,
  fontSize: 7.5,
  /** Rough advance width per character at `fontSize`, for the fit assertion. */
  charWidth: 7.5 * 0.55,
} as const;

export interface RadarSeries {
  label: string;
  color: string;
  /** Filled series read as the primary reading; outlines are context. */
  fill: boolean;
}

/**
 * Radar / spider chart of per-topic coverage.
 *
 * Square viewBox and no `preserveAspectRatio` override: the progress charts set
 * `none` because they stretch to the container width, but doing that here would
 * shear the polygon into an ellipse.
 */
export function renderTopicRadar(
  container: HTMLElement,
  spokes: RadarSpoke[],
  opts: {
    series: RadarSeries[];
    reference?: number;
    referenceLabel?: string;
  }
): void {
  container.empty();
  if (spokes.length === 0) return;

  const svgNs = "http://www.w3.org/2000/svg";
  // The canvas is wider than it is tall on purpose. The web itself is circular,
  // but the left/right axis labels extend horizontally — at 200 wide the
  // longest ("Character") ran to x≈216 and was clipped by the viewBox.
  const { width: W, height: H, radius: R } = RADAR_LAYOUT;
  const CX = W / 2;
  const CY = H / 2;
  const svg = activeDocument.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "cci-topic-radar");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");

  const pts = radarPoints(spokes.length, R);
  const at = (i: number, frac: number) => ({
    x: CX + pts[i].x * frac,
    y: CY + pts[i].y * frac,
  });

  // Grid rings at 25 / 50 / 75 / 100%.
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const ring = activeDocument.createElementNS(svgNs, "polygon");
    ring.setAttribute(
      "points",
      spokes.map((_, i) => `${at(i, frac).x.toFixed(1)},${at(i, frac).y.toFixed(1)}`).join(" ")
    );
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "currentColor");
    ring.setAttribute("stroke-width", "0.5");
    ring.setAttribute("opacity", frac === 1 ? "0.35" : "0.15");
    svg.appendChild(ring);
  }

  // Axis spokes.
  spokes.forEach((_, i) => {
    const line = activeDocument.createElementNS(svgNs, "line");
    line.setAttribute("x1", String(CX));
    line.setAttribute("y1", String(CY));
    line.setAttribute("x2", at(i, 1).x.toFixed(1));
    line.setAttribute("y2", at(i, 1).y.toFixed(1));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "0.5");
    line.setAttribute("opacity", "0.2");
    svg.appendChild(line);
  });

  // Reference ring — the learner's own mean, so bulges and dents read at a glance.
  if (typeof opts.reference === "number" && opts.reference > 0) {
    const frac = Math.max(0, Math.min(1, opts.reference));
    const ref = activeDocument.createElementNS(svgNs, "polygon");
    ref.setAttribute(
      "points",
      spokes.map((_, i) => `${at(i, frac).x.toFixed(1)},${at(i, frac).y.toFixed(1)}`).join(" ")
    );
    ref.setAttribute("fill", "none");
    ref.setAttribute("stroke", "currentColor");
    ref.setAttribute("stroke-width", "0.8");
    ref.setAttribute("stroke-dasharray", "3 2");
    ref.setAttribute("opacity", "0.45");
    const rt = activeDocument.createElementNS(svgNs, "title");
    rt.textContent = opts.referenceLabel ?? "your average";
    ref.appendChild(rt);
    svg.appendChild(ref);
  }

  // One polygon per series. Drawn widest-first so a larger outline never hides
  // the filled series inside it.
  const frac = (s: RadarSpoke, si: number) =>
    s.max > 0 ? Math.max(0, Math.min(1, (s.values[si] ?? 0) / s.max)) : 0;
  const order = opts.series
    .map((_, si) => si)
    .sort((a, b) => {
      const sum = (si: number) => spokes.reduce((acc, s) => acc + (s.values[si] ?? 0), 0);
      return sum(b) - sum(a);
    });

  for (const si of order) {
    const series = opts.series[si];
    const poly = activeDocument.createElementNS(svgNs, "polygon");
    poly.setAttribute(
      "points",
      spokes
        .map((s, i) => `${at(i, frac(s, si)).x.toFixed(1)},${at(i, frac(s, si)).y.toFixed(1)}`)
        .join(" ")
    );
    poly.setAttribute("fill", series.fill ? series.color : "none");
    if (series.fill) poly.setAttribute("opacity", "0.28");
    poly.setAttribute("stroke", series.color);
    poly.setAttribute("stroke-width", series.fill ? "1.4" : "1.1");
    if (!series.fill) poly.setAttribute("stroke-dasharray", "4 2");
    svg.appendChild(poly);
  }

  // Vertex dots on the primary (first) series carry the tooltip; a spoke with
  // too little data is drawn hollow.
  const primary = opts.series[0];
  spokes.forEach((s, i) => {
    const p = at(i, frac(s, 0));
    const dot = activeDocument.createElementNS(svgNs, "circle");
    dot.setAttribute("cx", p.x.toFixed(1));
    dot.setAttribute("cy", p.y.toFixed(1));
    dot.setAttribute("r", "2.4");
    dot.setAttribute("fill", s.lowData ? "var(--background-secondary)" : primary.color);
    dot.setAttribute("stroke", primary.color);
    dot.setAttribute("stroke-width", "1");
    const t = activeDocument.createElementNS(svgNs, "title");
    t.textContent = s.tooltip;
    dot.appendChild(t);
    svg.appendChild(dot);
  });

  // Labels outside the web, anchored by which side of the circle they sit on.
  spokes.forEach((s, i) => {
    const p = at(i, 1);
    const dx = p.x - CX;
    const dy = p.y - CY;
    const lx = CX + dx * RADAR_LAYOUT.labelMult;
    const ly = CY + dy * RADAR_LAYOUT.labelMult;
    const text = activeDocument.createElementNS(svgNs, "text");
    text.setAttribute("x", lx.toFixed(1));
    text.setAttribute("y", (ly + 2.5).toFixed(1));
    text.setAttribute("font-size", String(RADAR_LAYOUT.fontSize));
    text.setAttribute("fill", "currentColor");
    text.setAttribute("opacity", s.lowData ? "0.35" : "0.7");
    text.setAttribute(
      "text-anchor",
      Math.abs(dx) < 1 ? "middle" : dx > 0 ? "start" : "end"
    );
    text.textContent = s.label;
    const t = activeDocument.createElementNS(svgNs, "title");
    t.textContent = s.tooltip;
    text.appendChild(t);
    svg.appendChild(text);
  });

  container.appendChild(svg);

  const legend = container.createDiv();
  legend.className = "cci-progress-legend";
  for (const series of opts.series) {
    const item = legend.createSpan();
    item.className = "cci-progress-legend-item";
    const swatch = item.createSpan();
    swatch.className = "cci-progress-legend-swatch";
    swatch.style.background = series.color;
    // Class, not a static inline style: obsidianmd/no-static-styles-assignment
    // is an Error in the community-plugin review.
    if (!series.fill) swatch.classList.add("is-outline");
    item.appendChild(swatch);
    item.appendChild(activeDocument.createTextNode(series.label));
    legend.appendChild(item);
  }
  container.appendChild(legend);
}
