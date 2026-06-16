import { describe, it, expect } from "vitest";
import { TokenizerService } from "../tokenizer/TokenizerService";
import { DictionaryEntry } from "../dictionary/DictionaryTypes";
import { clearTokenCache } from "../tokenizer/tokenCache";

function makeDict() {
  const map = new Map<string, DictionaryEntry[]>([
    ["学习", [{ simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["study"] }]],
    ["学", [{ simplified: "学", traditional: "學", pinyin: "xué", definitions: ["learn"] }]],
    ["习", [{ simplified: "习", traditional: "習", pinyin: "xí", definitions: ["practice"] }]],
    ["今天", [{ simplified: "今天", traditional: "今天", pinyin: "jīn tiān", definitions: ["today"] }]],
  ]);
  return {
    ensureLoaded: async () => {},
    lookup: (s: string) => map.get(s) ?? [],
    surfaces: function* () {
      yield* map.keys();
    },
  } as any;
}

function makeTokenizer() {
  return new TokenizerService(
    makeDict(),
    { hasRecord: () => false, knownBoost: () => 0 },
    () => ({ tokenizerEngine: "lattice" }) as any
  );
}

describe("TokenizerService", () => {
  it("preserves non-CJK spans around tokenized Chinese text", async () => {
    const tokenizer = makeTokenizer();
    const tokens = await tokenizer.tokenize("Hi 学习 today");
    expect(tokens.map((t) => t.surface)).toEqual(["Hi ", "学习", " today"]);
    expect(tokens[0].isWord).toBe(false);
    expect(tokens[1].isWord).toBe(true);
    expect(tokens[2].isWord).toBe(false);
  });

  it("applies splitInto overrides on lattice tokens", async () => {
    const tokenizer = makeTokenizer();
    tokenizer.setOverrides([{ surface: "学习", splitInto: ["学", "习"] }]);
    const tokens = await tokenizer.tokenize("学习");
    expect(tokens.map((t) => t.surface)).toEqual(["学", "习"]);
    expect(tokens.every((t) => t.isWord)).toBe(true);
  });

  it("invalidates cached tokenization when overrides change", async () => {
    const tokenizer = makeTokenizer();
    clearTokenCache();
    const before = await tokenizer.tokenize("学习");
    tokenizer.setOverrides([{ surface: "学习", splitInto: ["学", "习"] }]);
    const after = await tokenizer.tokenize("学习");
    expect(before.map((t) => t.surface)).toEqual(["学习"]);
    expect(after.map((t) => t.surface)).toEqual(["学", "习"]);
  });
});
