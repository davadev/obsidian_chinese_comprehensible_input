// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { btn, flush, makeStats, q, qa, rec } from "./__mocks__/statsViewHarness";
import { extractSentenceAround } from "../ui/StatsView";

/**
 * The Flashcards tab (Unclassified and Due): which words are queued and in what order, how the card reveals the answer
 * step by step, where its example sentence comes from, and what each answer writes to the vocabulary and the schedule.
 */

installObsidianDom();
vi.mock("../ui/confirmInput", () => ({ confirmAsync: vi.fn(async () => true) }));

beforeEach(() => void (Notice.instances.length = 0));
afterEach(() => void (document.body.innerHTML = ""));

const fresh = (s: string, seen: number, over: Record<string, unknown> = {}) => rec(s, { status: "new", seenCount: seen, ...over });
const open = async (o: Parameters<typeof makeStats>[0] & { mode?: "unclassified" | "due" | "smart" } = {}) => {
  const m = makeStats({ ...o, settings: (s) => ((s.flashcardsMode = o.mode ?? "unclassified"), o.settings?.(s)) });
  await m.view.onOpen();
  m.view.setTab("flashcards");
  return m;
};
const term = (root: HTMLElement) => q(root, ".cci-triage-term").textContent;
const progress = (root: HTMLElement) => q(root, ".cci-triage-progress").textContent;

describe("the mode selector", () => {
  it("offers the three modes with the current one active, and switching resets the card and saves the choice", async () => {
    const { root, plugin, view } = await open({ records: [fresh("甲", 3)] });
    expect(qa(root, ".cci-fc-mode-btn").map((b) => b.textContent)).toEqual(["Unclassified", "Due", "Smart story"]);
    expect(q(root, ".cci-fc-mode-btn.is-active").textContent).toBe("Unclassified");
    view.triageIndex = 4;
    view.triageReveal = 2;
    btn(root, "Due").click();
    await flush();
    expect(plugin.settings.flashcardsMode).toBe("due");
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect([view.triageIndex, view.triageReveal, view.triagePartialAxes]).toEqual([0, 0, null]);
    expect(q(root, ".cci-fc-mode-btn.is-active").textContent).toBe("Due");
  });

  it("choosing the current mode does nothing, and choosing Smart story re-tests the connection", async () => {
    const { root, plugin, view } = await open({ settings: (s) => (s.ai.enabled = true) });
    btn(root, "Unclassified").click();
    await flush();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    view.smartReady = true;
    btn(root, "Smart story").click();
    await flush();
    expect(plugin.settings.flashcardsMode).toBe("smart");
    expect(plugin.ai.testConnection).toHaveBeenCalled();
  });
});

describe("the queue", () => {
  it("Unclassified: only new words, most seen first", async () => {
    const { root } = await open({ records: [fresh("乙", 2), fresh("甲", 9), rec("丙", { status: "known", seenCount: 50 })] });
    expect(term(root)).toBe("甲");
    expect(progress(root)).toBe("Word 1 of 2  ·  sorted by frequency");
  });

  it("Due: the SRS's due words, earliest due first, with unparseable dates treated as due now", async () => {
    const due = [
      rec("晚", { srs: { dueAt: "2026-03-01T00:00:00.000Z" } }),
      rec("早", { srs: { dueAt: "2026-01-01T00:00:00.000Z" } }),
      rec("无", { srs: undefined }),
      rec("坏", { srs: { dueAt: "not a date" } }),
    ];
    const { view } = await open({ mode: "due", due });
    expect(view.flashcardsQueue("due").map((r: any) => r.surfaces[0])).toEqual(["无", "坏", "早", "晚"]);
  });

  it("tells you what to do when the queue is empty, per mode", async () => {
    expect((await open()).root.textContent).toContain("No unclassified words in this scope.");
    document.body.innerHTML = "";
    expect((await open({ mode: "due" })).root.textContent).toContain("Nothing due right now.");
  });

  it("an index past the end of a shrunken queue goes back to the first card", async () => {
    const { view, root } = await open({ records: [fresh("甲", 3)] });
    view.triageIndex = 7;
    view.render();
    expect(term(root)).toBe("甲");
    expect(view.triageIndex).toBe(0);
  });

  it("Skip moves on, wraps around, and hides the answer again", async () => {
    const { view, root } = await open({ records: [fresh("甲", 3), fresh("乙", 2)] });
    view.triageReveal = 1;
    btn(root, "Skip →").click();
    expect(term(root)).toBe("乙");
    expect(view.triageReveal).toBe(0);
    btn(root, "Skip →").click();
    expect(term(root)).toBe("甲");
  });
});

