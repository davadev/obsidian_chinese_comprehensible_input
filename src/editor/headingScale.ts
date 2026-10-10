/**
 * Character size of a Markdown heading relative to body text, by level. Levels 5 and 6 are body size
 * (they are only bold), so they are absent.
 *
 * This series is written out in `styles.css` as well — `.cci-stack-h{n} .cci-stack-chars`, the
 * highlight band on annotated words (`.cci-stack-h{n}.cci-stack-hl`) and the plain word marks
 * (`.cci-word-h{n}`) — because CSS cannot import a number. `headingScale.test.ts` reads the stylesheet
 * and fails when any copy drifts from this table, so changing a number here without the stylesheet
 * (or the reverse) fails in CI instead of showing up as a mis-sized tint on a reader's screen.
 */
export const HEADING_SCALE = { 1: 1.7, 2: 1.45, 3: 1.25, 4: 1.1 } as const;
