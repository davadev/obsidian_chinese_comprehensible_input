import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { colorClassKey } from "../vocabulary/axes";
import type { WordRecord, WordStatus } from "../vocabulary/VocabularyTypes";

/**
 * The e-ink block in styles.css, pinned by text (#112).
 *
 * There is no browser in CI, so the layout itself is checked by
 * `npm run check:layout`. What CAN be checked here is the set of structural
 * decisions that each cost an experiment to find, and which a casual edit would
 * undo without anything else noticing. Each assertion names the failure it
 * guards.
 */

const raw = readFileSync("styles.css", "utf8");
const begin = raw.indexOf("/* eink:begin");
const end = raw.indexOf("/* eink:end */");
const block = begin >= 0 && end > begin ? raw.slice(begin, end) : "";
/** The block with comments removed: the header comment quotes the very selectors
 *  it warns against, so rules must be inspected without it. */
const css = block.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selectors: string[];
  body: string;
}

/** Split on top-level commas only — `:is(a, b)` contains commas of its own. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const rules: Rule[] = [];
for (const chunk of css.split("}")) {
  const open = chunk.indexOf("{");
  if (open < 0) continue;
  rules.push({ selectors: splitSelectors(chunk.slice(0, open)), body: chunk.slice(open + 1) });
}
const ruleWith = (needle: string) => rules.find((r) => r.selectors.some((s) => s.includes(needle)));
const SC = ".cci-view[data-eink]";
/** The one rule that draws the underline: a single `text-decoration` shorthand fed by --cci-eink-ul-* properties. */
const underlineRule = () => rules.find((r) => /(^|[;\s])text-decoration:\s*var\(--cci-eink-ul-line/.test(r.body))!;
/** Specificity of a selector as [classes + attributes + pseudo-classes, elements/pseudo-elements]. Enough for the
 *  selectors in this block: no ids, no type selectors, `:not()` / `:is()` counted by their argument. */
function specificity(sel: string): [number, number] {
  const flat = sel.replace(/:(not|is)\(([^()]*)\)/g, " $2 ");
  const pseudoEl = (flat.match(/::[a-z-]+/g) ?? []).length;
  const noEl = flat.replace(/::[a-z-]+/g, "");
  const classes = (noEl.match(/\.[A-Za-z_-][\w-]*/g) ?? []).length;
  const attrs = (noEl.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudoClass = (noEl.match(/:[a-z-]+/g) ?? []).length;
  return [classes + attrs + pseudoClass, pseudoEl];
}
const outranks = (a: string, b: string) => {
  const [x, y] = [specificity(a), specificity(b)];
  return x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
};

describe("e-ink CSS block", () => {
  it("exists, between the markers", () => {
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    expect(rules.length).toBeGreaterThan(10);
  });

  it("scopes EVERY selector under .cci-view[data-eink] — the off-means-off guarantee", () => {
    // With the attribute absent, nothing in the block can match. This is what the
    // layout check's "off is identical to main" result rests on.
    const unscoped = rules.flatMap((r) => r.selectors).filter((s) => !s.startsWith(SC));
    expect(unscoped).toEqual([]);
  });

  it("never uses substring class selectors", () => {
    // [class*="known"] also matches "unknown": the bug in the snippet this feature
    // replaced, and the one it was written to avoid.
    expect(css).not.toContain("[class*=");
    expect(css).not.toContain("[class^=");
    expect(css).not.toContain("[class$=");
  });

  it("clears the tint with background-color, never the `background` shorthand", () => {
    // The shorthand would also clear any background-image.
    expect(/(^|[;{\s])background\s*:/.test(css)).toBe(false);
    expect(css).toContain("background-color: transparent");
  });

  it("draws the underline as a text-decoration, never as a visible border", () => {
    // A border sits at the bottom of its box, and the two kinds of word have different boxes: the gap
    // is (ascent + descent - 1)/2 em of the font in use (1px in one font, ~5px in another), so no
    // fixed offset can align them. A text-decoration is drawn from the baseline by the same engine for
    // both. It also has no layout effect, where a thicker border grew the line.
    const deco = underlineRule();
    expect(deco, "no underline rule").toBeTruthy();
    // 3px thickness is the last part of the shorthand: line style colour thickness.
    expect(deco.body).toMatch(/text-decoration:[^;]*\)\s+3px;/);
    // Obsidian's CSS lint flags these longhands as partially supported; the shorthand with var() parts passes.
    expect(css).not.toMatch(/text-decoration-(line|style|color|thickness|skip-ink)\s*:/);
    expect(css).not.toMatch(/border-bottom:\s*\d+px\s+(solid|dotted)\s+(?!transparent)/);
  });

  it("places the underline from the reader font, identically on both kinds of word", () => {
    // Anchored to the BASELINE (default underline position + a px offset), never to a box edge: a box edge depends on
    // the font's ascent + descent, which put the number 3-10px off the underline in real CJK fonts. The number is
    // lowered by the same amount, so changing one without the other misaligns the digit.
    const deco = underlineRule();
    expect(deco.body).not.toContain("text-underline-position");
    expect(deco.body).toContain("text-underline-offset: var(--cci-eink-ul)");
    const def = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === SC)!;
    expect(def.body).toMatch(/--cci-eink-ul:\s*calc\(var\(--cci-reader-font\)/);
    // The number is lowered by the underline's offset plus its thickness.
    expect(def.body).toMatch(/--cci-eink-dn:\s*calc\(var\(--cci-eink-ul\) \+ 3px\)/);
    // Both kinds of word share ONE rule, so they cannot be given different offsets.
    expect(deco.selectors.some((x) => x.includes(".cci-word:not(.cci-stack)"))).toBe(true);
    expect(deco.selectors.some((x) => x.includes(".cci-stack-chars"))).toBe(true);
  });

  it("keeps the base 1px border, transparent, so layout is identical to colour mode", () => {
    // Setting it to `none` removed 1px from every annotated word (an inline-block: its border is part
    // of its height) and made lines 1px shorter in two/three-line mode at tight spacing.
    const tint = rules.find((r) => r.selectors.some((s) => s.startsWith(`${SC} .cci-word:is(`)) && r.body.includes("background-color"))!;
    expect(tint.body).toContain("border-bottom: 1px solid transparent");
  });

  it("underlines the characters row of an annotated word, never the word's own box", () => {
    // Declared on the inline-block, a decoration would also underline the pinyin and translation rows.
    const deco = underlineRule();
    const sels = deco.selectors;
    expect(sels.some((s) => s.includes(".cci-word:not(.cci-stack):is("))).toBe(true);
    expect(sels.some((s) => s.includes(".cci-stack:is(") && s.endsWith(".cci-stack-chars"))).toBe(true);
    // No decoration rule may select a .cci-stack on its own.
    for (const r of rules.filter((x) => /(text-decoration:|--cci-eink-ul-(line|style|color):)/.test(x.body))) {
      for (const s of r.selectors) {
        // `:not(.cci-stack)` is how the plain-word selector EXCLUDES annotated words; strip it before
        // asking whether a selector reaches one.
        const reachesAnnotated = s.replace(/:not\(\.cci-stack\)/g, "").includes(".cci-stack");
        if (reachesAnnotated) expect(s, "decoration on the annotated word's own box").toContain(".cci-stack-chars");
      }
    }
  });

  it("styles the status variants on both kinds of word", () => {
    for (const status of ["known", "partial", "new"]) {
      const r = rules.find((x) => x.selectors.some((s) => s.includes(`.cci-color-${status}:not(.cci-stack)`)))!;
      expect(r, `no ${status} rule`).toBeTruthy();
      expect(r.selectors.some((s) => s.includes(`.cci-stack.cci-color-${status} .cci-stack-chars`))).toBe(true);
      // The variant only sets the custom property the underline shorthand reads (no longhand, see above).
      expect(r.body).toMatch(/--cci-eink-ul-(color|style|line):/);
    }
  });

  it("uses no !important at all: every override is won by specificity or by a custom property", () => {
    // Obsidian's CSS lint rejects it. The two uses beta.1-0.7.8 shipped (the edit-mode guard and the grey
    // highlight) existed to beat INLINE styles; the guard now outranks by specificity and the colours arrive
    // as inline custom properties that the base rules read. styles.css as a whole is checked in cssLint.test.ts.
    expect(css).not.toContain("!important");
  });

  it("generates content for each HSK level 1-7, on both kinds of word", () => {
    for (let n = 1; n <= 7; n++) {
      const r = ruleWith(`.cci-color-hsk-${n}::after`);
      expect(r, `no number rule for hsk-${n}`).toBeTruthy();
      expect(r!.body).toContain(`content: "${n}"`);
      const sel = r!.selectors.join(" | ");
      // Plain words AND annotated words: dropping either loses the number there.
      expect(sel).toContain(`.cci-word:not(.cci-stack).cci-color-hsk-${n}::after`);
      expect(sel).toContain(`.cci-stack.cci-color-hsk-${n} .cci-stack-cells > .cci-stack-cell:last-child .cci-stack-chars::after`);
    }
  });

  it("anchors the annotated-word number to the LAST cell, never .cci-stack-cell-word", () => {
    // The per-character pinyin layout (line 2 = pinyin, syllables = characters —
    // almost every ordinary word, and the default) has no .cci-stack-cell-word, so
    // anchoring there shows no number in the most common configuration.
    expect(css).toContain(".cci-stack-cell:last-child");
    expect(css).not.toContain(".cci-stack-cell-word");
  });

  it("derives the number's size and its gutter from ONE variable", () => {
    // If they were separate values, raising the size would let the digit overlap
    // the next character — the specific failure a size slider introduces.
    const plain = ruleWith(".cci-word:not(.cci-stack):is(")!;
    const plainAfter = rules.find((r) => r.selectors.some((s) => s.includes("::after") && s.includes(":is(")) && r.body.includes("font-size"));
    expect(plainAfter!.body).toContain("font-size: var(--cci-eink-num)");
    expect(plain).toBeTruthy();
    const lastCell = rules.find((r) => r.selectors.some((s) => s.endsWith(".cci-stack-cell:last-child")));
    expect(lastCell!.body).toContain("padding-right: calc(var(--cci-eink-num)");
    const stackAfter = rules.find((r) => r.selectors.some((s) => s.endsWith(".cci-stack-chars::after")) && r.body.includes("font-size"));
    expect(stackAfter!.body).toContain("font-size: var(--cci-eink-num)");
    const def = ruleWith(SC) && rules.find((r) => r.selectors.length === 1 && r.selectors[0] === SC);
    expect(def!.body).toContain("--cci-eink-num:");
    expect(def!.body).toContain("var(--cci-eink-number-scale");
    // px from the reader font, NOT em: an em resolves where it is used, and the gutter (on the cell) and the digit
    // (on the characters row, 1.7x larger in a heading) would disagree and the digit would overlap the next word.
    expect(def!.body).toMatch(/--cci-eink-num:\s*max\(calc\(var\(--cci-reader-font\)/);
    expect(def!.body).not.toMatch(/--cci-eink-num:[^;]*\.55em/);
  });

  it("makes the number a zero-width atomic box lowered from the baseline, so it is not underlined and cannot change the line", () => {
    // A child cannot opt out of its parent's text-decoration, but a decoration is not propagated into atomic
    // inline-level boxes. Zero width: the gutter beside the word is what holds it, so layout does not depend on
    // the digit. Lowered with `top` (no layout effect), by the same amount as the underline offset.
    const r = rules.find((x) => x.selectors.some((q) => q.includes(":not(.cci-stack):is(") && q.endsWith("::after")))!;
    expect(r.body).toContain("display: inline-block");
    expect(r.body).toContain("width: 0");
    expect(r.body).toContain("position: relative");
    expect(r.body).toContain("top: var(--cci-eink-dn)");
    expect(r.body).toContain("line-height: 0");
    expect(r.body).not.toContain("position: absolute");
    expect(r.body).not.toContain("vertical-align");
    expect(r.body).not.toContain("text-decoration");
    // Both kinds of word share this rule, so they cannot be given different anchors.
    expect(r.selectors.some((q) => q.endsWith(".cci-stack-chars::after"))).toBe(true);
    // UI font: lining digits that sit on the baseline. Some CJK fonts' digits do not.
    expect(r.body).toContain("font-family: var(--font-interface");
  });

  it("makes a numbered plain word an atomic inline-block, and never white-space: nowrap on a span", () => {
    // beta.4 used nowrap on the word and in WebKit (iPhone) that removed the break opportunity between ADJACENT
    // words: a paragraph of numbered words had no legal break and scrolled sideways. An atomic box keeps the number
    // with its word AND leaves the line free to break around it. check:layout wraps adjacent words at every width.
    const r = rules.find((x) => x.selectors.length === 1 && x.selectors[0].includes(".cci-word:not(.cci-stack):is(") && x.body.includes("display: inline-block"))!;
    expect(r, "numbered plain word is not an inline-block").toBeTruthy();
    expect(r.body).toContain("padding-right: calc(var(--cci-eink-num)");
    // An inline-block's border counts toward its height (an inline's does not): it must be gone.
    expect(r.body).toContain("border-bottom: 0");
    expect(r.selectors[0]).not.toMatch(/cci-color-(known|partial|unknown|new)\b/);
    // No rule in the block may set nowrap on a word that sits in the flow of the line. (Inside the atomic box it is
    // harmless: the word's own rule above is the one allowed use.)
    for (const x of rules) {
      if (!x.body.includes("white-space: nowrap")) continue;
      expect(x.selectors.every((q) => q.includes(".cci-word:not(.cci-stack):is(") || q.endsWith("::after")), `nowrap on ${x.selectors.join(" | ")}`).toBe(true);
    }
  });

  it("restores a plain inline span while the view is editable", () => {
    // A box around live text disturbs the caret and selection.
    const r = rules.find((x) => x.selectors.some((q) => q.includes('.cm-content[contenteditable="true"] .cci-word:not(.cci-stack)')))!;
    expect(r.body).toContain("display: inline");
    expect(r.body).toContain("padding-right: 0");
  });

  it("uses no word joiner: the number is a separate atomic box", () => {
    expect(css).not.toContain("\\2060");
  });

  it("does not generate content while the view is editable, by specificity", () => {
    // Content beside a live caret shifts it (measured 7.3px at every word end). The guard has no !important, so it
    // must be MORE specific than the number rule it cancels, for both kinds of word.
    const g = rules.filter((r) => r.body.includes("content: none"));
    const guards = g.flatMap((r) => r.selectors);
    const plainGuard = guards.find((x) => x.includes('[contenteditable="true"]') && x.includes(".cci-word:not(.cci-stack)::after"))!;
    const stackGuard = guards.find((x) => x.includes('[contenteditable="true"]') && x.endsWith(".cci-stack-chars::after"))!;
    expect(plainGuard, "plain-word guard").toBeTruthy();
    expect(stackGuard, "annotated-word guard").toBeTruthy();
    for (let n = 1; n <= 7; n++) {
      const r = ruleWith(`.cci-color-hsk-${n}::after`)!;
      const plain = r.selectors.find((x) => x.includes(":not(.cci-stack).cci-color-hsk"))!;
      const stack = r.selectors.find((x) => x.endsWith(".cci-stack-chars::after"))!;
      expect(outranks(plainGuard, plain), `plain guard vs hsk-${n}`).toBe(true);
      expect(outranks(stackGuard, stack), `stack guard vs hsk-${n}`).toBe(true);
    }
  });

  it("covers every colour class the plugin can actually produce", () => {
    // Tied to the CODE, not to a list typed here: collect every key
    // colorClassKey() can return for any status and any HSK level, then require the
    // underline rule to name it. A status class added later fails here until the
    // e-ink CSS handles it.
    const statuses: WordStatus[] = [
      "new", "known", "unknown", "meaningKnownPinyinUnknown",
      "pinyinKnownMeaningUnknown", "charactersUnknown", "ignored",
    ];
    const produced = new Set<string>();
    for (const status of statuses) {
      const rec = { key: "k", surfaces: ["k"], status } as unknown as WordRecord;
      produced.add(colorClassKey(rec, "status", "both"));
    }
    produced.add(colorClassKey(undefined, "status", "both"));
    for (let level = 0; level <= 12; level++) {
      const rec = { key: "k", surfaces: ["k"], status: "unknown", hsk: { source: "3.0", levels: [String(level)] } } as unknown as WordRecord;
      produced.add(colorClassKey(rec, "hsk", "both"));
    }
    produced.add(colorClassKey(undefined, "hsk", "both"));
    // `ignored` is never decorated, and `hsk-none` never receives a colour class
    // (colorShouldShow returns false for it) — both are deliberately unmarked.
    const needed = [...produced].filter((k) => k !== "ignored" && k !== "hsk-none");
    expect(needed.length).toBeGreaterThanOrEqual(11);
    const underline = underlineRule();
    const text = underline.selectors.join(" ");
    for (const key of needed) expect(text, `no e-ink underline for .cci-color-${key}`).toContain(`.cci-color-${key}`);
  });

  it("draws every highlight in the one e-ink grey, beating the base rules by specificity", () => {
    // Coloured <mark>s and link widgets carry their colour as the inline custom property --cci-mark-bg (never an
    // inline background, which nothing could beat without !important); the stack band is a gradient fed by the
    // inline --cci-hl, so that one restyles background-image instead.
    const flat = ruleWith(`${SC} .cci-md-highlight`)!;
    expect(flat.selectors).toContain(`${SC} .cci-md-link-hl`);
    expect(flat.body).toMatch(/background-color:\s*var\(--cci-eink-highlight\);/);
    expect(flat.body).toMatch(/color:\s*#000;/);
    // outranks the base rules it overrides, including the link's :hover background
    // Strictly more specific, or a tie that the e-ink block wins by coming later in the file.
    for (const base of [".cci-view .cci-md-highlight", ".cci-view .cci-md-link-hl", ".cci-view .cci-md-wikilink:hover", ".cci-view .cci-word"]) {
      for (const sel of flat.selectors) {
        const [x, y] = [specificity(sel), specificity(base)];
        const stricter = x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
        const tie = x[0] === y[0] && x[1] === y[1];
        expect(stricter || (tie && raw.indexOf(base + " {") < begin), `${sel} vs ${base}`).toBe(true);
      }
    }
    const band = ruleWith(`${SC} .cci-stack-hl`)!;
    expect(band.body).toMatch(/background-image:\s*linear-gradient\(var\(--cci-eink-highlight\)/);
    expect(band.body).not.toContain("--cci-hl");
    expect(ruleWith(`${SC} {`) ?? rules.find((r) => r.body.includes("--cci-eink-highlight:"))).toBeTruthy();
  });

  it("keeps highlight text legible on the grey without touching the annotation rows", () => {
    const chars = ruleWith(`${SC} .cci-stack-hl .cci-stack-chars`)!;
    expect(chars.body).toContain("color: #000");
    // black on the pinyin / gloss rows would vanish on a dark theme
    expect(css).not.toMatch(/\.cci-stack-hl\s*\{[^}]*color:/);
  });

  it("draws the pinyin, translation and mnemonic rows black, with a dark-theme way out", () => {
    // Class rules suffice (the rows carry no inline colour; custom colours are root
    // properties), so this must not need !important - the count test above pins that.
    for (const prefix of ["", ".cci-view[data-eink]:is(.theme-dark .cci-view) "]) {
      const base = prefix.trim() || SC;
      const rule = rules.find((r) => r.selectors.includes(`${base} .cci-stack-pinyin`))!;
      expect(rule, `${prefix}pinyin rule`).toBeTruthy();
      for (const row of ["pinyin", "mnemonic", "gloss"]) expect(rule.selectors).toContain(`${base} .cci-stack-${row}`);
      expect(rule.body).toMatch(prefix ? /color:\s*var\(--text-normal\)/ : /color:\s*#000\b/);
    }
    // the characters row is not part of it
    expect(rules.some((r) => r.selectors.some((x) => /\.cci-stack-chars$/.test(x) && !x.includes("-hl")) && /(^|[;\s])color:/.test(r.body))).toBe(false);
  });
});
