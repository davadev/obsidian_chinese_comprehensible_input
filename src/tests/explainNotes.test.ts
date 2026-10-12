import { describe, expect, it, vi } from "vitest";
import { explainInputFor, explainKey, findExplainNote, saveExplainNote } from "../ai/explainNotes";

/** How the Explain dialog finds, names and writes its notes, and what it tells the model about the word. */

const entry = (over: Record<string, unknown> = {}): any => ({
  simplified: "行",
  traditional: "行",
  pinyin: "xíng",
  definitions: ["to walk", "OK"],
  ...over,
});

function deps(over: Record<string, any> = {}): any {
  const table: Record<string, any[]> = {
    方便: [entry({ simplified: "方便", traditional: "方便", pinyin: "fāng biàn", definitions: ["convenient"], hsk: { source: "2.0", levels: ["3"] } })],
    方: [entry({ pinyin: "fāng", definitions: ["square; direction; side"] })],
    便: [entry({ pinyin: "biàn", definitions: ["convenient"] }), entry({ pinyin: "pián", definitions: ["cheap"] })],
    行: [entry(), entry({ pinyin: "háng", definitions: ["row; profession"] })],
  };
  return {
    lookup: (s: string) => table[s] ?? [],
    bySurface: () => undefined,
    region: "mainland",
    scriptVariant: "simplified",
    countTraditionalMarkers: () => 0,
    ...over,
  };
}

describe("explainKey", () => {
  it("uses the record's key when the word has one, else builds it from the dictionary, else the surface", () => {
    expect(explainKey({ ...deps(), bySurface: () => ({ key: "k|1" }) as any }, "方便")).toBe("k|1");
    expect(explainKey(deps(), "方便")).toBe("方便|fang1 bian4");
    expect(explainKey(deps(), "囧")).toBe("囧");
  });
});

describe("explainInputFor", () => {
  it("collects the readings, a line per character with the reading this word uses, and the sentence", () => {
    const input = explainInputFor(deps(), "方便", "住在这里很方便。");
    expect(input).toEqual({
      surface: "方便",
      pinyin: "fāng biàn",
      traditional: "方便",
      hskLevels: ["3"],
      entries: [{ pinyin: "fāng biàn", definitions: ["convenient"] }],
      chars: [
        { char: "方", pinyin: "fāng", gloss: "square; direction; side" },
        { char: "便", pinyin: "biàn", gloss: "convenient" },
      ],
      sentence: "住在这里很方便。",
      script: "simplified",
    });
  });

  it("gives a single polyphone character the reading of the word, not the character's first one", () => {
    const d = deps({ lookup: (s: string) => (s === "行" ? [entry({ pinyin: "háng", definitions: ["row"] }), entry()] : []) });
    const input = explainInputFor(d, "行", undefined);
    expect(input.chars).toEqual([{ char: "行", pinyin: "háng", gloss: "row" }]);
    expect(input.entries.map((e) => e.pinyin)).toEqual(["háng", "xíng"]);
  });

  it("caps readings and definitions, and shortens a long gloss", () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({ pinyin: `x${i}`, definitions: Array.from({ length: 12 }, (_, j) => `d${j}`) }));
    const input = explainInputFor(deps({ lookup: () => many }), "行", undefined);
    expect(input.entries).toHaveLength(4);
    expect(input.entries[0].definitions).toHaveLength(8);
    const long = explainInputFor(deps({ lookup: () => [entry({ definitions: ["x".repeat(80)] })] }), "行", undefined);
    expect(long.chars[0].gloss).toHaveLength(40);
  });

  it("picks a character's gloss that says what it means, not 'surname' or 'variant of'", () => {
    const d = deps({
      lookup: (s: string) =>
        s === "方"
          ? [entry({ pinyin: "fāng", definitions: ["surname Fang", "variant of 芳", "square; direction"] })]
          : s === "便"
            ? [entry({ pinyin: "biàn", definitions: ["see 便宜"] }), entry({ pinyin: "pián", definitions: ["(surname) Bian", "cheap"] })]
            : s === "囧"
              ? [entry({ definitions: ["surname Jiong"] })]
              : [],
    });
    expect(explainInputFor(d, "方", undefined).chars[0].gloss).toBe("square; direction");
    expect(explainInputFor(d, "便", undefined).chars[0].gloss).toBe("cheap");
    // nothing better to say: the first definition is still better than none
    expect(explainInputFor(d, "囧", undefined).chars[0].gloss).toBe("surname Jiong");
  });

  it("falls back to the record when the dictionary lost the word, and to the character's own reading when pinyin does not split", () => {
    const rec: any = { traditional: "囧囧", hsk: { source: "x", levels: ["5"] }, pinyin: "jiǒng" };
    const none = explainInputFor(deps({ bySurface: () => rec }), "囧囧", "s");
    expect(none).toMatchObject({ pinyin: "jiǒng", traditional: "囧囧", hskLevels: ["5"], entries: [] });
    const unaligned = explainInputFor(deps({ lookup: (s: string) => (s === "玩儿" ? [entry({ simplified: "玩儿", pinyin: "wánr" })] : [entry({ pinyin: "wán" })]) }), "玩儿", undefined);
    expect(unaligned.chars.map((c) => c.pinyin)).toEqual(["wán", "wán"]);
    const bare = explainInputFor(deps(), "囧", undefined);
    expect(bare).toMatchObject({ pinyin: "", hskLevels: [], traditional: undefined, entries: [] });
    expect(bare.chars).toEqual([{ char: "囧", pinyin: "", gloss: "" }]);
  });

  it("chooses a script for the AI when the setting is automatic", () => {
    const d = deps({ scriptVariant: "auto", countTraditionalMarkers: (t: string) => (t.includes("學") ? 1 : 0) });
    expect(explainInputFor(d, "學習", undefined).script).toBe("traditional");
    expect(explainInputFor(d, "方便", undefined).script).toBe("simplified");
  });
});

