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
});
