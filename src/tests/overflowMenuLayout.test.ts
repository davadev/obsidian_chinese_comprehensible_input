import { describe, it, expect } from "vitest";
import {
  OVERFLOW_MENU_ANCHOR_GAP_PX,
  OVERFLOW_MENU_GUTTER_PX,
  OVERFLOW_MENU_MIN_PX,
  overflowMenuTopPx,
} from "../view/overflowMenuLayout";

/**
 * The toolbar popup menus were unbounded and could run off the bottom of the
 * screen. The CSS clamp needs one number from JS — how far down the anchor sits —
 * and that number doubles as the menu's `top`, so it has to be sane for every
 * rect the DOM can hand us.
 */

describe("overflowMenuTopPx", () => {
  it("sits just under the anchor when there is room below", () => {
    expect(overflowMenuTopPx(80, 900)).toBe(80 + OVERFLOW_MENU_ANCHOR_GAP_PX);
  });

  it("leaves at least the minimum height on a short viewport", () => {
    // 667 tall (small phone), anchor low at 600: preferred top would be 604 and
    // leave 51px — unusable. Lift so the minimum still fits above the gutter.
    const top = overflowMenuTopPx(600, 667);
    expect(top).toBe(667 - OVERFLOW_MENU_GUTTER_PX - OVERFLOW_MENU_MIN_PX);
    expect(667 - top - OVERFLOW_MENU_GUTTER_PX).toBeGreaterThanOrEqual(OVERFLOW_MENU_MIN_PX);
  });

  it("never returns a top that pushes the menu off the bottom", () => {
    for (const vh of [400, 667, 812, 1200]) {
      for (const bottom of [0, 40, 90, 300, vh - 1, vh, vh + 500]) {
        const top = overflowMenuTopPx(bottom, vh);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(vh);
      }
    }
  });

  it("falls back to the top of the viewport when the viewport is tiny", () => {
    // Shorter than the minimum plus the gutter: nothing to lift toward, so start
    // at the top and let the menu scroll.
    expect(overflowMenuTopPx(40, 100)).toBe(0);
  });

  it("returns a finite number for the degenerate rects the DOM can produce", () => {
    // A detached or display:none anchor measures all zeroes; a freshly opened
    // popout has been seen to report nonsense. NaN in a style property would
    // silently drop the clamp, which is worse than being slightly too tall.
    for (const [bottom, vh] of [
      [NaN, 900],
      [0, 900],
      [-50, 900],
      [Infinity, 900],
      [80, NaN],
      [80, 0],
      [80, -10],
      [NaN, NaN],
    ] as const) {
      const top = overflowMenuTopPx(bottom, vh);
      expect(Number.isFinite(top)).toBe(true);
      expect(top).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats a non-finite anchor as the top of the viewport, not as a lift", () => {
    expect(overflowMenuTopPx(NaN, 900)).toBe(OVERFLOW_MENU_ANCHOR_GAP_PX);
  });
});
