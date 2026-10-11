// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { btn, flush, makeStats, q, qa, rec } from "./__mocks__/statsViewHarness";

/**
 * The stats view's frame and its Dashboard cards: header and scope, tabs, the cards and their percentages (with and
 * without the unclassified words), the batch action, the per-note table, the comfort level, and what happens on close.
 */

installObsidianDom();

const confirm = vi.hoisted(() => ({ answer: true, asked: [] as string[] }));
vi.mock("../ui/confirmInput", () => ({
  confirmAsync: vi.fn(async (_a: unknown, msg: string) => {
    confirm.asked.push(msg);
    return confirm.answer;
  }),
}));

const known = (s: string, over: Record<string, unknown> = {}) => rec(s, { status: "known", axes: { chars: true, pinyin: true, meaning: true }, ...over });
const unknown = (s: string, over: Record<string, unknown> = {}) => rec(s, { status: "unknown", axes: { chars: false, pinyin: false, meaning: false }, ...over });
const partial = (s: string) => rec(s, { status: "meaningKnownPinyinUnknown", axes: { chars: true, pinyin: false, meaning: true } });
const cards = (root: HTMLElement) => Object.fromEntries(qa(root, ".cci-dash-card").map((c) => [q(c, ".cci-dash-card-label").textContent, q(c, ".cci-dash-card-value").textContent]));

