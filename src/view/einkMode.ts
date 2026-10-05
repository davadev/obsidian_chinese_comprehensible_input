/**
 * E-ink mode (#112): underlines instead of coloured tints, and in HSK colour
 * mode the level as a small number beside each word.
 *
 * Kept pure — no Obsidian, no real DOM — for the same reason
 * `annotationLines.ts` and `overflowMenuLayout.ts` are: the decisions in here
 * are arithmetic and attribute bookkeeping, and the repo has no DOM harness
 * (#119), so anything that can be tested without one should be.
 *
 * The CSS lives in styles.css between the `eink:begin` / `eink:end` markers and
 * is scoped under `.cci-view[data-eink]`, so everything here reduces to "is that
 * attribute on the view root, and what is `--cci-eink-number-scale`".
 */

/**
 * Bounds of the level-number size slider, as a percentage of its default.
 *
 * Measured, not chosen: over 11,250 layout combinations (reader font 12-48 px,
 * line spacing 0.15-1.5x, annotation size 50-200 %, all three display modes) the
 * number stays within 0.8x the character size up to 140 %, and 150 % is the first
 * value that breaks it. One step of margin gives 130.
 *
 * The lower bound is a preference, not a limit: beta.2 stopped at 80 and a tester
 * wanted the numbers smaller, so it goes to 50. At the default 22 px font that is
 * 6.05 px, which is the floor in styles.css (6 px) — so every slider position from
 * 50 up changes something at the default font. At small reader fonts the floor wins
 * and the low end does nothing; that is deliberate, since a digit smaller than 6 px
 * is not legible on any screen this feature is for.
 *
 * These are shared by the settings slider, the reading view's "…" menu and the
 * clamp below. The annotation-size slider duplicates its 50/200 in three places
 * and its own comment warns that the floor "must match the slider's"; sharing
 * constants removes that failure by construction.
 */
export const EINK_NUMBER_SCALE_MIN = 50;
export const EINK_NUMBER_SCALE_MAX = 130;
export const EINK_NUMBER_SCALE_STEP = 10;
export const EINK_NUMBER_SCALE_DEFAULT = 100;

/** Only a real boolean `true` turns it on, so a stray stored value degrades to
 *  OFF — the safe direction, since "off" is exactly how the plugin looked before. */
export function isEinkMode(settings: { einkMode?: unknown }): boolean {
  return settings.einkMode === true;
}

/**
 * Clamp a stored size to the slider's range.
 *
 * Needed as well as the slider's own bounds because a value can arrive from a
 * hand-edited data file. Anything that is not a finite number falls back to the
 * default rather than being passed on: `calc(NaN)` makes the whole `font-size`
 * declaration invalid, which silently leaves the number at the browser's
 * default size instead of failing visibly.
 */
export function clampEinkNumberScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return EINK_NUMBER_SCALE_DEFAULT;
  return Math.min(EINK_NUMBER_SCALE_MAX, Math.max(EINK_NUMBER_SCALE_MIN, value));
}

/** The slice of an element this module touches, so a test can pass a plain fake. */
export interface EinkRootLike {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(name: string, value: string): void };
}

/**
 * Put the current state on the reading view's root element.
 *
 * The attribute is REMOVED when off, never set to a falsy value: the CSS keys
 * on its presence, and `data-eink="false"` would still match `[data-eink]` and
 * turn the whole mode on.
 *
 * The size variable is written even when off. It is inert without the attribute,
 * and writing it unconditionally means switching the mode on needs no second
 * step.
 */
export function applyEinkToRoot(
  root: EinkRootLike,
  settings: { einkMode?: unknown; einkNumberScalePercent?: unknown }
): void {
  if (isEinkMode(settings)) root.setAttribute("data-eink", "");
  else root.removeAttribute("data-eink");
  root.style.setProperty(
    "--cci-eink-number-scale",
    String(clampEinkNumberScale(settings.einkNumberScalePercent) / 100)
  );
}
