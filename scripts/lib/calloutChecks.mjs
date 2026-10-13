// Geometry checks for the numbered callouts drawn by scripts/screenshots/entry.ts.
// Pure so src/tests/calloutChecks.test.ts can pin them; render-screenshots.mjs runs them on every scene.
//
// `report` = { width, height, items: [{ n, box: {left, top, width, height}, circle: {cx, cy} }] } in CSS px, origin at
// the page's top-left. Returns a list of human-readable problems; empty means the callouts are sound.

export const CIRCLE_DIAMETER = 26;
const TOLERANCE = 1;

const overlapsRect = (c, b) =>
  c.cx + CIRCLE_DIAMETER / 2 > b.left &&
  c.cx - CIRCLE_DIAMETER / 2 < b.left + b.width &&
  c.cy + CIRCLE_DIAMETER / 2 > b.top &&
  c.cy - CIRCLE_DIAMETER / 2 < b.top + b.height;

export function checkCallouts(report) {
  const { width, height, items } = report;
  const problems = [];
  if (!items.length) return problems;

  items.forEach((it, i) => {
    if (it.n !== i + 1) problems.push(`callout #${i + 1} is numbered ${it.n}: numbers must run 1..n in order, without gaps`);
    const { left, top, width: w, height: h } = it.box;
    if (w <= 0 || h <= 0) problems.push(`callout ${it.n}: its box is empty (${w}x${h}); the target is hidden or collapsed`);
    if (left < -TOLERANCE || top < -TOLERANCE || left + w > width + TOLERANCE || top + h > height + TOLERANCE)
      problems.push(`callout ${it.n}: its box sticks out of the ${width}x${height} image`);
    const r = CIRCLE_DIAMETER / 2;
    if (it.circle.cx - r < -TOLERANCE || it.circle.cy - r < -TOLERANCE || it.circle.cx + r > width + TOLERANCE || it.circle.cy + r > height + TOLERANCE)
      problems.push(`callout ${it.n}: its number circle sticks out of the ${width}x${height} image`);
  });

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].circle;
      const b = items[j].circle;
      if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < CIRCLE_DIAMETER)
        problems.push(`callouts ${items[i].n} and ${items[j].n}: the number circles overlap`);
    }
    for (let j = 0; j < items.length; j++) {
      if (i !== j && overlapsRect(items[i].circle, items[j].box))
        problems.push(`callout ${items[i].n}: its number circle covers the box of callout ${items[j].n}`);
    }
  }
  return problems;
}
