// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { btn, makeStats, q, qa, rec } from "./__mocks__/statsViewHarness";

/**
 * The Words tab: the table, its search, status / HSK filters and sorting, the 500-row cap, and the detail overlay.
 * What a row shows has to match the card and the popup (same pinyin and surface path), and a filter has to narrow
 * exactly what it says.
 */

installObsidianDom();
vi.mock("../ui/confirmInput", () => ({ confirmAsync: vi.fn(async () => true) }));
afterEach(() => void (document.body.innerHTML = ""));

const w = (s: string, over: Record<string, unknown> = {}) => rec(s, over);
const known = (s: string, over: Record<string, unknown> = {}) => w(s, { status: "known", axes: { chars: true, pinyin: true, meaning: true }, ...over });
const open = async (records: any[], settings?: (s: any) => void) => {
  const m = makeStats({ records, settings });
  await m.view.onOpen();
  m.view.setTab("words");
  return m;
};
const words = (root: HTMLElement) => qa(root, "tbody tr").map((tr) => q(tr, "td").textContent);
const set = (sel: HTMLSelectElement, value: string) => {
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
};
const selects = (root: HTMLElement) => qa(root, ".cci-stats-controls select") as HTMLSelectElement[];

describe("the table", () => {
  it("shows one row per word with surface, pinyin, first definition, HSK, status, counts and dates", async () => {
    const { root } = await open([known("学习", { pinyin: "xué xí", definitions: ["to study", "second"], hsk: { source: "2.0", levels: ["2", "3"] }, seenCount: 5, lastSeenAt: "2026-05-04T09:00:00.000Z", srs: { dueAt: "2026-06-01T00:00:00.000Z" } })]);
    const cells = qa(q(root, "tbody tr"), "td").map((td) => td.textContent);
    expect(cells).toEqual(["学习", "xué xí", "to study", "2/3", "known", "5", "2026-05-04", "2026-06-01"]);
    expect(qa(root, "thead th").map((th) => th.textContent)).toEqual(["Word", "Pinyin", "Definition", "HSK", "Status", "Seen", "Last seen", "Due"]);
    expect(q(root, "tbody tr").classList.contains("cci-row-color-known")).toBe(true);
  });

  it("a word with nothing recorded shows dashes and blanks, not undefined", async () => {
    const { root } = await open([w("学习", { definitions: undefined, hsk: undefined, lastSeenAt: undefined, srs: undefined, pinyin: undefined })]);
    expect(qa(q(root, "tbody tr"), "td").map((td) => td.textContent)).toEqual(["学习", "", "", "", "new", "1", "—", "—"]);
  });

  it("is capped at 500 rows", async () => {
    const many = Array.from({ length: 520 }, (_, i) => w(`w${i}`, { seenCount: 1000 - i }));
    const { root } = await open(many);
    expect(qa(root, "tbody tr")).toHaveLength(500);
  });

  it("says so when nothing matches", async () => {
    const { root } = await open([]);
    expect(root.textContent).toContain("No words match this filter.");
  });
});

describe("filters", () => {
  const vocab = () => [
    known("甲", { hsk: { source: "2.0", levels: ["1"] }, pinyin: "jia" }),
    w("乙", { status: "meaningKnownPinyinUnknown", axes: { chars: true, pinyin: false, meaning: true }, hsk: { source: "2.0", levels: ["7"] } }),
    w("丙", { status: "unknown", axes: { chars: false, pinyin: false, meaning: false }, hsk: { source: "2.0", levels: ["8", "2"] }, definitions: ["Fire"] }),
    w("丁", { status: "ignored" }),
    w("戊"),
  ];

  it("status: each option narrows to that status, and 'partial' means any partly-known word", async () => {
    const { root } = await open(vocab());
    const [status] = selects(root);
    for (const [value, expected] of [["known", ["甲"]], ["partial", ["乙"]], ["unknown", ["丙"]], ["new", ["戊"]], ["ignored", ["丁"]]] as const) {
      set(selects(root)[0], value);
      expect(words(root), value).toEqual(expected);
    }
    set(selects(root)[0], "all");
    expect(words(root)).toHaveLength(5);
    void status;
  });

  it("HSK: a level matches any of the word's levels, and 7+ matches 7 and above", async () => {
    const { root } = await open(vocab());
    set(selects(root)[1], "1");
    expect(words(root)).toEqual(["甲"]);
    set(selects(root)[1], "2");
    expect(words(root)).toEqual(["丙"]);
    set(selects(root)[1], "7+");
    expect(words(root).sort()).toEqual(["丙", "乙"].sort());
    set(selects(root)[1], "all");
    expect(words(root)).toHaveLength(5);
  });

  it("search looks at every surface, the traditional form, pinyin and definitions, ignoring case", async () => {
    const { root } = await open([w("学习", { surfaces: ["學習", "学习"], traditional: "學習", pinyin: "xué xí", definitions: ["To Study"] }), w("天气")]);
    const search = q(root, "input[type=search]") as HTMLInputElement;
    for (const term of ["學", "xué", "to study", "TO STUDY", "学习"]) {
      search.value = term;
      search.dispatchEvent(new Event("input"));
      expect(words(root), term).toEqual(["學習"]); // shown as first read
    }
    const again = q(root, "input[type=search]") as HTMLInputElement;
    expect(again.value).toBe("学习".toLowerCase());
    again.value = "zzz";
    again.dispatchEvent(new Event("input"));
    expect(words(root)).toEqual([]);
  });

  it("search copes with records that lack optional fields", async () => {
    const { root } = await open([w("学习", { surfaces: undefined, simplified: undefined, traditional: undefined, pinyin: undefined, definitions: undefined }), w("天气")]);
    const search = q(root, "input[type=search]") as HTMLInputElement;
    search.value = "天";
    search.dispatchEvent(new Event("input"));
    expect(words(root)).toEqual(["天气"]);
  });
});

