import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HEADING_SCALE } from "../editor/headingScale";
import { cciMarkdownHighlight } from "../editor/markdownHighlight";
import { wordMarkClass } from "../editor/wordMarkClass";

/**
 * A heading's character size is written in several places that cannot import from one another
 * (the CodeMirror HighlightStyle, and three groups of rules in styles.css). They drifted before
 * (`styles.css` itself said "nothing enforces it"); this makes drift a failing test.
 */

const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LEVELS = [1, 2, 3, 4] as const;

/** Body of the first rule whose selector list contains `selector` exactly. */
function ruleBody(selector: string): string {
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{");
    if (open < 0) continue;
    const sels = chunk.slice(0, open).split(",").map((x) => x.trim());
    if (sels.includes(selector)) return chunk.slice(open + 1);
  }
  throw new Error(`no rule for ${selector}`);
}

describe("heading scale: one table, every copy agrees", () => {
  it("the editor's HighlightStyle uses the table", () => {
    // HighlightStyle.specs holds the style definitions it was built from.
    const specs = (cciMarkdownHighlight as unknown as { specs: Array<{ fontSize?: string; tag: unknown }> }).specs;
    const sizes = specs.map((s) => s.fontSize).filter(Boolean);
    for (const lvl of LEVELS) expect(sizes, `h${lvl}`).toContain(`${HEADING_SCALE[lvl]}em`);
  });

  it.each(LEVELS)("styles.css: annotated characters at h%i", (lvl) => {
    expect(ruleBody(`.cci-stack-h${lvl} .cci-stack-chars`)).toMatch(new RegExp(`font-size:\\s*${HEADING_SCALE[lvl]}em`));
  });

  it.each(LEVELS)("styles.css: highlight band on an annotated word at h%i", (lvl) => {
    expect(ruleBody(`.cci-view .cci-stack-h${lvl}.cci-stack-hl`)).toMatch(
      new RegExp(`background-size:\\s*100%\\s*${HEADING_SCALE[lvl]}em`)
    );
  });

  it.each(LEVELS)("styles.css: plain word mark at h%i is sized from the reader font, not from its parent", (lvl) => {
    // Absolute on purpose. If the mark ever lands INSIDE the heading's own span, an `em` size would compound
    // (1.7 x 1.7). The beta.8 bug was a mark with no size of its own, tinting only body-text height.
    const body = ruleBody(`.cci-view .cci-word-h${lvl}`);
    expect(body).toMatch(new RegExp(`font-size:\\s*calc\\(var\\(--cci-reader-font\\)\\s*\\*\\s*${HEADING_SCALE[lvl]}\\)`));
    expect(body).not.toMatch(/font-size:\s*[\d.]+em/);
  });

  it.each(LEVELS)("styles.css: the heading span inside a word mark at h%i cannot compound the size", (lvl) => {
    expect(ruleBody(`.cci-view .cci-word-h${lvl} span`)).toMatch(/font-size:\s*inherit/);
  });
});

describe("wordMarkClass", () => {
  it("is the plain mark outside headings", () => {
    expect(wordMarkClass({ colorKey: "known", headingLevel: 0 })).toBe("cci-word cci-color-known");
    expect(wordMarkClass({ headingLevel: 0 })).toBe("cci-word");
  });

  it.each(LEVELS)("carries the level at h%i, with or without a colour", (lvl) => {
    expect(wordMarkClass({ colorKey: "hsk-3", headingLevel: lvl })).toBe(`cci-word cci-color-hsk-3 cci-word-h${lvl}`);
    expect(wordMarkClass({ headingLevel: lvl })).toBe(`cci-word cci-word-h${lvl}`);
  });

  it.each([5, 6, 7, -1, 1.5])("adds nothing for level %s (body size, or not a level)", (lvl) => {
    expect(wordMarkClass({ colorKey: "known", headingLevel: lvl })).toBe("cci-word cci-color-known");
  });

  it("puts the colour before the heading level", () => {
    expect(wordMarkClass({ colorKey: "unknown", headingLevel: 2 })).toBe("cci-word cci-color-unknown cci-word-h2");
  });
});

describe("the decoration plugin builds plain marks through wordMarkClass", () => {
  // chineseDecorations.ts needs a DOM harness to run (#119), so this is a text-level pin on the two call
  // sites, not a behavioural test: a hand-written class string there would bring the beta.8 bug back (no
  // heading level on the mark) and nothing else would notice.
  const src = readFileSync("src/editor/chineseDecorations.ts", "utf8");
  it("uses it for both the coloured and the uncoloured mark, and writes no mark class by hand", () => {
    expect(src.match(/class:\s*wordMarkClass\(/g)?.length).toBe(2);
    expect(src).not.toMatch(/class:\s*`cci-word[ `$]/);
  });
  it("passes the heading level the stack path already uses", () => {
    expect(src.match(/wordMarkClass\(\{[^}]*headingLevel[^}]*\}\)/g)?.length).toBe(2);
  });
});

