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
 * Cumulative-area variant of `renderProgressGraph`. Each series is the
 * running total of its `count`s, so the curve climbs over time — a more
 * motivating progress view than per-period bars. Renders one filled
 * polygon + line per series, plus the legend.
 */
export function renderProgressArea(
  container: HTMLElement,
  series: { label: string; color: string; data: { label: string; count: number }[] }[]
): void {
  container.empty();
  if (series.length === 0 || series[0].data.length === 0) return;
  const buckets = series[0].data.map((d) => d.label);
  const n = buckets.length;
  const cumulative = series.map((s) => {
    let acc = 0;
    return s.data.map((d) => (acc += d.count));
  });
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

  const legend = activeDocument.createElement("div");
  legend.className = "cci-progress-legend";
  series.forEach((s, si) => {
    const item = activeDocument.createElement("span");
    item.className = "cci-progress-legend-item";
    const swatch = activeDocument.createElement("span");
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
  const legend = activeDocument.createElement("div");
  legend.className = "cci-progress-legend";
  for (const s of series) {
    const item = activeDocument.createElement("span");
    item.className = "cci-progress-legend-item";
    const swatch = activeDocument.createElement("span");
    swatch.className = "cci-progress-legend-swatch";
    swatch.style.background = s.color;
    item.appendChild(swatch);
    const total = s.data.reduce((a, b) => a + b.count, 0);
    item.appendChild(activeDocument.createTextNode(`${s.label} (${total})`));
    legend.appendChild(item);
  }
  container.appendChild(legend);
}