describe("sorting", () => {
  const vocab = () => [
    w("甲", { seenCount: 1, lastSeenAt: "2026-01-02", srs: { dueAt: "2026-03-01" }, status: "unknown", hsk: { source: "2.0", levels: ["3"] } }),
    w("乙", { seenCount: 9, lastSeenAt: "2026-05-01", srs: { dueAt: "2026-02-01" }, status: "known", hsk: { source: "2.0", levels: ["1"] } }),
    w("丙", { seenCount: 5, lastSeenAt: undefined, srs: undefined, status: "new", hsk: undefined }),
  ];

  it("by seen, last seen, due, status and HSK, newest or largest first, and the arrow flips it", async () => {
    const { root } = await open(vocab());
    const order = (key: string) => {
      set(selects(root)[2], key);
      return words(root);
    };
    expect(words(root)).toEqual(["乙", "丙", "甲"]); // seen, descending
    expect(order("lastSeenAt")).toEqual(["乙", "甲", "丙"]);
    expect(order("dueAt")).toEqual(["甲", "乙", "丙"]);
    expect(order("status")).toEqual(["甲", "丙", "乙"]); // by name, descending
    expect(order("hsk")).toEqual(["甲", "乙", "丙"]);
    btn(root, "↓").click();
    expect(btn(root, "↑")).toBeTruthy();
    expect(words(root)).toEqual(["丙", "乙", "甲"]);
    set(selects(root)[2], "seenCount");
    expect(words(root)).toEqual(["甲", "丙", "乙"]);
  });

  it("equal values keep their order", async () => {
    const { root } = await open([w("甲", { seenCount: 2 }), w("乙", { seenCount: 2 })]);
    expect(words(root)).toEqual(["甲", "乙"]);
  });
});

describe("the detail overlay", () => {
  it("shows the word, its pinyin, definitions, counts, mnemonic, a 60-day graph and the latest sightings, and closes", async () => {
    const stamps = Array.from({ length: 25 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`);
    const { root } = await open([known("学习", { pinyin: "xué xí", definitions: ["to study", "to learn"], hsk: { source: "2.0", levels: ["2"] }, seenCount: 25, recentSeenAt: stamps, mnemonic: { text: "📖", story: "A long story." } })]);
    q(root, "tbody tr").click();
    const overlay = q(root, ".cci-popup-overlay");
    expect(q(overlay, "h3").textContent).toBe("学习 (xué xí)");
    expect(overlay.textContent).toContain("to study; to learn");
    expect(overlay.textContent).toContain("Status: known · HSK: 2 · Seen: 25");
    expect(overlay.textContent).toContain("🧠 📖");
    expect(q(overlay, ".cci-popup-mnemonic-story").textContent).toBe("A long story.");
    expect(overlay.querySelectorAll("svg.cci-stats-graph rect")).toHaveLength(60);
    const items = qa(overlay, "li").map((li) => li.textContent);
    expect(items).toHaveLength(20);
    expect(items[0]).toBe(stamps[24]);
    btn(overlay, "Close").click();
    expect(q(root, ".cci-popup-overlay")).toBeNull();
  });

  it("leaves out the mnemonic and the sightings list when there are none", async () => {
    const { root } = await open([w("学习", { hsk: undefined, definitions: undefined })]);
    q(root, "tbody tr").click();
    const overlay = q(root, ".cci-popup-overlay");
    expect(overlay.textContent).not.toContain("🧠");
    expect(overlay.querySelector("ul")).toBeNull();
    expect(overlay.textContent).toContain("HSK: ");
  });

  it("a mnemonic with only a story shows the story", async () => {
    const { root } = await open([w("学习", { mnemonic: { story: "just a story" } })]);
    q(root, "tbody tr").click();
    expect(q(root, ".cci-popup-mnemonic-story").textContent).toBe("just a story");
    expect(q(root, ".cci-popup-overlay").textContent).not.toContain("🧠");
  });
});

describe("the note scope narrows the table", () => {
  it("only words with a surface found in the scoped note, whichever script it was written in", async () => {
    const { view, root } = await open(
      [w("学习", { surfaces: ["學習"] }), w("天气")],
    );
    view.noteScope = "a.md";
    view.noteSurfaces = new Set(["學習"]);
    view.render();
    expect(words(root)).toEqual(["學習"]);
  });
});
