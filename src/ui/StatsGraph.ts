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
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "cci-stats-graph");
  svg.setAttribute("viewBox", `0 0 ${days * 6} 80`);
  values.forEach((v, i) => {
    const h = Math.round((v / max) * 76);
    const r = document.createElementNS(svgNs, "rect");
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
