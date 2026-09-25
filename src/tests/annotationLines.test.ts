import { describe, it, expect } from "vitest";
import {
  GLOSS_INLINE_MAX_CHARS,
  isContentVisible,
  resolveAnnotationLines,
  stripParentheticals,
  type AnnotationLineInput,
} from "../editor/annotationLines";
import { MNEMONIC_INLINE_MAX_GRAPHEMES } from "../vocabulary/mnemonicText";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { KnownAxes } from "../vocabulary/VocabularyTypes";

/**
 * The row model behind #56. The first block is the one that matters most: at
 * default settings this module must reproduce the fixed pinyin/English layout
 * the plugin has always had, or an upgrade silently rearranges every note.
 */

const NONE: KnownAxes = { chars: false, pinyin: false, meaning: false };
const ALL: KnownAxes = { chars: true, pinyin: true, meaning: true };

function input(over: Partial<AnnotationLineInput> = {}): AnnotationLineInput {
  return {
    mode: "three-line",
    line2Content: DEFAULT_SETTINGS.line2Content,
    line3Content: DEFAULT_SETTINGS.line3Content,
    isNew: true,
    axes: NONE,
    pinyin: "xué xí",
    definition: "to study",
    mnemonic: "",
    charCount: 2,
    stripGlossParentheticals: DEFAULT_SETTINGS.stripGlossParentheticals,
    ...over,
  };
}

describe("defaults reproduce the pre-#56 layout", () => {
  it("three-line puts English on top, pinyin below, aligned per character", () => {
    const out = resolveAnnotationLines(input());
    expect(out.line3).toEqual({ content: "english", text: "to study" });
    expect(out.line2).toEqual({ content: "pinyin", text: "xué xí" });
    expect(out.perCharPinyin).toBe(true);
  });

  it("two-line shows pinyin only", () => {
    const out = resolveAnnotationLines(input({ mode: "two-line" }));
    expect(out.line3).toBeUndefined();
    expect(out.line2?.content).toBe("pinyin");
  });

  it("none shows nothing", () => {
    const out = resolveAnnotationLines(input({ mode: "none" }));
    expect(out.line2).toBeUndefined();
    expect(out.line3).toBeUndefined();
    expect(out.perCharPinyin).toBe(false);
  });

  it("matches the old showPinyin / showGloss conditions exactly", () => {
    // Old: showPinyin = isNew || !axes.pinyin || !axes.chars
    //      showGloss  = three-line && (isNew || !axes.meaning)
    for (const isNew of [true, false]) {
      for (const chars of [true, false]) {
        for (const pinyin of [true, false]) {
          for (const meaning of [true, false]) {
            const axes = { chars, pinyin, meaning };
            const out = resolveAnnotationLines(input({ isNew, axes }));
            expect(!!out.line2).toBe(isNew || !pinyin || !chars);
            expect(!!out.line3).toBe(isNew || !meaning);
          }
        }
      }
    }
  });
});

describe("visibility follows the content, not the row", () => {
  it("English hides once the meaning is known, wherever it sits", () => {
    const known: KnownAxes = { chars: true, pinyin: false, meaning: true };
    const onLine3 = resolveAnnotationLines(input({ isNew: false, axes: known }));
    const onLine2 = resolveAnnotationLines(
      input({ isNew: false, axes: known, line2Content: "english", line3Content: "mnemonic" })
    );
    expect(onLine3.line3).toBeUndefined();
    expect(onLine2.line2).toBeUndefined();
  });

  it("pinyin keeps its own rule after being moved is not possible — line 2 only", () => {
    // Pinyin is restricted to line 2 by the type, so the only thing to check is
    // that its rule is unchanged when other content occupies line 3.
    const out = resolveAnnotationLines(
      input({ isNew: false, axes: { chars: true, pinyin: true, meaning: false }, line3Content: "mnemonic" })
    );
    expect(out.line2).toBeUndefined();
  });

  it("a mnemonic retires only once the word is fully known", () => {
    expect(isContentVisible("mnemonic", false, ALL)).toBe(false);
    expect(isContentVisible("mnemonic", false, { chars: true, pinyin: true, meaning: false })).toBe(true);
    expect(isContentVisible("mnemonic", true, ALL)).toBe(true);
  });
});

