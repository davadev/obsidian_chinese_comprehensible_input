import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Plain words and annotated words must be the same kind of box (#beta.10).
 *
 * Both are tinted by `.cci-word.cci-color-X`. A plain word used to be an inline element, whose background
 * is the font's content area (ascent + descent); an annotated word is an inline-block whose last row has
 * `line-height: 1`. The tints therefore ended on different lines, by an amount that depends on the font
 * (1 px in one, 13 px in a heading in another). `check:layout` measures that in a real browser; these pin
 * the rules that make it true so an edit to the stylesheet cannot quietly undo it.
 */

const css = readFileSync("styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = css.split("}").flatMap((chunk) => {
  const open = chunk.indexOf("{");
  if (open < 0) return [];
  return [{ selectors: chunk.slice(0, open).split(",").map((x) => x.trim()), body: chunk.slice(open + 1) }];
});
const rule = (sel: string) => rules.find((r) => r.selectors.includes(sel));

const PLAIN = ".cci-view .cci-word:not(.cci-stack)";
const EDIT = '.cci-view .cm-content[contenteditable="true"] .cci-word:not(.cci-stack)';

describe("a plain word is the same box as an annotated word's characters row", () => {
  it("is an inline-block with line-height 1, scoped away from stacks", () => {
    const r = rule(PLAIN);
    expect(r, "plain word rule").toBeTruthy();
    expect(r!.body).toMatch(/display:\s*inline-block/);
    expect(r!.body).toMatch(/line-height:\s*1\s*;/);
  });

  it("cancels its own margin box, so it cannot stretch a line at small line spacing", () => {
    // An inline-block's margin box counts towards the line's height (an inline element's does not).
    // Without this a heading line at 0.15x spacing went from 8.9px to 24.8px in the layout check.
    expect(rule(PLAIN)!.body).toMatch(/margin-block:\s*-1em/);
  });

  it("matches the annotated characters row it has to line up with", () => {
    const chars = rule(".cci-stack-chars")!;
    expect(chars.body).toMatch(/line-height:\s*1\s*;/);
    const stack = rules.find((r) => r.selectors.includes(".cci-stack") && /display:\s*inline-block/.test(r.body));
    expect(stack, "the stack is an inline-block").toBeTruthy();
  });

  it("is restored to live inline text while the view is editable, including its line-height", () => {
    const r = rule(EDIT);
    expect(r, "edit-mode guard").toBeTruthy();
    expect(r!.body).toMatch(/display:\s*inline\s*;/);
    // without this the guard would keep line-height: 1 on the live text and squash the editing line
    expect(r!.body).toMatch(/line-height:\s*inherit/);
    expect(r!.body).toMatch(/margin-block:\s*0/);
  });

  it("the guard is at least as specific as the rule it undoes", () => {
    // `.cm-content[contenteditable]` adds a class + an attribute over `.cci-view .cci-word:not(...)`.
    expect(EDIT.split(".cci-word")[0].length).toBeGreaterThan(PLAIN.split(".cci-word")[0].length);
  });

  it("does not touch the E-ink rule for numbered words (it sets the same display and its own guard)", () => {
    expect(css).toMatch(/\.cci-view\[data-eink\] \.cci-word:not\(\.cci-stack\):is\([^)]*\)\s*\{[^}]*display:\s*inline-block/);
  });
});
