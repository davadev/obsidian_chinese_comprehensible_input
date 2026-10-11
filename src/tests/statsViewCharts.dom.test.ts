// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { flush, makeStats, q, qa, rec } from "./__mocks__/statsViewHarness";
import { HSK_LEVEL_COUNTS } from "../dictionary/hskMap.generated";
import { DEFAULT_RADAR_TOPICS, TOPIC_IDS, TOPIC_LABELS, TOPIC_MAP } from "../dictionary/topicMap.generated";
import { MAX_RADAR_TOPICS, MIN_RADAR_TOPICS } from "../vocabulary/topicCoverage";

/**
 * The dashboard's three charts and their controls: Progress (which series, per period or running total, what the text
 * under it says), HSK coverage (which buckets, how each level's bar is built) and Topic coverage (coverage or relative
 * mode, the tooltip detail, the topic chooser and its limits).
 */

installObsidianDom();
vi.mock("../ui/confirmInput", () => ({ confirmAsync: vi.fn(async () => true) }));

const NOW = new Date("2026-10-10T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const classified = (s: string, status: string, at: string, over: Record<string, unknown> = {}) =>
  rec(s, { status, classifiedAt: at, firstSeenAt: at, ...(status === "known" ? { knownAt: at } : {}), ...over });
const section = (root: HTMLElement, cls: string) => q(root, `.${cls}`);
const summaries = (root: HTMLElement) => qa(section(root, "cci-dash-progress"), ".cci-dash-progress-summary").map((p) => p.textContent);

describe("Progress", () => {
  it("draws the running totals by default for the selected series, with a total line under it", async () => {
    const { view, root } = makeStats({ records: [classified("甲", "known", ago(2)), classified("乙", "unknown", ago(1))] });
    await view.onOpen();
    expect(q(root, ".cci-dash-progress svg.cci-progress-graph")).toBeTruthy();
    expect(qa(root, ".cci-dash-progress .cci-progress-legend-item").map((i) => i.textContent)).toEqual(["Classified (2)", "Known (1)"]);
    expect(summaries(root)).toEqual(["Total: Classified 2, Known 1."]);
  });

  it("per-period bars say how many fall in the last 30 days / 12 weeks / 12 months", async () => {
    const records = [classified("甲", "known", ago(2)), classified("乙", "known", ago(100))];
    const { view, root } = makeStats({ records });
    await view.onOpen();
    const [style, bucket] = qa(root, ".cci-dash-progress-bucket") as HTMLSelectElement[];
    style.value = "bars";
    style.dispatchEvent(new Event("change"));
    expect(summaries(root)[0]).toBe("Last 30 days: Classified 1, Known 1.");
    const bucket2 = qa(root, ".cci-dash-progress-bucket")[1] as HTMLSelectElement;
    bucket2.value = "week";
    bucket2.dispatchEvent(new Event("change"));
    expect(summaries(root)[0]).toBe("Last 12 weeks: Classified 1, Known 1.");
    const bucket3 = qa(root, ".cci-dash-progress-bucket")[1] as HTMLSelectElement;
    bucket3.value = "month";
    bucket3.dispatchEvent(new Event("change"));
    expect(summaries(root)[0]).toBe("Last 12 months: Classified 2, Known 2.");
    void bucket;
  });

  it("the running total includes what happened before the window", async () => {
    const { view, root } = makeStats({ records: [classified("甲", "known", ago(100))] });
    await view.onOpen();
    expect(summaries(root)[0]).toBe("Total: Classified 1, Known 1.");
  });

  it("offers each series, remembers a change and redraws", async () => {
    const { view, root, plugin } = makeStats({ records: [classified("甲", "unknown", ago(1))] });
    await view.onOpen();
    const items = qa(section(root, "cci-dash-progress"), ".cci-dash-progress-filter-item");
    expect(items.map((i) => i.textContent!.trim())).toEqual(["Tracked", "Classified", "Known", "Partial", "Unknown"]);
    const unknownBox = q(items[4], "input") as HTMLInputElement;
    unknownBox.checked = true;
    unknownBox.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.settings.progressChartSeries.unknown).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(summaries(root)[0]).toContain("Unknown 1");
  });

  it("each series counts the right words", async () => {
    const records = [
      classified("a", "known", ago(1)),
      classified("b", "meaningKnownPinyinUnknown", ago(1)),
      classified("c", "unknown", ago(1)),
      rec("d", { firstSeenAt: ago(1) }),
      rec("e", { firstSeenAt: ago(1), backfilledAt: ago(1) }),
    ];
    const { view, root } = makeStats({ records, settings: (s) => (s.progressChartSeries = { tracked: true, classified: true, known: true, partial: true, unknown: true }) });
    await view.onOpen();
    expect(summaries(root)[0]).toBe("Total: Tracked 4, Classified 3, Known 1, Partial 1, Unknown 1.");
  });

  it("with no series selected it says to pick one", async () => {
    const { view, root } = makeStats({ settings: (s) => (s.progressChartSeries = { tracked: false, classified: false, known: false, partial: false, unknown: false }) });
    await view.onOpen();
    expect(summaries(root)).toEqual(["Pick at least one series above."]);
  });

  it("a brand-new vault explains the empty chart instead of leaving a flat line", async () => {
    const { view, root } = makeStats({ records: [rec("a", { backfilledAt: ago(1) }), rec("b", { backfilledAt: ago(1) })] });
    await view.onOpen();
    expect(summaries(root).at(-1)).toContain("Nothing to plot yet");
    expect(summaries(root).at(-1)).toContain("The 2 words already found in your notes");
  });

  it("says what Tracked leaves out when words were added by indexing", async () => {
    const { view, root } = makeStats({
      records: [classified("a", "known", ago(1)), rec("b", { backfilledAt: ago(1) })],
      settings: (s) => (s.progressChartSeries.tracked = true),
    });
    await view.onOpen();
    expect(summaries(root).at(-1)).toBe("Tracked excludes 1 words added by vault indexing.");
  });

  it("stays quiet about indexing when Tracked is not shown", async () => {
    const { view, root } = makeStats({ records: [classified("a", "known", ago(1)), rec("b", { backfilledAt: ago(1) })] });
    await view.onOpen();
    expect(summaries(root)).toEqual(["Total: Classified 1, Known 1."]);
  });
});