describe("rows with nothing to show are omitted", () => {
  it("drops the translation row when the word has no definition", () => {
    expect(resolveAnnotationLines(input({ definition: "" })).line3).toBeUndefined();
  });

  it("drops the mnemonic row when the word has no mnemonic", () => {
    const out = resolveAnnotationLines(input({ line3Content: "mnemonic" }));
    expect(out.line3).toBeUndefined();
    // …and keeps it when there is one.
    const withOne = resolveAnnotationLines(input({ line3Content: "mnemonic", mnemonic: "🌊🐟" }));
    expect(withOne.line3).toEqual({ content: "mnemonic", text: "🌊🐟" });
  });
});

describe("per-character pinyin alignment", () => {
  it("aligns when syllable count matches character count", () => {
    expect(resolveAnnotationLines(input({ pinyin: "xué xí", charCount: 2 })).perCharPinyin).toBe(true);
  });

  it("falls back to a single row when the counts disagree", () => {
    expect(resolveAnnotationLines(input({ pinyin: "xuéxí", charCount: 2 })).perCharPinyin).toBe(false);
    expect(resolveAnnotationLines(input({ pinyin: "a b c", charCount: 2 })).perCharPinyin).toBe(false);
  });

  it("is never true when line 2 is not pinyin", () => {
    const out = resolveAnnotationLines(input({ line2Content: "english", line3Content: "mnemonic" }));
    expect(out.perCharPinyin).toBe(false);
  });

  it("is false when the pinyin row is hidden", () => {
    const out = resolveAnnotationLines(input({ isNew: false, axes: ALL }));
    expect(out.perCharPinyin).toBe(false);
  });
});

describe("duplicate content is rendered, not blocked", () => {
  it("shows the same content on both rows", () => {
    // The settings tab warns rather than prevents, and import / sync bypass it
    // entirely, so this state is reachable and must not break rendering.
    const out = resolveAnnotationLines(
      input({ line2Content: "english", line3Content: "english" })
    );
    expect(out.line2?.content).toBe("english");
    expect(out.line3?.content).toBe("english");
  });
});

describe("stripParentheticals", () => {
  it("removes register and etymology notes", () => {
    expect(stripParentheticals("(Internet slang) thank you (loanword)")).toBe("thank you");
    expect(stripParentheticals("(Tw) A-choy, or Taiwanese lettuce (Lactuca sativa)")).toBe(
      "A-choy, or Taiwanese lettuce"
    );
  });

  it("keeps a trailing parenthetical's neighbours readable", () => {
    expect(stripParentheticals("9am–9pm, six days a week (work schedule)")).toBe(
      "9am–9pm, six days a week"
    );
  });

  it("handles full-width parentheses", () => {
    expect(stripParentheticals("（方言）to dawdle")).toBe("to dawdle");
  });

  it("returns the original when stripping would leave nothing", () => {
    // 0.82% of parenthesised CC-CEDICT definitions are nothing else; dropping
    // them would leave the word with no translation at all.
    expect(stripParentheticals("(used in place names)")).toBe("(used in place names)");
  });

  it("leaves a definition without parentheses untouched", () => {
    expect(stripParentheticals("to study")).toBe("to study");
  });
});

describe("inline text limits", () => {
  it("truncates a long translation", () => {
    const long = "a".repeat(80);
    const text = resolveAnnotationLines(input({ definition: long })).line3!.text;
    expect(text.length).toBeLessThanOrEqual(GLOSS_INLINE_MAX_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });

  it("applies the strip before the truncation when enabled", () => {
    const def = "(Internet slang) thank you (loanword)";
    const off = resolveAnnotationLines(input({ definition: def })).line3!.text;
    const on = resolveAnnotationLines(
      input({ definition: def, stripGlossParentheticals: true })
    ).line3!.text;
    expect(off.endsWith("…")).toBe(true);
    expect(on).toBe("thank you");
  });

  it("clamps an inline mnemonic far shorter than the card allows", () => {
    const long = "🌊".repeat(40);
    const text = resolveAnnotationLines(
      input({ line3Content: "mnemonic", mnemonic: long })
    ).line3!.text;
    expect([...text].length).toBeLessThanOrEqual(MNEMONIC_INLINE_MAX_GRAPHEMES + 1);
    expect(text.endsWith("…")).toBe(true);
  });

  it("leaves a short mnemonic unclamped and without an ellipsis", () => {
    const text = resolveAnnotationLines(
      input({ line3Content: "mnemonic", mnemonic: "🌊🐟" })
    ).line3!.text;
    expect(text).toBe("🌊🐟");
  });
});