beforeEach(() => {
  confirm.answer = true;
  confirm.asked.length = 0;
  Notice.instances.length = 0;
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("frame", () => {
  it("identifies itself", () => {
    const { view } = makeStats();
    expect([view.getViewType(), view.getDisplayText(), view.getIcon()]).toEqual(["cci-stats-view", "Chinese Vocabulary Stats", "bar-chart-3"]);
  });

  it("opens on the dashboard with a header, back button and three tabs", async () => {
    const { view, root, leaf } = makeStats();
    await view.onOpen();
    expect(root.classList.contains("cci-stats")).toBe(true);
    expect(qa(root, ".cci-stats-tab").map((t) => t.textContent)).toEqual(["Dashboard", "Flashcards", "Words"]);
    expect(q(root, ".cci-stats-tab.is-active").textContent).toBe("Dashboard");
    expect(q(root, ".cci-stats-title").textContent).toBe("Vocabulary stats");
    btn(root, "← Back").click();
    expect(leaf.detach).toHaveBeenCalled();
  });

  it("the tabs switch the body, and setTab does the same from code", async () => {
    const { view, root } = makeStats();
    await view.onOpen();
    btn(root, "Words").click();
    expect(q(root, ".cci-stats-controls")).toBeTruthy();
    expect(q(root, ".cci-stats-tab.is-active").textContent).toBe("Words");
    view.setTab("flashcards");
    expect(q(root, ".cci-triage")).toBeTruthy();
    view.setTab("dashboard");
    expect(q(root, ".cci-dash-grid")).toBeTruthy();
  });

  it("setTab before the view has a container just remembers the tab", () => {
    const { view } = makeStats();
    view.containerEl = { children: [] };
    expect(() => view.setTab("words")).not.toThrow();
    expect(view.tab).toBe("words");
  });

  it("the scope menu lists all vocabulary and every note with exposure, and a scope that is not among them", async () => {
    const { view, root } = makeStats({ records: [rec("学", { notesSeenCounts: { "a.md": 2, "b.md": 1 } })] });
    await view.onOpen();
    expect(qa(root, ".cci-stats-scope option").map((o) => o.textContent)).toEqual(["Scope: all vocabulary", "Note: a.md", "Note: b.md"]);
    view.noteScope = "gone.md";
    view.render();
    expect(qa(root, ".cci-stats-scope option").map((o) => o.textContent)).toContain("Note: gone.md");
    expect((q(root, ".cci-stats-scope") as HTMLSelectElement).value).toBe("gone.md");
  });

  it("choosing a scope tokenizes that note and narrows everything", async () => {
    const { view, root, plugin } = makeStats({
      records: [rec("学习", { notesSeenCounts: { "a.md": 1 } }), rec("天气")],
      files: { "a.md": "学习好" },
      tokens: () => [{ surface: "学习", isWord: true }, { surface: "，", isWord: false }],
    });
    await view.onOpen();
    const sel = q(root, ".cci-stats-scope") as HTMLSelectElement;
    sel.value = "a.md";
    sel.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledWith("学习好");
    expect(cards(root).Tracked).toBe("1");
  });
});

describe("setScope", () => {
  it("an unreadable or missing note leaves the scope with no surfaces, and an empty path clears it", async () => {
    const a = makeStats({ files: { "a.md": "x" } });
    a.plugin.app.vault.cachedRead.mockRejectedValue(new Error("gone"));
    await a.view.setScope("a.md");
    expect(a.view.noteSurfaces.size).toBe(0);
    await a.view.setScope("missing.md");
    expect(a.view.noteSurfaces.size).toBe(0);
    await a.view.setScope("");
    expect(a.view.noteScope).toBe("");
  });

  it("works before the view is mounted", async () => {
    const { view } = makeStats({ files: { "a.md": "x" } });
    view.containerEl = { children: [] };
    await expect(view.setScope("a.md")).resolves.toBeUndefined();
  });

  it("invalidateCaches re-derives a note scope, and just clears otherwise", async () => {
    const { view, plugin } = makeStats({ files: { "a.md": "学" }, tokens: () => [{ surface: "学", isWord: true }] });
    view.triageContextCache.set("k", "{}");
    view.noteSurfaces.add("x");
    view.invalidateCaches();
    expect(view.triageContextCache.size).toBe(0);
    expect(view.noteSurfaces.size).toBe(0);
    view.noteScope = "a.md";
    view.invalidateCaches();
    await flush();
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledWith("学");
  });
});

describe("the cards", () => {
  const vocab = [known("甲"), known("乙"), partial("丙"), unknown("丁"), rec("戊"), rec("己", { status: "ignored" })];

  it("count each bucket, with percentages out of everything but the ignored words", async () => {
    const { view, root } = makeStats({ records: vocab, settings: (s) => (s.statsExcludeNew = false) });
    await view.onOpen();
    expect(cards(root)).toMatchObject({ Tracked: "6", Known: "2 · 40%", Partial: "1 · 20%", Unknown: "1 · 20%", New: "1", Ignored: "1", "Overall known": "40%" });
  });

  it("excluding unclassified words changes the denominator and says how many are hidden", async () => {
    const { view, root } = makeStats({ records: vocab, settings: (s) => (s.statsExcludeNew = true) });
    await view.onOpen();
    expect(cards(root).Known).toBe("2 · 50%");
    expect(q(root, ".cci-dash-toggle-hint").textContent).toBe(" (1 hidden when on)");
    expect((q(root, ".cci-dash-toggle input") as HTMLInputElement).checked).toBe(true);
  });

  it("an empty vocabulary shows zeros, not NaN", async () => {
    const { view, root } = makeStats({ settings: (s) => (s.statsExcludeNew = false) });
    await view.onOpen();
    expect(cards(root)).toMatchObject({ Tracked: "0", Known: "0 · 0%", "Overall known": "0%" });
  });

  it("the toggle saves the choice and redraws", async () => {
    const { view, root, plugin } = makeStats({ records: vocab, settings: (s) => (s.statsExcludeNew = false) });
    await view.onOpen();
    const cb = q(root, ".cci-dash-toggle input") as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.settings.statsExcludeNew).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(cards(root).Known).toBe("2 · 50%");
  });

  it("the comfort level is the highest HSK level whose known share reaches the threshold, over the whole vocabulary", async () => {
    const hsk = (s: string, lvl: string, status = "known") => rec(s, { status, hsk: { source: "2.0", levels: [lvl] } });
    const records = [hsk("a", "1"), hsk("b", "1"), hsk("c", "2"), hsk("d", "2", "unknown"), hsk("e", "3", "unknown"), hsk("f", "4", "ignored"), rec("g", { hsk: undefined, status: "known" }), hsk("h", "5", "new")];
    const a = makeStats({ records, settings: (s) => (s.story.knownCoverageThreshold = 0.5) });
    await a.view.onOpen();
    expect(cards(a.root)["Comfort level"]).toBe("HSK 2");
    document.body.innerHTML = "";
    const b = makeStats({ records, settings: (s) => ((s.story.knownCoverageThreshold = 1), (s.statsExcludeNew = true)) });
    await b.view.onOpen();
    expect(cards(b.root)["Comfort level"]).toBe("HSK 1");
    const none = makeStats({ records: [hsk("x", "3", "unknown")] });
    await none.view.onOpen();
    expect(cards(none.root)["Comfort level"]).toBe("n/a");
  });
});

describe("scoped to a note", () => {
  it("says so where the numbers are, hides the global-only parts, and can go back", async () => {
    const { view, root } = makeStats({ records: [rec("学习", { notesSeenCounts: { "a.md": 1 } }), rec("天气")], files: { "a.md": "学习" }, tokens: () => [{ surface: "学习", isWord: true }] });
    await view.onOpen();
    await view.setScope("a.md");
    expect(q(root, ".cci-dash-scope-path").textContent).toBe("a.md");
    expect(cards(root)["Overall known"]).toBeUndefined();
    expect(q(root, ".cci-dash-batch-btn")).toBeNull();
    expect(q(root, ".cci-dash-notes")).toBeNull();
    btn(root, "Show all vocabulary").click();
    await flush();
    expect(q(root, ".cci-dash-scope-note")).toBeNull();
  });
});

describe("marking every unclassified word", () => {
  it("is offered when there are some, asks first, and applies to the vocabulary", async () => {
    const { view, root, plugin } = makeStats({ records: [rec("甲"), rec("乙"), known("丙")] });
    await view.onOpen();
    const b = btn(root, "Mark all 2 new words as Unknown");
    b.click();
    await flush();
    expect(confirm.asked[0]).toContain("Mark 2 unclassified words");
    expect(plugin.vocab.markAllNewAs).toHaveBeenCalledWith("unknown");
    expect(plugin.refreshChineseViews).toHaveBeenCalled();
    expect(plugin.refreshStatsViews).toHaveBeenCalled();
  });

  it("declining changes nothing; with none to mark there is no button", async () => {
    const { view, root, plugin } = makeStats({ records: [rec("甲")] });
    await view.onOpen();
    confirm.answer = false;
    btn(root, /Mark all/).click();
    await flush();
    expect(plugin.vocab.markAllNewAs).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    const none = makeStats({ records: [known("甲")] });
    await none.view.onOpen();
    expect(q(none.root, ".cci-dash-batch-btn")).toBeNull();
  });
});

describe("per-note exposure", () => {
  it("lists each note with its tracked and known counts and percentage, and clicking a note scopes to it", async () => {
    const records = [
      known("甲", { notesSeenCounts: { "a.md": 3 } }),
      unknown("乙", { notesSeenCounts: { "a.md": 1, "b.md": 2 } }),
      rec("丙", { notesSeenCounts: { "b.md": 1 } }),
      rec("丁", { status: "ignored", notesSeenCounts: { "c.md": 1 } }),
      known("戊", { notesSeenCounts: { "c.md": 0 } }),
    ];
    const { view, root, plugin } = makeStats({ records, files: { "a.md": "甲乙" }, tokens: () => [{ surface: "甲", isWord: true }], settings: (s) => (s.statsExcludeNew = false) });
    await view.onOpen();
    const rows = qa(root, ".cci-dash-notes-table tbody tr").map((tr) => qa(tr, "td").map((td) => td.textContent));
    expect(rows).toEqual([["a.md", "2", "1", "50%"], ["b.md", "2", "0", "0%"], ["c.md", "1", "0", "0%"]]);
    qa(root, ".cci-dash-notes-table tbody tr td")[0].click();
    await flush();
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledWith("甲乙");
  });

  it("with unclassified words excluded the percentage uses classified words only", async () => {
    const records = [known("甲", { notesSeenCounts: { "a.md": 1 } }), rec("乙", { notesSeenCounts: { "a.md": 1 } })];
    const { view, root } = makeStats({ records, settings: (s) => (s.statsExcludeNew = true) });
    await view.onOpen();
    expect(qa(root, ".cci-dash-notes-table tbody tr td")[3].textContent).toBe("100%");
  });

  it("a note whose words are all unclassified and excluded shows 0 %, not NaN", async () => {
    const { view, root } = makeStats({ records: [rec("乙", { notesSeenCounts: { "a.md": 1 } })], settings: (s) => (s.statsExcludeNew = true) });
    await view.onOpen();
    expect(qa(root, ".cci-dash-notes-table tbody tr td")[3].textContent).toBe("0%");
  });

  it("without notes there is no table", async () => {
    const { view, root } = makeStats({ records: [known("甲")] });
    await view.onOpen();
    expect(q(root, ".cci-dash-notes")).toBeNull();
  });
});

describe("closing", () => {
  it("flushes a topic selection that was still waiting to be saved, and does nothing when nothing was", async () => {
    vi.useFakeTimers();
    const { view, plugin } = makeStats();
    await view.onClose();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    view.scheduleRadarSave(); // leading edge saves at once
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    await view.onClose();
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    expect(view.radarSaveTimer).toBeNull();
  });

  it("a burst of topic changes saves at once, then once more after the quiet period", () => {
    vi.useFakeTimers();
    const { view, plugin } = makeStats();
    view.scheduleRadarSave();
    view.scheduleRadarSave();
    view.scheduleRadarSave();
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    view.scheduleRadarSave(); // a quiet gap: leading edge again
    expect(plugin.saveSettings).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(400);
    expect(view.radarSaveTimer).toBeNull();
  });
});