describe("HSK coverage", () => {
  const hsk = (s: string, lvl: string, status: string, over: Record<string, unknown> = {}) =>
    rec(s, { hsk: { source: "2.0", levels: [lvl] }, status, ...(status === "known" ? { axes: { chars: true, pinyin: true, meaning: true } } : {}), ...over });
  const rows = (root: HTMLElement) => qa(root, ".cci-dash-hsk-row");

  it("one row per level, Known only by default, with the share of that level's whole word list", async () => {
    const records = [hsk("a", "1", "known"), hsk("b", "1", "known"), hsk("c", "1", "unknown"), hsk("d", "2", "known")];
    const { view, root } = makeStats({ records });
    await view.onOpen();
    expect(rows(root)).toHaveLength(6);
    expect(q(rows(root)[0], ".cci-dash-hsk-label").textContent).toBe("HSK 1");
    const total = HSK_LEVEL_COUNTS[1];
    expect(q(rows(root)[0], ".cci-dash-hsk-pct").textContent).toBe(`${((2 / total) * 100).toFixed(0)}% · ${total}`);
    const segs = qa(rows(root)[0], ".cci-dash-hsk-seg");
    expect(segs).toHaveLength(1);
    expect(segs[0].getAttribute("title")).toBe(`HSK 1 · Known: 2 / ${total} (${((2 / total) * 100).toFixed(1)}%)`);
    expect(qa(rows(root)[5], ".cci-dash-hsk-seg")).toHaveLength(0);
    expect(q(root, ".cci-dash-hsk .cci-dash-progress-summary").textContent).toContain("out of the total HSK 2.0 word list");
  });

  it("each bucket is drawn when selected: partial, unknown, new, ignored words are tracked, the rest is untracked", async () => {
    const records = [hsk("a", "3", "known"), hsk("b", "3", "meaningKnownPinyinUnknown"), hsk("c", "3", "unknown"), hsk("d", "3", "new"), hsk("e", "3", "ignored"), rec("nolevel", { status: "known" })];
    const { view, root } = makeStats({ records, settings: (s) => (s.hskCoverageBuckets = { known: true, partial: true, unknown: true, new: true, untracked: true }) });
    await view.onOpen();
    const total = HSK_LEVEL_COUNTS[3];
    const titles = qa(rows(root)[2], ".cci-dash-hsk-seg").map((s) => s.getAttribute("title")!.split(":")[0]);
    expect(titles).toEqual(["HSK 3 · Known", "HSK 3 · Partial", "HSK 3 · Unknown", "HSK 3 · New", "HSK 3 · Untracked"]);
    const untracked = qa(rows(root)[2], ".cci-dash-hsk-seg").at(-1)!.getAttribute("title")!;
    expect(untracked).toContain(`Untracked: ${total - 5} / ${total}`);
    expect(q(rows(root)[2], ".cci-dash-hsk-pct").textContent).toBe(`${((((total - 5) + 4) / total) * 100).toFixed(0)}% · ${total}`);
  });

  it("a level that has more tracked words than its list has no negative untracked share", async () => {
    const many = Array.from({ length: HSK_LEVEL_COUNTS[1] + 5 }, (_, i) => hsk(`w${i}`, "1", "known"));
    const { view, root } = makeStats({ records: many, settings: (s) => (s.hskCoverageBuckets.untracked = true) });
    await view.onOpen();
    expect(qa(rows(root)[0], ".cci-dash-hsk-seg").map((s) => s.getAttribute("title")!.split(":")[0])).toEqual(["HSK 1 · Known"]);
  });

  it("each bucket checkbox is remembered and redraws", async () => {
    const { view, root, plugin } = makeStats({ records: [hsk("a", "1", "unknown")] });
    await view.onOpen();
    const box = q(qa(q(root, ".cci-dash-hsk"), ".cci-dash-progress-filter-item")[2], "input") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.settings.hskCoverageBuckets.unknown).toBe(true);
    expect(qa(rows(root)[0], ".cci-dash-hsk-seg")).toHaveLength(1);
  });
});

