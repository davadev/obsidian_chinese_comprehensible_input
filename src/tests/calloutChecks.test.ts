import { describe, it, expect } from "vitest";
import { checkCallouts } from "../../scripts/lib/calloutChecks.mjs";

/**
 * Misaligned boxes and numbers were a repeated problem in the docs screenshots. render-screenshots.mjs feeds every scene's
 * measured geometry through checkCallouts, and CI fails on any problem (`npm run check:screenshots`).
 */

const item = (n: number, left: number, top: number, cx: number, cy: number, w = 60, h = 24) => ({
  n,
  box: { left, top, width: w, height: h },
  circle: { cx, cy },
});

describe("checkCallouts", () => {
  const ok = { width: 560, height: 200, items: [item(1, 20, 60, 40, 22), item(2, 120, 60, 150, 22), item(3, 220, 60, 530, 72)] };

  it("accepts sound callouts, and an image without any", () => {
    expect(checkCallouts(ok)).toEqual([]);
    expect(checkCallouts({ width: 560, height: 200, items: [] })).toEqual([]);
  });

  it("requires numbers 1..n in order", () => {
    const bad = { ...ok, items: [ok.items[0], { ...ok.items[1], n: 3 }] };
    expect(checkCallouts(bad).join("\n")).toMatch(/#2 is numbered 3/);
  });

  it("flags an empty box", () => {
    const bad = { ...ok, items: [item(1, 20, 60, 40, 22, 0, 24)] };
    expect(checkCallouts(bad).join("\n")).toMatch(/box is empty/);
  });

  it("flags a box or a circle outside the image", () => {
    expect(checkCallouts({ ...ok, items: [item(1, 520, 60, 40, 22)] }).join("\n")).toMatch(/box sticks out/);
    expect(checkCallouts({ ...ok, items: [item(1, 20, 60, 556, 22)] }).join("\n")).toMatch(/circle sticks out/);
  });

  it("flags overlapping circles", () => {
    const bad = { ...ok, items: [item(1, 20, 60, 40, 22), item(2, 120, 60, 50, 30)] };
    expect(checkCallouts(bad).join("\n")).toMatch(/1 and 2: the number circles overlap/);
  });

  it("flags a circle that covers another callout's box", () => {
    const bad = { ...ok, items: [item(1, 20, 60, 150, 70), item(2, 120, 60, 450, 22)] };
    expect(checkCallouts(bad).join("\n")).toMatch(/callout 1: its number circle covers the box of callout 2/);
  });
});
