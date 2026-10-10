import { HEADING_SCALE } from "./headingScale";

/**
 * Class list of the plain mark a word gets when it is not drawn as an annotated stack.
 *
 * A word inside a Markdown heading carries its level (`cci-word-h1` … `h4`). The tint is the mark's own
 * inline box, and the heading's larger font-size lives on a syntax-highlight span NESTED inside the mark,
 * so without the level the mark stays body-sized and the tint covers only the bottom of a larger word.
 * Annotated stacks have always done this with `cci-stack-h{n}`; plain marks did not. Levels 5 and 6 are
 * body size and get nothing.
 *
 * Pure so it can be tested: `chineseDecorations.ts` is excluded from unit-test coverage.
 */
export function wordMarkClass(opts: {
  /** Colour class key (`known`, `hsk-3` …); omit for the uncoloured mark that only makes a word clickable. */
  colorKey?: string;
  headingLevel: number;
}): string {
  const color = opts.colorKey ? ` cci-color-${opts.colorKey}` : "";
  const level = opts.headingLevel in HEADING_SCALE ? ` cci-word-h${opts.headingLevel}` : "";
  return `cci-word${color}${level}`;
}
