import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { StoryGenerator, type StoryPreview } from "../ai/StoryGenerator";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { VIEW_TYPE_CHINESE } from "../constants";

/**
 * The AI story pipeline end to end, with a scripted model: which words are sent (and in what order), how the answer
 * is parsed when the model does not return clean JSON, the validate-and-repair loop (best attempt wins, a failed repair
 * stops the loop, the wrong script is repaired too), and what is written to the vault and to the SRS schedule.
 */

const NOW = new Date("2026-10-10T12:00:00.000Z");

const rec = (surface: string, over: Record<string, unknown> = {}): any => ({
  key: `${surface}|x`,
  surfaces: [surface],
  simplified: surface,
  pinyin: "pin",
  definitions: ["one", "two", "three"],
  status: "unknown",
  seenCount: 0,
  recentSeenAt: [],
  dailySeenCounts: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const story = (text: string, over: Record<string, unknown> = {}) => JSON.stringify({ title: "T", targetLevel: "3", textChinese: text, ...over });

interface Opts {
  due?: any[];
  values?: any[];
  answers?: Array<string | Error>;
  settings?: (s: any) => void;
  maxRepair?: number;
  files?: Map<string, unknown>;
  tokens?: (text: string) => any[];
}

function make(o: Opts = {}) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.story.folder = "Chinese Learning/Generated";
  settings.story.sendKnownWords = false;
  o.settings?.(settings);
  const files = o.files ?? new Map<string, unknown>();
  const answers = [...(o.answers ?? [story("我喜欢学习汉语。")])];
  const chatJson = vi.fn(async () => {
    const a = answers.length > 1 ? answers.shift()! : answers[0];
    if (a instanceof Error) throw a;
    return a;
  });
  const ai: any = {
    chatJson,
    resolveActive: () => ({ active: { maxRepairIterations: o.maxRepair ?? 2, chatModel: "gpt-test" }, provider: "openai" }),
  };
  const tokenizer: any = { tokenize: vi.fn(async (t: string) => (o.tokens ? o.tokens(t) : [])) };
  const srs: any = { due: vi.fn(() => o.due ?? [rec("学习")]) };
  const vocab: any = { values: vi.fn(() => o.values ?? []), recordExposure: vi.fn(), updateSrs: vi.fn() };
  const created: Array<{ path: string; content: string }> = [];
  const folders: string[] = [];
  const app: any = {
    vault: {
      getAbstractFileByPath: vi.fn((p: string) => files.get(p) ?? null),
      createFolder: vi.fn(async (p: string) => void (files.set(p, { folder: true }), folders.push(p))),
      create: vi.fn(async (path: string, content: string) => {
        const f = Object.assign(new TFile(), { path });
        files.set(path, f);
        created.push({ path, content });
        return f;
      }),
      process: vi.fn(async (_f: unknown, fn: (s: string) => string) => void created.push({ path: "(process)", content: fn("") })),
    },
    fileManager: { renameFile: vi.fn(async () => {}), trashFile: vi.fn(async () => {}) },
    workspace: { getLeaf: vi.fn(() => ({ setViewState: vi.fn(async () => {}) })) },
  };
  const dict: any = { distinctTraditionalForms: () => 1, isTraditionalMarker: () => false };
  const gen = new StoryGenerator(app, ai, tokenizer, srs, vocab, () => settings, dict);
  return { gen, app, ai, chatJson, tokenizer, srs, vocab, settings, files, created, folders };
}
const req = (over: Record<string, unknown> = {}): any => ({ dueCount: 5, lengthChars: 20, style: "story", targetHsk: "3", includeGlossary: false, ...over });
const notices = () => Notice.instances.map((n) => n.message);
const userPrompt = (chatJson: ReturnType<typeof vi.fn>, call = 0) => chatJson.mock.calls[call][1] as string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  Notice.instances.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("choosing the words", () => {
  it("sends only classified due words, partly-known ones first, capped at the requested count", async () => {
    const due = [
      rec("甲", { status: "unknown" }),
      rec("乙", { status: "known" }),
      rec("丙", { status: "new" }),
      rec("丁", { status: "charactersUnknown" }),
      rec("戊", { status: "meaningKnownPinyinUnknown" }),
      rec("己", { status: "ignored" }),
      rec("庚", { status: "unknown" }),
    ];
    const { gen, chatJson } = make({ due, answers: [story("甲丁戊庚")] });
    const p = await gen.generatePreview(req({ dueCount: 3 }));
    expect(p.targets).toHaveLength(3);
    expect(p.targets.every((t) => ["charactersUnknown", "meaningKnownPinyinUnknown"].includes(t.status) || t.status === "unknown")).toBe(true);
    const firstTwo = p.targets.slice(0, 2).map((t) => t.status);
    expect(firstTwo).toEqual(expect.arrayContaining(["charactersUnknown", "meaningKnownPinyinUnknown"]));
    expect(p.targets[2].status).toBe("unknown");
    const prompt = userPrompt(chatJson);
    expect(prompt).not.toContain("乙");
    expect(prompt).not.toContain("丙");
  });

  it("tells the user when nothing is due, and can run again afterwards", async () => {
    const { gen, srs } = make({ due: [] });
    await expect(gen.generatePreview(req())).rejects.toThrow("No classified due words to review yet");
    srs.due.mockReturnValue([rec("学习")]);
    await expect(gen.generatePreview(req())).resolves.toBeTruthy();
  });

  it("refuses to start a second generation while one is running", async () => {
    let release!: (v: string) => void;
    const { gen, ai } = make();
    ai.chatJson.mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
    const first = gen.generatePreview(req());
    await expect(gen.generatePreview(req())).rejects.toThrow("Story generation is already running.");
    release(story("学习"));
    await first;
  });

  it("describes each word with its pinyin and the first two definitions, in the form the learner reads", async () => {
    const { gen, chatJson } = make({
      due: [rec("學習", { simplified: "学习", surfaces: ["學習", "学习"], pinyin: "xué xí", definitions: ["to study", "to learn", "ignored third"] })],
      answers: [story("學習")],
      settings: (s) => (s.scriptVariant = "auto"),
    });
    await gen.generatePreview(req());
    const prompt = userPrompt(chatJson);
    expect(prompt).toContain("學習 (xué xí) — to study; to learn");
    expect(prompt).not.toContain("ignored third");
  });

  it("copes with a word that has no pinyin or definitions", async () => {
    const { gen, chatJson } = make({ due: [rec("学习", { pinyin: undefined, definitions: undefined })], answers: [story("学习")] });
    await gen.generatePreview(req());
    expect(userPrompt(chatJson)).toContain("学习 () — ");
  });
});

describe("target HSK level", () => {
  const values = (levels: Array<[string, string]>) => levels.map(([lvl, status], i) => rec(`w${i}`, { status, hsk: lvl ? { source: "2.0", levels: [lvl] } : undefined }));

  it("treats a level that is not a number as 'any level' for the checks", async () => {
    const { gen, chatJson } = make({ answers: [story("学习")] });
    await expect(gen.generatePreview(req({ targetHsk: "advanced" }))).resolves.toBeTruthy();
    expect(userPrompt(chatJson)).toContain("HSK advanced");
  });

  it("uses the level asked for", async () => {
    const { gen, chatJson } = make({ answers: [story("学习")] });
    await gen.generatePreview(req({ targetHsk: "5" }));
    expect(userPrompt(chatJson)).toContain("HSK 5");
  });

  it("'auto' picks the highest level whose known share reaches the threshold", async () => {
    const { gen, chatJson, settings } = make({
      values: values([["1", "known"], ["1", "known"], ["2", "known"], ["2", "unknown"], ["3", "unknown"]]),
      answers: [story("学习")],
      settings: (s) => (s.story.knownCoverageThreshold = 0.5),
    });
    await gen.generatePreview(req({ targetHsk: "auto" }));
    expect(settings.story.knownCoverageThreshold).toBe(0.5);
    expect(userPrompt(chatJson)).toContain("HSK 2");
  });

  it("'auto' ignores ignored words, words without a level and, if asked, unclassified ones; it never goes below 1", async () => {
    const a = make({
      values: values([["3", "ignored"], ["", "known"], ["4", "new"], ["4", "new"]]),
      answers: [story("学习")],
      settings: (s) => ((s.statsExcludeNew = true), (s.story.knownCoverageThreshold = 0.1)),
    });
    await a.gen.generatePreview(req({ targetHsk: "auto" }));
    expect(userPrompt(a.chatJson)).toContain("HSK 1");
    const b = make({
      values: values([["4", "new"], ["4", "known"]]),
      answers: [story("学习")],
      settings: (s) => ((s.statsExcludeNew = false), (s.story.knownCoverageThreshold = 0.5)),
    });
    await b.gen.generatePreview(req({ targetHsk: "auto" }));
    expect(userPrompt(b.chatJson)).toContain("HSK 4");
  });
});

describe("the known-words sample", () => {
  const known = (n: number) => Array.from({ length: n }, (_, i) => rec(`词${i}`, { status: "known" }));

  it("is not sent unless asked for", async () => {
    const { gen, chatJson } = make({ values: known(10), answers: [story("学习")] });
    await gen.generatePreview(req());
    expect(userPrompt(chatJson)).not.toContain("already knows");
  });

  it("sends the configured share of known words", async () => {
    const { gen, chatJson } = make({
      values: [...known(10), rec("新", { status: "unknown" })],
      answers: [story("学习")],
      settings: (s) => ((s.story.sendKnownWords = true), (s.story.knownWordsSamplePercent = 50)),
    });
    await gen.generatePreview(req());
    const line = userPrompt(chatJson).split("\n").find((l) => l.startsWith("词"))!;
    expect(line.split("、")).toHaveLength(5);
    expect(userPrompt(chatJson)).not.toContain("新、");
  });

  it("defaults to 30 % when the share is missing, and keeps it between 1 and 100", async () => {
    const run = async (pct: unknown) => {
      const { gen, chatJson } = make({
        values: known(20),
        answers: [story("学习")],
        settings: (s) => ((s.story.sendKnownWords = true), (s.story.knownWordsSamplePercent = pct)),
      });
      await gen.generatePreview(req());
      return userPrompt(chatJson).split("\n").find((l) => l.startsWith("词"))!.split("、").length;
    };
    expect(await run(undefined)).toBe(6);
    expect(await run(0)).toBe(1);
    expect(await run(500)).toBe(20);
  });
});

describe("the repair loop", () => {
  const two = [rec("学习"), rec("汉语")];

  it("accepts a story that has every word without asking again", async () => {
    const { gen, chatJson } = make({ due: two, answers: [story("我学习汉语")] });
    const p = await gen.generatePreview(req());
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(p.iterations).toBe(0);
    expect(notices().at(-1)).toBe("Generated story: 2/2 target words included. Iterations used: 0/2.");
  });

  it("repairs a story that misses a word and keeps the better one", async () => {
    const { gen, chatJson } = make({ due: two, answers: [story("我学习"), story("我学习汉语")] });
    const p = await gen.generatePreview(req());
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(userPrompt(chatJson, 1)).toContain("汉语");
    expect(p.story.textChinese).toBe("我学习汉语");
    expect(p.iterations).toBe(1);
    expect(notices()).toContain("Story iter 1/2: 2/2 target words included");
  });

  it("keeps the earlier story when a repair is worse, and reports what is still missing", async () => {
    const { gen } = make({ due: two, maxRepair: 2, answers: [story("我学习"), story("没有")] });
    const p = await gen.generatePreview(req());
    expect(p.story.textChinese).toBe("我学习");
    expect(notices().at(-1)).toBe("Generated story: 1/2 target words included (missing: 汉语). Iterations used: 2/2.");
  });

  it("with equal misses, the higher score wins", async () => {
    const hard = (text: string) =>
      text.includes("难")
        ? [{ surface: "难词", isWord: true, selected: { hsk: { levels: ["6"] } } }]
        : [];
    const { gen } = make({ due: two, maxRepair: 1, answers: [story("我学习难"), story("我学习")], tokens: hard });
    const p = await gen.generatePreview(req({ targetHsk: "2" }));
    expect(p.story.textChinese).toBe("我学习");
  });

  it("stops after a repair that fails, says so, and returns the best story so far", async () => {
    const { gen, chatJson } = make({ due: two, maxRepair: 3, answers: [story("我学习"), new Error("429")] });
    const p = await gen.generatePreview(req());
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(notices()).toContain("Repair iteration failed: 429");
    expect(p.story.textChinese).toBe("我学习");
    expect(p.iterations).toBe(1);
  });

  it("does not repair at all when the limit is zero", async () => {
    const { gen, chatJson } = make({ due: two, maxRepair: 0, answers: [story("我学习")] });
    await gen.generatePreview(req());
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("a Traditional request answered in Simplified is repaired even when every word is present", async () => {
    const trad = (t: string) => t;
    void trad;
    const { gen, chatJson } = make({
      due: [rec("學習", { simplified: "学习", surfaces: ["學習"] })],
      settings: (s) => (s.scriptVariant = "traditional"),
      answers: [story("學習很好"), story("學習很好")],
    });
    gen["dict"].isTraditionalMarker = () => false;
    await gen.generatePreview(req());
    expect(chatJson.mock.calls.length).toBeGreaterThan(1);
  });

  it("lets a first failure of the model propagate, and frees the lock", async () => {
    const { gen } = make({ answers: [new Error("no network")] });
    await expect(gen.generatePreview(req())).rejects.toThrow("no network");
    await expect(gen.generatePreview(req())).rejects.toThrow("no network"); // not "already running"
  });
});

describe("reading the model's answer", () => {
  const run = async (raw: string) => {
    const m = make({ answers: [raw] });
    return { ...m, preview: await m.gen.generatePreview(req({ lengthChars: 30 })) };
  };
  const LONG = "这是一个很长的中文故事，我们每天都在学习汉语，因为学习汉语真的非常有趣，也很有用。";

  it("reads clean JSON, with or without a code fence", async () => {
    expect((await run(story("学习"))).preview.story.textChinese).toBe("学习");
    expect((await run("```json\n" + story("学习") + "\n```")).preview.story.textChinese).toBe("学习");
  });

  it("accepts `text` or `content` for the body and fills in a missing title", async () => {
    const a = await run(JSON.stringify({ text: "学习" }));
    expect(a.preview.story.textChinese).toBe("学习");
    expect(a.preview.story.title).toBe("复习故事");
    expect((await run(JSON.stringify({ content: "学习", title: "T" }))).preview.story.textChinese).toBe("学习");
  });

  it("passes through the optional fields a provider may add", async () => {
    const { preview } = await run(story("学习", { notesForLearner: "Line one\nLine two", glossary: [], targetWordsUsed: [] }));
    expect(preview.story.notesForLearner).toBe("Line one\nLine two");
  });

  it("rescues the text from JSON that is cut off", async () => {
    const { preview } = await run('{"title":"T","textChinese":"学习汉语","targetLe');
    expect(preview.story.textChinese).toBe("学习汉语");
    expect(notices()).toContain("Story parsed via regex fallback — open the dev console to see the raw response.");
  });

  it("rescues text from JSON that parses but has no body key", async () => {
    const { preview } = await run('{"title":"T","other":1} "textChinese": "学习"');
    expect(preview.story.textChinese).toBe("学习");
  });

  it("uses plain Chinese prose when there is no JSON at all", async () => {
    const { preview } = await run(LONG);
    expect(preview.story.textChinese).toContain("学习汉语");
    expect(notices()).toContain("Story parsed as raw Chinese — provider did not return JSON. Open the dev console to see the raw response.");
  });

  it("falls back to prose when the salvaged text has a bad escape", async () => {
    const { preview } = await run('"textChinese": "坏\\q" ' + LONG);
    expect(preview.story.textChinese).toContain("学习汉语");
  });

  it("falls through when the braces hold JSON that is not an object with a body", async () => {
    const { preview } = await run("null {} " + LONG);
    expect(preview.story.textChinese).toContain("学习汉语");
  });

  it("an empty answer points at the connection test", async () => {
    await expect(make({ answers: ["  "] }).gen.generatePreview(req())).rejects.toThrow("returned an empty response");
  });

  it("an answer that is not a story shows a snippet of what came back", async () => {
    await expect(make({ answers: ["Sorry, I cannot do that."] }).gen.generatePreview(req())).rejects.toThrow("invalid story JSON.\nRaw snippet:\nSorry, I cannot do that.");
    const long = "x".repeat(300);
    await expect(make({ answers: [long] }).gen.generatePreview(req())).rejects.toThrow(`${"x".repeat(120)}…${"x".repeat(120)}`);
  });
});

describe("what is written", () => {
  it("creates the folders and the preview file, with the frontmatter, the story and a real checklist", async () => {
    const { gen, created, folders, app } = make({
      due: [rec("学习"), rec("汉语", { surfaces: ["汉语", "漢語"] })],
      answers: [story("我学习漢語。", { notesForLearner: "Tip one\nTip two" })],
      maxRepair: 0,
    });
    const p = await gen.generatePreview(req());
    expect(folders).toEqual(["Chinese Learning", "Chinese Learning/Generated"]);
    expect(created).toHaveLength(1);
    expect(created[0].path).toBe("Chinese Learning/Generated/CCI Flashcards Preview.md");
    const md = created[0].content;
    expect(md).toContain("chinese_learning_generated: true");
    expect(md).toContain(`generated_at: ${NOW.toISOString()}`);
    expect(md).toContain("provider: openai");
    expect(md).toContain("model: gpt-test");
    expect(md).toContain("target_hsk: 3");
    expect(md).toContain("script: simplified");
    expect(md).toMatch(/target_words:\n {2}- (学习|汉语)\n {2}- (学习|汉语)\n/);
    expect(md).toMatch(/validation_score: \d\.\d{3}/);
    expect(md).toContain("# T");
    expect(md).toContain("- [x] 学习");
    expect(md).toContain("- [x] 汉语"); // present in the other script
    expect(md).toContain("> [!note] Notes for learner\n> Tip one\n> Tip two");
    expect(p.file.path).toBe("Chinese Learning/Generated/CCI Flashcards Preview.md");
    expect(app.vault.process).not.toHaveBeenCalled();
  });

  it("an empty title also gets the default heading", async () => {
    const { gen, created } = make({ answers: [JSON.stringify({ title: "", textChinese: "学习" })], maxRepair: 0 });
    await gen.generatePreview(req());
    expect(created[0].content).toContain("# 复习故事");
  });

  it("ticks only the words that are actually in the story, and titles an untitled one", async () => {
    const { gen, created } = make({ due: [rec("学习"), rec("汉语")], answers: [JSON.stringify({ textChinese: "只有学习" })], maxRepair: 0 });
    await gen.generatePreview(req());
    expect(created[0].content).toContain("# 复习故事");
    expect(created[0].content).toContain("- [x] 学习");
    expect(created[0].content).toContain("- [ ] 汉语");
    expect(created[0].content).not.toContain("Notes for learner");
  });

  it("states the script that was asked for, resolving 'auto' from the words", async () => {
    const trad = make({
      due: [rec("學習", { simplified: undefined })],
      settings: (s) => (s.scriptVariant = "auto"),
      answers: [story("學習")],
    });
    trad.gen["dict"].isTraditionalMarker = (c: string) => c === "學";
    await trad.gen.generatePreview(req());
    expect(trad.created[0].content).toContain("script: traditional");
  });

  it("overwrites the existing preview file in place", async () => {
    const files = new Map<string, unknown>([["Chinese Learning", { folder: true }], ["Chinese Learning/Generated", { folder: true }]]);
    const existing = Object.assign(new TFile(), { path: "Chinese Learning/Generated/CCI Flashcards Preview.md" });
    files.set(existing.path, existing);
    const { gen, app, created } = make({ files, answers: [story("学习")] });
    const p = await gen.generatePreview(req());
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(created[0].path).toBe("(process)");
    expect(p.file).toBe(existing);
  });

  it("treats a failing folder creation as a race that someone else won", async () => {
    const { gen, app } = make({ answers: [story("学习")] });
    app.vault.createFolder.mockRejectedValue(new Error("exists"));
    await expect(gen.generatePreview(req())).resolves.toBeTruthy();
  });

  it("an empty folder setting writes straight into the vault root", async () => {
    const { gen, folders, created } = make({ answers: [story("学习")], settings: (s) => (s.story.folder = "") });
    await gen.generatePreview(req());
    expect(folders).toEqual([]);
    expect(created[0].path).toBe("CCI Flashcards Preview.md");
  });
});

describe("side effects on the vocabulary", () => {
  it("records no exposure unless the setting says generated reading counts", async () => {
    const { gen, vocab } = make({ answers: [story("学习")], settings: (s) => (s.exposure.generatedReadingCountsAsExposure = false) });
    await gen.generatePreview(req());
    expect(vocab.recordExposure).not.toHaveBeenCalled();
  });

  it("records one exposure per target when it does", async () => {
    const { gen, vocab, settings } = make({
      due: [rec("学习"), rec("汉语")],
      answers: [story("学习汉语")],
      settings: (s) => (s.exposure.generatedReadingCountsAsExposure = true),
    });
    await gen.generatePreview(req());
    expect(vocab.recordExposure).toHaveBeenCalledTimes(2);
    expect(vocab.recordExposure).toHaveBeenCalledWith("学习", settings.exactTimestampRetentionLimit, settings.storeAllExactTimestamps);
  });

  it("pushes the due date of words that were due a day forward, and leaves words due later alone", async () => {
    const day = 86_400_000;
    const { gen, vocab } = make({
      due: [
        rec("学习", { srs: { dueAt: new Date(NOW.getTime() - day).toISOString() } }),
        rec("汉语", { srs: { dueAt: new Date(NOW.getTime() + 5 * day).toISOString() } }),
        rec("中文"),
        rec("今天", { srs: { dueAt: NOW.toISOString() } }),
      ],
      answers: [story("学习汉语中文今天")],
    });
    await gen.generatePreview(req());
    const due = new Date(NOW.getTime() + day).toISOString();
    expect(vocab.updateSrs.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(["中文", "今天", "学习"].sort());
    expect(vocab.updateSrs).toHaveBeenCalledWith("学习", { dueAt: due });
  });
});

describe("keeping a preview", () => {
  const preview = (over: Partial<StoryPreview> = {}): StoryPreview => ({
    story: { title: "好故事", targetLevel: "3", textChinese: "x" },
    targets: [],
    targetHsk: "3",
    score: 1,
    file: Object.assign(new TFile(), { path: "p.md" }),
    iterations: 0,
    ...over,
  });

  it("moves it into the story folder under today's date and its title", async () => {
    const { gen, app } = make();
    await gen.commitPreviewAsNote(preview());
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(expect.anything(), "Chinese Learning/Generated/2026-10-10 - 好故事.md");
  });

  it("numbers a second story with the same title", async () => {
    const files = new Map<string, unknown>([
      ["Chinese Learning/Generated/2026-10-10 - 好故事.md", {}],
      ["Chinese Learning/Generated/2026-10-10 - 好故事 (2).md", {}],
    ]);
    const { gen, app } = make({ files });
    await gen.commitPreviewAsNote(preview());
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(expect.anything(), "Chinese Learning/Generated/2026-10-10 - 好故事 (3).md");
  });

  it("strips characters a file name cannot hold, and falls back when nothing is left", async () => {
    const a = make();
    await a.gen.commitPreviewAsNote(preview({ story: { title: 'a/b:c*d?"e<f>g|h\\i', targetLevel: "", textChinese: "" } }));
    expect(a.app.fileManager.renameFile.mock.calls[0][1]).toBe("Chinese Learning/Generated/2026-10-10 - abcdefghi.md");
    const b = make();
    await b.gen.commitPreviewAsNote(preview({ story: { title: "///", targetLevel: "", textChinese: "" } }));
    expect(b.app.fileManager.renameFile.mock.calls[0][1]).toContain("Review Story.md");
    const c = make();
    await c.gen.commitPreviewAsNote(preview({ story: { title: "长".repeat(100), targetLevel: "", textChinese: "" } }));
    expect(c.app.fileManager.renameFile.mock.calls[0][1]).toBe(`Chinese Learning/Generated/2026-10-10 - ${"长".repeat(60)}.md`);
  });

  it("discarding trashes the preview and does not mind if it is already gone", async () => {
    const { gen, app } = make();
    await gen.deletePreview(preview());
    expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
    app.fileManager.trashFile.mockRejectedValue(new Error("gone"));
    await expect(gen.deletePreview(preview())).resolves.toBeUndefined();
  });

  it("generateAndSave generates, keeps it, and opens it in the Chinese view", async () => {
    const setViewState = vi.fn(async () => {});
    const { gen, app } = make({ answers: [story("学习")] });
    app.workspace.getLeaf.mockReturnValue({ setViewState });
    const saved = await gen.generateAndSave(req());
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CHINESE, state: { file: saved.path } });
  });
});
