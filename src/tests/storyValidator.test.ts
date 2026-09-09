import { describe, it, expect } from "vitest";
import { validateStory, ValidatorConfig } from "../ai/StoryValidator";
import type { TokenizerService } from "../tokenizer/TokenizerService";
import type { Token } from "../tokenizer/tokenizerTypes";
import type { GeneratedStory } from "../ai/aiTypes";

/** Minimal tokenizer stub. Treats every Chinese character as its own word
 *  with no dictionary candidates — enough for validateStory's checks
 *  (the only thing it consults is `.surface`, `.isWord`, and optionally
 *  `.selected?.hsk?.levels`). */
function stubTokenizer(): TokenizerService {
  return {
    async tokenize(text: string): Promise<Token[]> {
      const out: Token[] = [];
      let i = 0;
      for (const ch of text) {
        if (/[一-鿿]/.test(ch)) {
          out.push({
            start: i,
            end: i + ch.length,
            surface: ch,
            isWord: true,
            candidates: [],
            confidence: 1,
          });
        }
        i += ch.length;
      }
      return out;
    },
  } as unknown as TokenizerService;
}

function stubTokenizerWithTokens(tokens: Token[]): TokenizerService {
  return {
    async tokenize(): Promise<Token[]> {
      return tokens;
    },
  } as unknown as TokenizerService;
}

const cfg: ValidatorConfig = { targetHsk: 0, lengthChars: 30, tooHardRatioCap: 0.15 };

function story(textChinese: string): GeneratedStory {
  return { title: "T", targetLevel: "3", textChinese };
}

describe("validateStory", () => {
  it("ok=true and empty missingWords when every target appears in textChinese", async () => {
    const r = await validateStory(
      story("我今天去公园看见一只苹果和拉伸运动。"),
      ["苹果", "拉伸"],
      stubTokenizer(),
      cfg
    );
    expect(r.missingWords).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.englishRatio).toBe(0);
  });

  it("missingWords lists targets absent from textChinese", async () => {
    const r = await validateStory(
      story("我今天去公园看见一只猫。"),
      ["苹果", "拉伸"],
      stubTokenizer(),
      cfg
    );
    expect(r.missingWords).toEqual(["苹果", "拉伸"]);
    expect(r.ok).toBe(false);
  });

  it("english-heavy text fails ok with englishRatio > 0.1", async () => {
    const r = await validateStory(
      story("Today I went to the park and saw 一只猫。"),
      ["猫"],
      stubTokenizer(),
      cfg
    );
    expect(r.englishRatio).toBeGreaterThan(0.1);
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => /English/i.test(n))).toBe(true);
  });

  it("score is clamped to [0, 1] and falls as missingWords grows", async () => {
    const all = await validateStory(
      story("我今天去公园看见一只苹果和拉伸运动。"),
      ["苹果", "拉伸"],
      stubTokenizer(),
      cfg
    );
    const some = await validateStory(
      story("我今天去公园看见一只猫。"),
      ["苹果", "拉伸"],
      stubTokenizer(),
      cfg
    );
    expect(all.score).toBeLessThanOrEqual(1);
    expect(all.score).toBeGreaterThanOrEqual(0);
    expect(some.score).toBeLessThan(all.score);
  });

  it("lengthOk reflects length but doesn't gate ok by itself", async () => {
    const text = "我今天去公园看见一只苹果和拉伸运动。"; // ~17 chars
    const r = await validateStory(story(text), ["苹果", "拉伸"], stubTokenizer(), {
      ...cfg,
      lengthChars: 400, // wildly off
    });
    expect(r.lengthOk).toBe(false);
    // missing list still empty (all targets present), so ok remains true
    expect(r.missingWords).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("returns notes describing each failure mode", async () => {
    const r = await validateStory(
      story("Today only English."),
      ["苹果"],
      stubTokenizer(),
      cfg
    );
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.some((n) => /Missing target/.test(n))).toBe(true);
  });

  it("flags too-hard non-target words above the HSK window", async () => {
    const r = await validateStory(
      story("苹果研究生"),
      ["苹果"],
      stubTokenizerWithTokens([
        {
          start: 0,
          end: 2,
          surface: "苹果",
          isWord: true,
          candidates: [],
          selected: { simplified: "苹果", traditional: "蘋果", pinyin: "píng guǒ", definitions: [], hsk: { source: "2.0", levels: ["2"] } },
          confidence: 1,
        },
        {
          start: 2,
          end: 5,
          surface: "研究生",
          isWord: true,
          candidates: [],
          selected: { simplified: "研究生", traditional: "研究生", pinyin: "yán jiū shēng", definitions: [], hsk: { source: "2.0", levels: ["6"] } },
          confidence: 1,
        },
      ]),
      { ...cfg, targetHsk: 3 }
    );
    expect(r.ok).toBe(true);
    expect(r.tooHardWords).toEqual(["研究生"]);
    expect(r.notes.some((n) => /too-hard words/i.test(n))).toBe(true);
  });
});

describe("validateStory — script handling", () => {
  const tokenizer = { tokenize: async () => [] } as unknown as TokenizerService;
  const cfg = { targetHsk: 0, lengthChars: 20, tooHardRatioCap: 0.15 };

  it("counts a target as present when written in the other script", async () => {
    // The model may answer in either script; the word is still there.
    const report = await validateStory(
      { title: "t", targetLevel: "3", textChinese: "我在圖書館學習中文" },
      [{ display: "学习", forms: ["学习", "學習"] }],
      tokenizer,
      cfg
    );
    expect(report.missingWords).toEqual([]);
  });

  it("still reports a genuinely absent target", async () => {
    const report = await validateStory(
      { title: "t", targetLevel: "3", textChinese: "我在家" },
      [{ display: "学习", forms: ["学习", "學習"] }],
      tokenizer,
      cfg
    );
    expect(report.missingWords).toEqual(["学习"]);
  });

  it("accepts a plain string target for backwards compatibility", async () => {
    const report = await validateStory(
      { title: "t", targetLevel: "3", textChinese: "我在学习中文" },
      ["学习"],
      tokenizer,
      cfg
    );
    expect(report.missingWords).toEqual([]);
  });

  it("flags a Simplified story when Traditional was requested", async () => {
    const report = await validateStory(
      { title: "t", targetLevel: "3", textChinese: "我在图书馆学习中文" },
      ["学习"],
      tokenizer,
      { ...cfg, script: "traditional", countTraditionalMarkers: () => 0 }
    );
    expect(report.notes.join(" ")).toContain("Traditional was requested");
  });

  it("does not flag a story that does contain traditional characters", async () => {
    const report = await validateStory(
      { title: "t", targetLevel: "3", textChinese: "我在圖書館學習中文" },
      ["學習"],
      tokenizer,
      { ...cfg, script: "traditional", countTraditionalMarkers: () => 5 }
    );
    expect(report.notes.join(" ")).not.toContain("Traditional was requested");
  });

  it("says nothing about script when Simplified was requested", async () => {
    const report = await validateStory(
      { title: "t", targetLevel: "3", textChinese: "我在图书馆学习中文" },
      ["学习"],
      tokenizer,
      { ...cfg, script: "simplified", countTraditionalMarkers: () => 0 }
    );
    expect(report.notes.join(" ")).not.toContain("Traditional was requested");
  });
});
