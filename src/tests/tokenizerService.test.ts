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

function makeTokenizer(engine: "lattice" | "intl-segmenter" = "lattice") {
  return new TokenizerService(
    makeDict(),
    { hasRecord: () => false, knownBoost: () => 0 },
    () => ({ tokenizerEngine: engine }) as any
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

describe("TokenizerService — Intl.Segmenter engine", () => {
  // The whole tokenizeIntl path was unreached: the factory hardcoded
  // "lattice". Intl.Segmenter is native in Node, so no mocking is needed.
  it("segments Chinese text and marks word-like segments", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer("intl-segmenter");
    const tokens = await tokenizer.tokenize("今天学习");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((t) => t.surface).join("")).toBe("今天学习");
    expect(tokens.some((t) => t.isWord)).toBe(true);
  });

  it("emits contiguous offsets that reconstruct the input", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer("intl-segmenter");
    const text = "Hi 今天 ok";
    const tokens = await tokenizer.tokenize(text);
    let cursor = 0;
    for (const t of tokens) {
      expect(t.start).toBe(cursor);
      expect(text.slice(t.start, t.end)).toBe(t.surface);
      cursor = t.end;
    }
    expect(cursor).toBe(text.length);
  });

  it("scores confidence by how many dictionary candidates a segment has", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer("intl-segmenter");
    const tokens = await tokenizer.tokenize("今天");
    const known = tokens.find((t) => t.surface === "今天");
    expect(known?.confidence).toBe(0.95);
    expect(known?.selected?.pinyin).toBe("jīn tiān");

    const unknown = (await makeTokenizer("intl-segmenter").tokenize("xyz")).find(
      (t) => t.surface === "xyz"
    );
    expect(unknown?.confidence).toBe(0.3);
    expect(unknown?.selected).toBeUndefined();
  });
});

describe("TokenizerService — applyOverrides branches", () => {
  it("passes through tokens that have no override", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer();
    tokenizer.setOverrides([{ surface: "学习", splitInto: ["学", "习"] }]);
    const tokens = await tokenizer.tokenize("今天学习");
    // 今天 has no override and must survive untouched alongside the split.
    expect(tokens.map((t) => t.surface)).toEqual(["今天", "学", "习"]);
  });

  it("keeps an ignored token as a single token", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer();
    tokenizer.setOverrides([{ surface: "学习", ignore: true }]);
    const tokens = await tokenizer.tokenize("学习");
    expect(tokens.map((t) => t.surface)).toEqual(["学习"]);
  });

  it("falls through when an override neither ignores nor splits", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer();
    // mergeAs-only override: matched, but with nothing to do at this stage.
    tokenizer.setOverrides([{ surface: "学习", mergeAs: "学习" }]);
    const tokens = await tokenizer.tokenize("学习");
    expect(tokens.map((t) => t.surface)).toEqual(["学习"]);
  });

  it("falls through when splitInto is present but empty", async () => {
    clearTokenCache();
    const tokenizer = makeTokenizer();
    tokenizer.setOverrides([{ surface: "学习", splitInto: [] }]);
    const tokens = await tokenizer.tokenize("学习");
    expect(tokens.map((t) => t.surface)).toEqual(["学习"]);
  });
});
