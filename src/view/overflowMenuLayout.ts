/**
 * Where a toolbar popup menu sits vertically, and therefore how tall it may be.
 *
 * Both of the reading view's popup menus — the highlighter's "Formats" menu and
 * the toolbar's "…" More menu — are appended to `document.body`, positioned
 * `fixed`, and anchored just below the button that opened them. Neither was
 * clamped to the viewport, so a menu taller than the space below its anchor ran
 * off the bottom of the screen with no way to reach the last rows.
 *
 * The clamp itself is CSS (`max-height` in `dvh`, so the dynamic viewport and
 * the on-screen keyboard are handled without a listener). The one thing CSS
 * cannot know is how far down the anchor sits, which is what this module
 * computes. Kept pure — no DOM, no Obsidian — for the same reason
 * `annotationLines.ts` sits outside `chineseDecorations.ts`: it is arithmetic,
 * and arithmetic should be testable directly.
 *
 * The returned number is used TWICE by the caller — as the menu's `top` and as
 * the offset its `max-height` subtracts. That is deliberate: one value cannot
 * disagree with itself, whereas a separate "top" and "available height" pair
 * could drift apart.
 */

/** Space left below the menu so it never touches the bottom edge. */
export const OVERFLOW_MENU_GUTTER_PX = 12;

/**
 * Smallest height worth showing. If the space below the anchor is tighter than
 * this, the menu is lifted upward rather than squeezed into a sliver — the same
 * trade `WordPopup.position()` makes when a word sits near the bottom of the
 * screen.
 */
export const OVERFLOW_MENU_MIN_PX = 160;

/** Gap between the anchor button and the menu. Matches what the toolbar used. */
export const OVERFLOW_MENU_ANCHOR_GAP_PX = 4;

/**
 * Vertical offset for a menu opened under `anchorBottom`.
 *
 * Normally `anchorBottom + gap`. When that would leave less than
 * `OVERFLOW_MENU_MIN_PX` above the bottom gutter, the menu is lifted so the
 * minimum still fits — clamped at 0 so it never floats off the top.
 *
 * Both inputs come from `getBoundingClientRect()` / `window.innerHeight` and are
 * therefore attacker-free but not necessarily sane: a detached or hidden anchor
 * yields zeroes, and a freshly opened popout can report garbage. Non-finite or
 * negative values fall back to the top of the viewport rather than producing
 * `NaN` in a style property, which would silently drop the clamp entirely.
 */
export function overflowMenuTopPx(anchorBottom: number, viewportHeight: number): number {
  const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const bottom = Number.isFinite(anchorBottom) && anchorBottom > 0 ? anchorBottom : 0;
  const preferred = bottom + OVERFLOW_MENU_ANCHOR_GAP_PX;

  // The tallest top that still leaves the minimum usable height on screen.
  const latest = vh - OVERFLOW_MENU_GUTTER_PX - OVERFLOW_MENU_MIN_PX;
  if (latest <= 0) return 0; // Viewport shorter than the minimum: start at the top.
  return Math.max(0, Math.min(preferred, latest));
}
