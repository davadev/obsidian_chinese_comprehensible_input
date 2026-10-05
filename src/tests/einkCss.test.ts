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

  it("uses !important exactly once: the edit-mode guard", () => {
    const important = rules.filter((r) => r.body.includes("!important"));
    expect(important.length).toBe(1);
    expect(important[0].selectors.join(" ")).toContain('[contenteditable="true"]');
  });

  it("generates content for each HSK level 1-7, on both kinds of word", () => {
    for (let n = 1; n <= 7; n++) {
      const r = ruleWith(`.cci-color-hsk-${n}::after`);
      expect(r, `no number rule for hsk-${n}`).toBeTruthy();
      expect(r!.body).toContain(`content: "${n}"`);
      const sel = r!.selectors.join(" | ");
      // Plain words AND annotated words: dropping either loses the number there.
      expect(sel).toContain(`.cci-word:not(.cci-stack).cci-color-hsk-${n}::after`);
      expect(sel).toContain(`.cci-stack.cci-color-hsk-${n} .cci-stack-cells > .cci-stack-cell:last-child::after`);
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
    const stackAfter = rules.find((r) => r.selectors.some((s) => s.endsWith(".cci-stack-cell:last-child::after")) && r.body.includes("font-size"));
    expect(stackAfter!.body).toContain("font-size: var(--cci-eink-num)");
    const def = ruleWith(SC) && rules.find((r) => r.selectors.length === 1 && r.selectors[0] === SC);
    expect(def!.body).toContain("--cci-eink-num:");
    expect(def!.body).toContain("var(--cci-eink-number-scale");
  });

  it("keeps the plain-word number out of the line-height calculation", () => {
    // Measured at the slider's 0.15x minimum: `vertical-align: sub`, and a plain
    // relative offset, both grew the line; middle + line-height 0 does not.
    const r = rules.find((x) => x.selectors.some((s) => s.includes(":not(.cci-stack):is(") && s.endsWith("::after")))!;
    expect(r.body).toContain("line-height: 0");
    expect(r.body).toContain("vertical-align: middle");
    // Inline, NOT absolute: an absolutely positioned number belongs to the whole
    // line-spanning box and is stranded when a word wraps mid-word.
    expect(r.body).not.toContain("position: absolute");
  });

  it("does not generate content while the view is editable", () => {
    // Content beside a live caret shifts it (measured 7.3px at every word end).
    const g = rules.find((r) => r.body.includes("content: none"))!;
    expect(g.selectors.join(" ")).toContain('.cm-content[contenteditable="true"] .cci-word::after');
    expect(g.selectors.join(" ")).toContain('.cm-content[contenteditable="true"] .cci-stack-cell:last-child::after');
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
    const underline = rules.find((r) => r.selectors.some((s) => s.startsWith(`${SC} .cci-word:is(`)) && r.body.includes("border-bottom: 3px solid"))!;
    const text = underline.selectors.join(" ");
    for (const key of needed) expect(text, `no e-ink underline for .cci-color-${key}`).toContain(`.cci-color-${key}`);
  });
});
