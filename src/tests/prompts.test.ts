import { describe, it, expect } from "vitest";
import {
  STORY_SCHEMA,
  STORY_SYSTEM_PROMPT,
  buildRepairPrompt,
  buildUserPrompt,
} from "../ai/prompts";

describe("STORY_SYSTEM_PROMPT", () => {
  it("requests only {title, targetLevel, textChinese} — and explicitly forbids extra keys", () => {
    expect(STORY_SYSTEM_PROMPT).toContain(
      '{"title":string,"targetLevel":string,"textChinese":string}'
    );
    // System prompt forbids glossary / checklist / notes (mentions the
    // words in negative context). We assert the negation, not the absence.
    expect(STORY_SYSTEM_PROMPT).toContain("Do not include a glossary");
    expect(STORY_SYSTEM_PROMPT).not.toContain("targetWordsUsed");
    expect(STORY_SYSTEM_PROMPT).not.toContain("notesForLearner");
  });

  it("nudges the model to reuse target words multiple times where natural", () => {
    expect(STORY_SYSTEM_PROMPT.toLowerCase()).toContain("more than once");
  });
});

describe("STORY_SCHEMA", () => {
  it("required keys are exactly title, targetLevel, textChinese", () => {
    expect(STORY_SCHEMA.required).toEqual(["title", "targetLevel", "textChinese"]);
  });

  it("does not expose extra keys via additionalProperties", () => {
    expect(STORY_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("buildUserPrompt", () => {
  const tw = [
    { word: "拉伸", pinyin: "lā shēn", definition: "to stretch" },
    { word: "苹果", pinyin: "píng guǒ", definition: "apple" },
  ];

  it("lists every target word with pinyin + definition", () => {
    const out = buildUserPrompt({
      script: "simplified",
      style: "story",
      targetHsk: "3",
      targetWords: tw,
      lengthChars: 400,
    });
    expect(out).toContain("拉伸");
    expect(out).toContain("lā shēn");
    expect(out).toContain("to stretch");
    expect(out).toContain("苹果");
    expect(out).toContain("apple");
  });

  it("nudges multi-use of each target word", () => {
    const out = buildUserPrompt({
      script: "simplified",
      style: "article",
      targetHsk: "4",
      targetWords: tw,
      lengthChars: 400,
    });
    expect(out.toLowerCase()).toMatch(/2-3 times|reuse a word/);
  });

  it("includes known-words block only when provided", () => {
    const noKnown = buildUserPrompt({
      script: "simplified",
      style: "story",
      targetHsk: "3",
      targetWords: tw,
      lengthChars: 400,
    });
    expect(noKnown).not.toContain("already knows");
    const withKnown = buildUserPrompt({
      script: "simplified",
      style: "story",
      targetHsk: "3",
      targetWords: tw,
      lengthChars: 400,
      knownWords: ["你好", "再见"],
    });
    expect(withKnown).toContain("already knows");
    expect(withKnown).toContain("你好");
  });
});

describe("buildRepairPrompt", () => {
  const missing = [
    { word: "拉伸", pinyin: "lā shēn", definition: "to stretch" },
    { word: "苹果", pinyin: "píng guǒ", definition: "apple" },
  ];
  const prior = [
    { textChinese: "今天我去公园散步。", missingCount: 12 },
    { textChinese: "今天我去公园散步，看见一只猫。", missingCount: 10 },
  ];

  it("renders every prior attempt with index + miss count", () => {
    const out = buildRepairPrompt({
      script: "simplified",
      priorAttempts: prior,
      missingTargetWords: missing,
      tooHardWords: [],
      targetHsk: "3",
      totalTargets: 12,
    });
    expect(out).toContain("Attempt 1");
    expect(out).toContain("Attempt 2");
    expect(out).toContain("missed 12 of 12");
    expect(out).toContain("missed 10 of 12");
    expect(out).toContain("今天我去公园散步。");
    expect(out).toContain("今天我去公园散步，看见一只猫。");
  });

  it("lists every missing word with pinyin + definition", () => {
    const out = buildRepairPrompt({
      script: "simplified",
      priorAttempts: prior,
      missingTargetWords: missing,
      tooHardWords: [],
      targetHsk: "3",
      totalTargets: 12,
    });
    expect(out).toContain("拉伸");
    expect(out).toContain("lā shēn");
    expect(out).toContain("to stretch");
    expect(out).toContain("苹果");
  });

  it("insists missing words appear verbatim inside textChinese", () => {
    const out = buildRepairPrompt({
      script: "simplified",
      priorAttempts: prior,
      missingTargetWords: missing,
      tooHardWords: [],
      targetHsk: "3",
      totalTargets: 12,
    });
    expect(out.toLowerCase()).toContain("verbatim");
  });

  it("returns shape directive matching trimmed STORY_SCHEMA", () => {
    const out = buildRepairPrompt({
      script: "simplified",
      priorAttempts: prior,
      missingTargetWords: missing,
      tooHardWords: [],
      targetHsk: "3",
      totalTargets: 12,
    });
    expect(out).toContain("{title, targetLevel, textChinese}");
    // Repair prompt may mention "glossary" only in the negative sense
    // ("does NOT count" if put in a glossary). The directive must call
    // out that a glossary substitution doesn't satisfy the requirement.
    expect(out).toContain("glossary");
    expect(out.toLowerCase()).toContain("does not count");
  });

  it("renders tooHardWords section when present", () => {
    const out = buildRepairPrompt({
      script: "simplified",
      priorAttempts: prior,
      missingTargetWords: missing,
      tooHardWords: ["搪瓷", "饕餮"],
      targetHsk: "3",
      totalTargets: 12,
    });
    expect(out).toContain("搪瓷");
    expect(out).toContain("饕餮");
  });
});

describe("script clause", () => {
  const tw3 = [{ word: "学习", pinyin: "xué xí", definition: "to study" }];

  it("asks for Simplified characters explicitly when Simplified is selected", () => {
    const out = buildUserPrompt({
      script: "simplified", style: "story", targetHsk: "3", targetWords: tw3, lengthChars: 400,
    });
    expect(out).toContain("Simplified characters");
    expect(out).toContain("Do not use Traditional forms");
  });

  it("asks for Traditional characters when Traditional is selected", () => {
    const out = buildUserPrompt({
      script: "traditional", style: "story", targetHsk: "3", targetWords: tw3, lengthChars: 400,
    });
    expect(out).toContain("Traditional characters");
    expect(out).toContain("Do not use Simplified forms");
  });

  it("asks for Taiwanese vocabulary, not just Traditional glyphs", () => {
    // Characters alone would give Mainland vocabulary in Traditional
    // clothing, which reads wrong to a Taiwan learner.
    const out = buildUserPrompt({
      script: "traditional", style: "story", targetHsk: "3", targetWords: tw3, lengthChars: 400,
    });
    expect(out).toContain("Taiwanese Mandarin");
    expect(out).toContain("網路");
  });

  it("carries the script through to the repair prompt", () => {
    const out = buildRepairPrompt({
      script: "traditional",
      priorAttempts: [{ textChinese: "…", missingCount: 1 }],
      missingTargetWords: tw3,
      tooHardWords: [],
      targetHsk: "3",
      totalTargets: 1,
    });
    expect(out).toContain("Traditional characters");
  });

  it("no longer hardcodes simplified in the repair prompt", () => {
    const out = buildRepairPrompt({
      script: "traditional",
      priorAttempts: [{ textChinese: "…", missingCount: 1 }],
      missingTargetWords: tw3,
      tooHardWords: [],
      targetHsk: "3",
      totalTargets: 1,
    });
    expect(out).not.toContain("exact simplified-Chinese surface form");
  });
});