describe("Topic coverage", () => {
  const topicWords = Object.keys(TOPIC_MAP).slice(0, 1500);
  const knownWords = () => topicWords.map((w) => rec(w, { status: "known", axes: { chars: true, pinyin: true, meaning: true } }));
  const topics = (root: HTMLElement) => q(root, ".cci-dash-topics");

  it("every topic has a label, so the chart never needs a fallback name", () => {
    for (const id of TOPIC_IDS) expect(TOPIC_LABELS[id], id).toBeTruthy();
  });

  it("explains an empty chart in Coverage mode instead of drawing a dot", async () => {
    const { view, root } = makeStats();
    await view.onOpen();
    expect(q(topics(root), ".cci-dash-topics-chart p").textContent).toMatch(/Nothing to plot yet|No vocabulary in these topics yet/);
    expect(q(topics(root), "svg")).toBeNull();
  });

  it("draws three rings in Coverage mode with the detail in each spoke's tooltip", async () => {
    const { view, root } = makeStats({ records: knownWords() });
    await view.onOpen();
    expect(qa(topics(root), ".cci-progress-legend-item").map((i) => i.textContent)).toEqual(["Known", "+ partial", "+ unknown"]);
    const tip = qa(topics(root), "circle title")[0].textContent!;
    expect(tip).toContain("words\nknown ");
    expect(tip).toContain("never met");
    expect(tip).not.toContain("relative to your level");
    expect(qa(topics(root), "text").length).toBe(DEFAULT_RADAR_TOPICS.length);
    expect(q(topics(root), ".cci-dash-progress-summary:last-child").textContent).toContain("Rings are cumulative");
  });

  it("flags a topic with little data in its tooltip", async () => {
    const { view, root } = makeStats({ records: knownWords().slice(0, 3) });
    await view.onOpen();
    expect(qa(topics(root), "circle title").some((t) => /not enough data yet/.test(t.textContent ?? ""))).toBe(true);
  });

  it("the mode menu switches to Relative, saves, and draws one ring", async () => {
    const { view, root, plugin } = makeStats({ records: knownWords() });
    await view.onOpen();
    const sel = q(topics(root), "select") as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["Coverage", "Relative to my level"]);
    sel.value = "relative";
    sel.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.settings.topicRadarMode).toBe("relative");
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(qa(topics(root), ".cci-progress-legend-item").map((i) => i.textContent)).toEqual(["Relative to my level"]);
    expect(qa(topics(root), "circle title")[0].textContent).toContain("relative to your level:");
    expect(q(topics(root), ".cci-dash-progress-summary:last-child").textContent).toContain("1.0 = exactly what your overall level predicts");
    const back = q(topics(root), "select") as HTMLSelectElement;
    back.value = "coverage";
    back.dispatchEvent(new Event("change"));
    await flush();
    expect(plugin.settings.topicRadarMode).toBe("coverage");
  });

  it("Relative mode still draws with an empty vocabulary (nothing to plot is a Coverage idea)", async () => {
    const { view, root } = makeStats({ settings: (s) => (s.topicRadarMode = "relative") });
    await view.onOpen();
    expect(q(topics(root), "svg")).toBeTruthy();
  });

  it("the chooser is collapsed until asked for, and shows how many topics are picked", async () => {
    const { view, root } = makeStats();
    await view.onOpen();
    const toggle = q(topics(root), ".cci-dash-topics-toggle");
    expect(toggle.textContent).toBe(`Choose topics (${DEFAULT_RADAR_TOPICS.length}/${MAX_RADAR_TOPICS})`);
    expect(q(topics(root), ".cci-dash-topics-chooser .cci-dash-progress-filter")).toBeNull();
    toggle.click();
    expect(qa(topics(root), ".cci-dash-topics-chooser label")).toHaveLength(TOPIC_IDS.length);
    q(topics(root), ".cci-dash-topics-toggle").click();
    expect(q(topics(root), ".cci-dash-topics-chooser .cci-dash-progress-filter")).toBeNull();
  });

  it("ticking a topic adds it, unticking removes it, and the selection is saved (debounced)", async () => {
    const { view, root, plugin } = makeStats({ settings: (s) => (s.topicRadarTopics = TOPIC_IDS.slice(0, 5)) });
    await view.onOpen();
    q(topics(root), ".cci-dash-topics-toggle").click();
    const boxes = () => qa(topics(root), ".cci-dash-topics-chooser input") as HTMLInputElement[];
    const target = boxes()[7];
    target.checked = true;
    target.dispatchEvent(new Event("change"));
    expect(plugin.settings.topicRadarTopics).toHaveLength(6);
    expect(plugin.settings.topicRadarTopics).toContain(TOPIC_IDS[7]);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    const first = boxes()[0];
    first.checked = false;
    first.dispatchEvent(new Event("change"));
    expect(plugin.settings.topicRadarTopics).not.toContain(TOPIC_IDS[0]);
    expect(q(topics(root), ".cci-dash-topics-chooser .cci-dash-progress-summary").textContent).toContain(`Pick between ${MIN_RADAR_TOPICS} and ${MAX_RADAR_TOPICS} topics.`);
  });

  it("refuses the click that would leave fewer than the minimum or more than the maximum", async () => {
    const few = makeStats({ settings: (s) => (s.topicRadarTopics = TOPIC_IDS.slice(0, MIN_RADAR_TOPICS)) });
    await few.view.onOpen();
    q(topics(few.root), ".cci-dash-topics-toggle").click();
    const boxes = qa(topics(few.root), ".cci-dash-topics-chooser input") as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked).every((b) => b.disabled)).toBe(true);
    expect(boxes.filter((b) => !b.checked).every((b) => !b.disabled)).toBe(true);
    document.body.innerHTML = "";
    const many = makeStats({ settings: (s) => (s.topicRadarTopics = TOPIC_IDS.slice(0, MAX_RADAR_TOPICS)) });
    await many.view.onOpen();
    q(topics(many.root), ".cci-dash-topics-toggle").click();
    const boxes2 = qa(topics(many.root), ".cci-dash-topics-chooser input") as HTMLInputElement[];
    expect(boxes2.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
    expect(boxes2.filter((b) => b.checked).every((b) => !b.disabled)).toBe(true);
  });
});