function fakeApp(files: Array<{ path: string; ctime: number; fm?: Record<string, unknown> }>, existing: string[] = []) {
  const created: Array<[string, string]> = [];
  const folders = new Set<string>();
  const tfiles = files.map((f) => ({ path: f.path, stat: { ctime: f.ctime } }));
  const app: any = {
    vault: {
      getMarkdownFiles: () => tfiles,
      getAbstractFileByPath: (p: string) => (existing.includes(p) || folders.has(p) || created.some(([c]) => c === p) ? {} : null),
      createFolder: vi.fn(async (p: string) => void folders.add(p)),
      create: vi.fn(async (p: string, c: string) => (created.push([p, c]), { path: p })),
    },
    metadataCache: { getFileCache: (f: any) => ({ frontmatter: files.find((x) => x.path === f.path)?.fm }) },
  };
  return { app, created, folders };
}

describe("findExplainNote", () => {
  it("finds the note by the key in its frontmatter, wherever it lives, and prefers the newest", () => {
    const fm = { "cci-explain": true, "cci-word": "k" };
    const { app } = fakeApp([
      { path: "a/old.md", ctime: 1, fm },
      { path: "b/new.md", ctime: 5, fm },
      { path: "c/other.md", ctime: 9, fm: { "cci-explain": true, "cci-word": "other" } },
      { path: "d/plain.md", ctime: 9, fm: { "cci-word": "k" } },
      { path: "e/none.md", ctime: 9 },
    ]);
    expect(findExplainNote(app, "k")?.path).toBe("b/new.md");
    // the same, whichever order the vault lists them in
    const reversed = fakeApp([
      { path: "b/new.md", ctime: 5, fm },
      { path: "a/old.md", ctime: 1, fm },
    ]);
    expect(findExplainNote(reversed.app, "k")?.path).toBe("b/new.md");
    expect(findExplainNote(app, "missing")).toBeNull();
  });
});

describe("saveExplainNote", () => {
  it("creates the folder path and the note", async () => {
    const { app, created, folders } = fakeApp([]);
    const f = await saveExplainNote(app, "Chinese Learning/Generated/Explanations", "方便 fāng biàn.md", "# x");
    expect([...folders]).toEqual(["Chinese Learning", "Chinese Learning/Generated", "Chinese Learning/Generated/Explanations"]);
    expect(created).toEqual([["Chinese Learning/Generated/Explanations/方便 fāng biàn.md", "# x"]]);
    expect(f.path).toBe("Chinese Learning/Generated/Explanations/方便 fāng biàn.md");
  });

  it("never overwrites: a second version gets a number", async () => {
    const { app, created } = fakeApp([], ["Exp/行 xíng.md", "Exp/行 xíng 2.md", "Exp"]);
    await saveExplainNote(app, "Exp", "行 xíng.md", "body");
    expect(created[0][0]).toBe("Exp/行 xíng 3.md");
  });
});
