import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Obsidian's review lints styles.css, and `npm run lint` never did (it is ESLint over src/**\/*.ts). 0.7.8 shipped
 * 11 warnings from it: 8 `text-decoration` longhands and 3 `!important`. A hand-made grep list in check-release
 * only knew `box-decoration-break`, and a unit test even pinned the `!important`s as intended.
 *
 * The two rules are reproduced exactly (stylelint + stylelint-no-unsupported-browser-features targeting chrome 138,
 * plus declaration-no-important gave the review's 11 warnings at the same lines; the fixed file gives 0). They are
 * enforced here on every PR and in scripts/check-release.mjs on every release. Comments are blanked first: they
 * may talk about the forbidden things.
 */

const css = readFileSync("styles.css", "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const lines = code.split("\n");

const FORBIDDEN = [
  { name: "!important", re: /!\s*important/ },
  { name: "text-decoration longhand", re: /(^|[\s;{])text-decoration-(line|style|color|thickness|skip-ink|skip)\s*:/ },
];

describe("styles.css against the rules Obsidian's CSS lint enforces", () => {
  for (const { name, re } of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const at = lines.flatMap((l, i) => (re.test(l) ? [i + 1] : []));
      expect(at, `${name} at styles.css line(s) ${at.join(", ")}`).toEqual([]);
    });
  }

  it("check-release.mjs enforces the same two patterns (they are duplicated there on purpose)", () => {
    const script = readFileSync("scripts/check-release.mjs", "utf8");
    for (const { re } of FORBIDDEN) expect(script).toContain(re.source.replace(/\\/g, "\\"));
  });

  it("the checker itself catches what it is for", () => {
    const sample = ".a { color: red !important; }\n.b { text-decoration-line: none; }\n.c { text-decoration: underline; }\n/* text-decoration-color: x !important */\n";
    const blank = sample.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
    const hit = (re: RegExp) => blank.flatMap((l, i) => (re.test(l) ? [i + 1] : []));
    expect(hit(FORBIDDEN[0].re)).toEqual([1]);
    expect(hit(FORBIDDEN[1].re)).toEqual([2]);
  });

  it("the code that colours a highlight writes the custom property, never an inline background", () => {
    // An inline background could only be overridden with !important (E-ink mode needed two). These files need a
    // DOM harness to run (#119), so this is a text-level pin on the three call sites.
    const md = readFileSync("src/editor/markdownRendering.ts", "utf8");
    const deco = readFileSync("src/editor/chineseDecorations.ts", "utf8");
    expect(md).toContain("`--cci-mark-bg:${span.color};`");
    expect(md).toContain('el.style.setProperty("--cci-mark-bg", bg)');
    expect(deco).toContain("`--cci-mark-bg:${effHl};`");
    for (const [name, src] of [["markdownRendering.ts", md], ["chineseDecorations.ts", deco]] as const) {
      expect(src, `${name} writes an inline background`).not.toMatch(/background-color:\$\{|style\.backgroundColor\s*=/);
    }
  });

  it("the base rules read --cci-mark-bg, falling back to the plain highlight colour", () => {
    expect(css).toMatch(/\.cci-view \.cci-md-highlight\s*\{[^}]*background:\s*var\(--cci-mark-bg,\s*var\(--text-highlight-bg/);
    expect(css).toMatch(/\.cci-view \.cci-md-link-hl,\s*\.cci-view \.cci-md-link-hl:hover\s*\{[^}]*background-color:\s*var\(--cci-mark-bg\)/);
  });
});