describe("the card", () => {
  const card = (over: Record<string, unknown> = {}) => fresh("学习", 4, { pinyin: "xué xí", definitions: ["to study", "to learn", "third"], ...over });
  const lookup = (m: any) => (m.plugin.dictionary.lookup = vi.fn(() => [{ simplified: "学习", pinyin: "xué xí", definitions: ["x"] }]));

  it("starts with the characters and the count only, then reveals pinyin, then meaning (two at most)", async () => {
    const m = await open({ records: [card()] });
    lookup(m);
    m.view.render();
    expect(q(m.root, ".cci-triage-pinyin")).toBeNull();
    expect(q(m.root, ".cci-triage-stats").textContent).toBe("Seen 4×");
    btn(m.root, "Reveal pinyin").click();
    expect(q(m.root, ".cci-triage-pinyin").textContent).toBe("xué xí");
    expect(q(m.root, ".cci-triage-defs")).toBeNull();
    btn(m.root, "Reveal meaning").click();
    expect(q(m.root, ".cci-triage-defs").textContent).toBe("to study; to learn");
    expect(q(m.root, ".cci-triage-reveal")).toBeNull();
  });

  it("with no pinyin the first reveal is the meaning; with no meaning either there is nothing to reveal", async () => {
    const a = await open({ records: [card({ pinyin: undefined })] });
    expect(btn(a.root, /Reveal/).textContent).toBe("Reveal meaning");
    btn(a.root, "Reveal meaning").click();
    expect(q(a.root, ".cci-triage-defs")).toBeTruthy();
    document.body.innerHTML = "";
    const b = await open({ records: [card({ pinyin: undefined, definitions: [] })] });
    expect(q(b.root, ".cci-triage-reveal")).toBeNull();
  });

  it("a card with pinyin but no meaning stops after the pinyin", async () => {
    const m = await open({ records: [card({ definitions: undefined })] });
    lookup(m);
    m.view.render();
    btn(m.root, "Reveal pinyin").click();
    expect(q(m.root, ".cci-triage-reveal")).toBeNull();
  });

  it("shows the form the learner reads, not a converted one", async () => {
    const m = await open({ records: [card({ surfaces: ["學習", "学习"] })] });
    expect(term(m.root)).toBe("學習");
  });
});

describe("the example sentence", () => {
  const ctxRec = (notes: Record<string, number>) => fresh("学习", 5, { notesSeenCounts: notes, surfaces: ["学习", "學習"] });

  it("is cut from the note the word was seen in most, with the word picked out, and links to the note", async () => {
    const m = await open({ records: [ctxRec({ "a.md": 1, "b.md": 5 })], files: { "a.md": "别的。", "b.md": "今天。我喜欢学习汉语！明天。" } });
    await vi.waitFor(() => expect(q(m.root, ".cci-triage-hit")).toBeTruthy());
    expect(q(m.root, ".cci-triage-hit").textContent).toBe("学习");
    expect(q(m.root, ".cci-triage-context").textContent).toBe("我喜欢学习汉语！");
    expect(q(m.root, ".cci-triage-context-src").textContent).toBe("from b.md");
    q(m.root, ".cci-triage-context-src a").click();
    expect(m.plugin.app.workspace.openLinkText).toHaveBeenCalledWith("b.md", "", false);
  });

  it("the link does nothing for a note that has since gone", async () => {
    const m = await open({ records: [ctxRec({ "b.md": 5 })], files: { "b.md": "我学习。" } });
    await vi.waitFor(() => expect(q(m.root, ".cci-triage-hit")).toBeTruthy());
    m.files.delete("b.md");
    q(m.root, ".cci-triage-context-src a").click();
    expect(m.plugin.app.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("finds the word in another script, skips notes that cannot be read, and remembers the answer", async () => {
    const m = await open({ records: [ctxRec({ "bad.md": 9, "gone.md": 8, "a.md": 1 })], files: { "bad.md": "x", "a.md": "我學習。" } });
    m.plugin.app.vault.cachedRead.mockImplementation(async (f: any) => {
      if (f.path === "bad.md") throw new Error("unreadable");
      return m.files.get(f.path);
    });
    m.view.render();
    await vi.waitFor(() => expect(q(m.root, ".cci-triage-hit")).toBeTruthy());
    expect(q(m.root, ".cci-triage-hit").textContent).toBe("學習");
    const reads = m.plugin.app.vault.cachedRead.mock.calls.length;
    m.view.render();
    await vi.waitFor(() => expect(q(m.root, ".cci-triage-context-src")).toBeTruthy());
    expect(m.plugin.app.vault.cachedRead.mock.calls.length).toBe(reads);
  });

  it("says so when no note has a sentence with the word", async () => {
    const none = await open({ records: [ctxRec({ "a.md": 1 })], files: { "a.md": "没有这个词" } });
    await vi.waitFor(() => expect(q(none.root, ".cci-triage-context-none")).toBeTruthy());
    expect(q(none.root, ".cci-triage-context-none").textContent).toBe("No example sentence found.");
    document.body.innerHTML = "";
    const noNotes = await open({ records: [fresh("学习", 5)] });
    await vi.waitFor(() => expect(q(noNotes.root, ".cci-triage-context-none")).toBeTruthy());
  });

  it("a word with no key at all has no sentence to look for", async () => {
    const { view } = await open({ records: [fresh("学习", 1)] });
    expect(await view.loadTriageContext({ surfaces: [], key: "", simplified: undefined })).toBeNull();
  });
});

describe("answering", () => {
  const two = () => [fresh("甲", 9), fresh("乙", 3)];

  it.each([
    ["✓ Known", "known", "good"],
    ["✗ Unknown", "unknown", "again"],
  ])("%s sets the status and grades the review", async (label, status, grade) => {
    const m = await open({ records: two() });
    btn(m.root, label).click();
    expect(m.plugin.vocab.setStatus).toHaveBeenCalledWith("甲", status);
    expect(m.plugin.srs.applyGrade).toHaveBeenCalledWith("甲", grade);
    expect(m.plugin.refreshChineseViews).toHaveBeenCalled();
  });

  it("Ignore sets the status and leaves the schedule alone", async () => {
    const m = await open({ records: two() });
    btn(m.root, "Ignore").click();
    expect(m.plugin.vocab.setStatus).toHaveBeenCalledWith("甲", "ignored");
    expect(m.plugin.srs.applyGrade).not.toHaveBeenCalled();
  });

  it("a failing grade does not undo the answer", async () => {
    const m = await open({ records: two() });
    m.plugin.srs.applyGrade.mockImplementation(() => {
      throw new Error("srs down");
    });
    expect(() => btn(m.root, "✓ Known").click()).not.toThrow();
    expect(m.plugin.vocab.setStatus).toHaveBeenCalled();
  });

  it("moves on when the word left the queue, and steps past it when it stayed (as in Due mode)", async () => {
    const stay = [fresh("甲", 9), fresh("乙", 3)];
    const m = await open({ records: stay }); // the fake store never changes status: the word stays queued
    btn(m.root, "✓ Known").click();
    expect(term(m.root)).toBe("乙");
    const gone = await open({ records: [fresh("甲", 9), fresh("乙", 3)] });
    gone.records[0].status = "known";
    gone.view.advancePastIfPresent(undefined);
    expect(gone.view.triageIndex).toBe(0);
  });

  it("an empty queue after an answer resets the position; an index past the end wraps to the start", async () => {
    const m = await open({ records: [fresh("甲", 9)] });
    m.records.length = 0;
    m.view.triageIndex = 3;
    m.view.advancePastIfPresent("x");
    expect(m.view.triageIndex).toBe(0);
    m.records.push(fresh("甲", 1), fresh("乙", 1));
    m.view.triageIndex = 5;
    m.view.advancePastIfPresent("not-in-queue");
    expect(m.view.triageIndex).toBe(0);
  });

  it("forgets the cached sentence for the answered word", async () => {
    const m = await open({ records: two() });
    m.view.triageContextCache.set("甲", "{}");
    btn(m.root, "✗ Unknown").click();
    expect(m.view.triageContextCache.has("甲")).toBe(false);
  });
});

describe("Partial…", () => {
  const start = async (axes?: any) => {
    const m = await open({ records: [fresh("甲", 9, { axes }), fresh("乙", 3)] });
    btn(m.root, "? Partial…").click();
    return m;
  };
  const boxes = (root: HTMLElement) => qa(root, ".cci-triage-partial-box input") as HTMLInputElement[];

  it("opens an inline editor starting from the word's current axes (all clear when it has none)", async () => {
    const m = await start();
    expect(boxes(m.root).map((b) => b.checked)).toEqual([false, false, false]);
    document.body.innerHTML = "";
    const n = await start({ chars: true, pinyin: false, meaning: true });
    expect(boxes(n.root).map((b) => b.checked)).toEqual([true, false, true]);
    expect(q(n.root, ".cci-triage-partial-hint").textContent).toContain("Tick what you already know");
  });

  it("Save writes the ticked axes, grades it hard and closes the editor", async () => {
    const m = await start();
    boxes(m.root)[0].checked = true;
    boxes(m.root)[0].dispatchEvent(new Event("change"));
    boxes(m.root)[2].checked = true;
    boxes(m.root)[2].dispatchEvent(new Event("change"));
    btn(m.root, "Save").click();
    expect(m.plugin.vocab.setAxes).toHaveBeenCalledWith("甲", { chars: true, pinyin: false, meaning: true });
    expect(m.plugin.srs.applyGrade).toHaveBeenCalledWith("甲", "hard");
    expect(q(m.root, ".cci-triage-partial")).toBeNull();
    expect(m.plugin.refreshChineseViews).toHaveBeenCalled();
  });

  it("a failing grade does not lose the saved axes", async () => {
    const m = await start();
    m.plugin.srs.applyGrade.mockImplementation(() => {
      throw new Error("x");
    });
    expect(() => btn(m.root, "Save").click()).not.toThrow();
    expect(m.plugin.vocab.setAxes).toHaveBeenCalled();
  });

  it("Cancel closes it without writing anything", async () => {
    const m = await start();
    btn(m.root, "Cancel").click();
    expect(q(m.root, ".cci-triage-partial")).toBeNull();
    expect(m.plugin.vocab.setAxes).not.toHaveBeenCalled();
  });

  it("the editor belongs to its card: skipping to another word hides it", async () => {
    const m = await start();
    btn(m.root, "Skip →").click();
    expect(q(m.root, ".cci-triage-partial")).toBeNull();
  });
});

describe("extractSentenceAround", () => {
  it("cuts at sentence punctuation, keeps the closing mark, and locates the match inside", () => {
    const text = "你好。我喜欢学习汉语！再见。";
    const r = extractSentenceAround(text, text.indexOf("学习"));
    expect(r).toEqual({ text: "我喜欢学习汉语！", matchStart: 3 });
  });

  it("trims leading space and keeps the match offset right", () => {
    const text = "前。 学习很好";
    const r = extractSentenceAround(text, text.indexOf("学习"));
    expect(r.text).toBe("学习很好");
    expect(r.matchStart).toBe(0);
  });

  it("is capped to 200 characters either side when there is no punctuation", () => {
    const text = "字".repeat(500);
    const r = extractSentenceAround(text, 250);
    expect(r.text.length).toBe(400);
    expect(r.matchStart).toBe(200);
  });

  it("works at the very start and end of the text", () => {
    expect(extractSentenceAround("学习", 0)).toEqual({ text: "学习", matchStart: 0 });
    expect(extractSentenceAround("你好\n学习", 3)).toEqual({ text: "学习", matchStart: 0 });
  });
});
