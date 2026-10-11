// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { bind, call, chineseView, settings, statsView, workspace } from "./__mocks__/mainHarness";
import { VIEW_TYPE_CHINESE, VIEW_TYPE_STATS } from "../constants";

/**
 * The plugin's mode state and the helpers that reach the open views: marking modes, the half-finished selections of
 * custom-word and format modes, which views get refreshed and how a view that throws or is not ready is treated, the
 * entry points into the Chinese and stats views, and the note statistics shown in the toolbar.
 */

installObsidianDom();

beforeEach(() => void (Notice.instances.length = 0));
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const plugin = (over: Record<string, unknown> = {}) =>
  bind({ viewMode: "read", pendingCustomSurface: "", pendingFormatStart: null, pendingFormatStartSurface: null, settings: settings(), app: { workspace: workspace() }, ...over });

describe("modes", () => {
  it("reports the current mode", () => {
    expect(call("activeViewMode", { viewMode: "mark-known" })).toBe("mark-known");
  });

  it.each([
    ["read", false], ["edit", false], ["format", true], ["mark-known", true], ["mark-unknown", true], ["mark-partial", true], ["select-word", true],
  ])("%s: tool mode is %s", (mode, expected) => {
    expect(call("isInteractiveMode", { viewMode: mode })).toBe(expected);
  });

  it("changing between ordinary modes redecorates every Chinese view and refreshes its toolbar", () => {
    const v1 = chineseView();
    const v2 = chineseView();
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v1 }, { view: v2 }] }) } });
    p.setActiveViewMode("mark-known");
    for (const v of [v1, v2]) {
      expect(v.refreshToolbar).toHaveBeenCalledTimes(1);
      expect(v.redecorate).toHaveBeenCalledTimes(1);
      expect(v.reconfigureEditor).not.toHaveBeenCalled();
    }
    expect(p.viewMode).toBe("mark-known");
  });

  it("crossing the edit boundary (either way) reconfigures the editor instead of just redecorating", () => {
    const v = chineseView();
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    p.setActiveViewMode("edit");
    expect(v.reconfigureEditor).toHaveBeenCalledTimes(1);
    expect(v.redecorate).not.toHaveBeenCalled();
    p.setActiveViewMode("read");
    expect(v.reconfigureEditor).toHaveBeenCalledTimes(2);
  });

  it("staying in edit mode only redecorates", () => {
    const v = chineseView();
    const p = plugin({ viewMode: "edit", app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    p.setActiveViewMode("edit");
    expect(v.redecorate).toHaveBeenCalled();
    expect(v.reconfigureEditor).not.toHaveBeenCalled();
  });

  it("entering or leaving select-word mode clears the word being assembled; moving between other modes keeps it", () => {
    const p = plugin({ viewMode: "read", pendingCustomSurface: "学" });
    p.setActiveViewMode("mark-known");
    expect(p.pendingCustomSurface).toBe("学");
    p.setActiveViewMode("select-word");
    expect(p.pendingCustomSurface).toBe("");
    p.pendingCustomSurface = "习";
    p.setActiveViewMode("select-word");
    expect(p.pendingCustomSurface).toBe("习");
    p.setActiveViewMode("read");
    expect(p.pendingCustomSurface).toBe("");
  });

  it("entering or leaving format mode drops a half-finished range; other changes keep it", () => {
    const p = plugin({ viewMode: "read", pendingFormatStart: 5, pendingFormatStartSurface: "学" });
    p.setActiveViewMode("mark-known");
    expect(p.pendingFormatStart).toBe(5);
    p.setActiveViewMode("format");
    expect([p.pendingFormatStart, p.pendingFormatStartSurface]).toEqual([null, null]);
    p.pendingFormatStart = 7;
    p.setActiveViewMode("read");
    expect(p.pendingFormatStart).toBeNull();
  });

  it("skips leaves that are not Chinese views, and a view that is not ready yet, and survives one that throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = chineseView();
    const notReady = chineseView({ refreshToolbar: undefined, redecorate: undefined, reconfigureEditor: undefined });
    const throwing = chineseView({ refreshToolbar: vi.fn(() => { throw new Error("boom"); }) });
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: {} }, { view: notReady }, { view: throwing }, { view: good }] }) } });
    expect(() => p.setActiveViewMode("mark-unknown")).not.toThrow();
    expect(good.redecorate).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("CCI view refresh failed", expect.any(Error));
    p.setActiveViewMode("edit");
    expect(good.reconfigureEditor).toHaveBeenCalled();
  });

  it("a view without reconfigure or redecorate is left alone at the boundary", () => {
    const bare = chineseView({ reconfigureEditor: undefined, redecorate: undefined });
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: bare }] }) } });
    expect(() => p.setActiveViewMode("edit")).not.toThrow();
    expect(() => p.setActiveViewMode("read")).not.toThrow();
    p.viewMode = "read";
    expect(() => p.setActiveViewMode("format")).not.toThrow();
  });
});

describe("the custom-word selection", () => {
  it("builds up from tapped words and refreshes the toolbars; a view that throws or is not ready does not stop it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = chineseView();
    const bad = chineseView({ refreshToolbar: vi.fn(() => { throw new Error("x"); }) });
    const notReady = chineseView({ refreshToolbar: undefined });
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: {} }, { view: notReady }, { view: bad }, { view: a }] }) } });
    p.appendToCustomWordSelection("学");
    p.appendToCustomWordSelection("习");
    expect(p.pendingCustomSurface).toBe("学习");
    expect(a.refreshToolbar).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("CCI refreshToolbar failed", expect.any(Error));
    p.clearCustomWordSelection();
    expect(p.pendingCustomSurface).toBe("");
  });
});

describe("the format range", () => {
  it("the first tap remembers the start, and the tapped word for the banner (or nothing)", () => {
    const v = chineseView();
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    p.beginFormatRange(4, "学习");
    expect([p.pendingFormatStart, p.pendingFormatStartSurface]).toEqual([4, "学习"]);
    p.beginFormatRange(9);
    expect([p.pendingFormatStart, p.pendingFormatStartSurface]).toEqual([9, null]);
    expect(v.refreshToolbar).toHaveBeenCalledTimes(2);
  });

  it("the second tap applies the armed formats between the two taps, whichever came first, and clears the pending start", () => {
    const v = chineseView();
    const p = plugin({ pendingFormatStart: 10, settings: settings((s) => ((s.enabledFormats = ["bold"]), (s.formatReverseMode = false))), app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    p.applyFormatRange(4);
    expect(v.applyFormatToRange).toHaveBeenCalledWith(4, 10, ["bold"], undefined, false);
    expect([p.pendingFormatStart, p.pendingFormatStartSurface]).toEqual([null, null]);
    expect(v.refreshToolbar).toHaveBeenCalled();
  });

  it("with nothing armed it clears formatting, and in reverse mode it removes", () => {
    const v = chineseView();
    const p = plugin({ pendingFormatStart: 1, settings: settings((s) => ((s.enabledFormats = []), (s.formatReverseMode = true))), app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    p.applyFormatRange(3);
    expect(v.applyFormatToRange).toHaveBeenCalledWith(1, 3, [], undefined, true);
  });

  it("a coloured highlight is written with its palette colour; an unknown colour id writes without one", () => {
    const v = chineseView();
    const known = plugin({ pendingFormatStart: 0, settings: settings((s) => ((s.enabledFormats = ["hl:yellow"]), (s.showHighlightColorsWithoutPlugin = true), (s.einkMode = false))), app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    known.applyFormatRange(2);
    expect(v.applyFormatToRange.mock.calls[0][3]).toMatchObject({ open: expect.stringContaining("<mark") });
    const unknown = plugin({ pendingFormatStart: 0, settings: settings((s) => ((s.enabledFormats = ["hl:nonexistent"]), (s.showHighlightColorsWithoutPlugin = true))), app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    unknown.applyFormatRange(2);
    expect(v.applyFormatToRange.mock.calls[1][3]).toBeUndefined();
  });

  it("a second tap with no first tap, or with no Chinese view open, only refreshes", () => {
    const v = chineseView();
    const none = plugin({ pendingFormatStart: null, app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }] }) } });
    none.applyFormatRange(3);
    expect(v.applyFormatToRange).not.toHaveBeenCalled();
    expect(v.refreshToolbar).toHaveBeenCalled();
    const noView = plugin({ pendingFormatStart: 1, app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: {} }] }) } });
    expect(() => noView.applyFormatRange(3)).not.toThrow();
    expect(noView.pendingFormatStart).toBeNull();
  });
});

describe("refreshing the views", () => {
  const withViews = (views: unknown[]) => plugin({ app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: views.map((view) => ({ view })) }) } });

  it("appearance, redecorate and re-tokenize each reach every Chinese view, and tolerate views that are not ready or throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = chineseView();
    const notReady = chineseView({ applySettingsToView: undefined, redecorate: undefined, refreshToolbar: undefined, forceRetokenize: undefined });
    const boom = chineseView({
      applySettingsToView: vi.fn(() => { throw new Error("a"); }),
      redecorate: vi.fn(() => { throw new Error("b"); }),
      refreshToolbar: vi.fn(() => { throw new Error("c"); }),
      forceRetokenize: vi.fn(() => { throw new Error("d"); }),
    });
    const p = withViews([{}, notReady, boom, ok]);
    p.refreshChineseViewAppearance();
    p.refreshChineseViews();
    p.forceRetokenizeViews();
    expect(ok.applySettingsToView).toHaveBeenCalledTimes(1);
    expect(ok.redecorate).toHaveBeenCalledTimes(1);
    expect(ok.refreshToolbar).toHaveBeenCalledTimes(1);
    expect(ok.forceRetokenize).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["CCI appearance refresh failed", "CCI redecorate failed", "CCI refreshToolbar failed", "CCI forceRetokenize failed"]));
  });

  it("stats views are re-rendered, except ones that are not ready, and a throwing one is only logged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = statsView();
    const notReady = statsView({ render: undefined });
    const boom = statsView({ render: vi.fn(() => { throw new Error("x"); }) });
    const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_STATS]: [{ view: {} }, { view: notReady }, { view: boom }, { view: ok }] }) } });
    p.refreshStatsViews();
    expect(ok.render).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("CCI stats render failed", expect.any(Error));
  });
});

describe("opening notes and views", () => {
  it("the current note's key is its path, or a placeholder with no note", () => {
    const withFile = plugin({ app: { workspace: workspace({}, { getActiveFile: vi.fn(() => ({ path: "dir/a.md" })) }) } });
    expect(withFile.currentNoteKey()).toBe("dir/a.md");
    expect(plugin().currentNoteKey()).toBe("_no_note");
  });

  it("Open current note says so when there is none, otherwise opens it in the Chinese view", async () => {
    const none = plugin();
    await none.openCurrentInChineseView();
    expect(Notice.instances.at(-1)!.message).toBe("No active note.");
    const setViewState = vi.fn(async () => {});
    const file = { path: "a.md" };
    const p = plugin({ app: { workspace: workspace({}, { getActiveFile: vi.fn(() => file), getLeaf: vi.fn(() => ({ setViewState })) }) } });
    await p.openCurrentInChineseView();
    expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CHINESE, state: { file: "a.md" } });
  });

  it("openFileInChineseView returns the leaf it used", async () => {
    const leaf = { setViewState: vi.fn(async () => {}) };
    const p = plugin({ app: { workspace: workspace({}, { getLeaf: vi.fn(() => leaf) }) } });
    expect(await p.openFileInChineseView({ path: "x.md" })).toBe(leaf);
    expect(p.app.workspace.getLeaf).toHaveBeenCalledWith(false);
  });

  describe("the Markdown view's header button", () => {
    const mdView = (over: Record<string, unknown> = {}) => ({ file: { path: "n.md" }, addAction: vi.fn(), ...over });

    it("adds one 'open in Chinese view' button per Markdown view, however often it is asked", async () => {
      const view = mdView();
      const p = plugin({ injectedMarkdownViews: new WeakSet(), app: { workspace: workspace({ markdown: [{ view }] }) } });
      p.openFileInChineseView = vi.fn(async () => ({}));
      p.injectMarkdownHeaderActions();
      p.injectMarkdownHeaderActions();
      expect(view.addAction).toHaveBeenCalledTimes(1);
      expect(view.addAction.mock.calls[0].slice(0, 2)).toEqual(["cci-zhong", "Open in Chinese Learning View"]);
      view.addAction.mock.calls[0][2]();
      expect(p.openFileInChineseView).toHaveBeenCalledWith(view.file);
    });

    it("the button does nothing for a view with no file, and views without addAction (iOS) are just remembered", () => {
      const noFile = mdView({ file: null });
      const ios = mdView({ addAction: undefined });
      const p = plugin({ injectedMarkdownViews: new WeakSet(), app: { workspace: workspace({ markdown: [{ view: noFile }, { view: ios }] }) } });
      p.openFileInChineseView = vi.fn();
      p.injectMarkdownHeaderActions();
      noFile.addAction.mock.calls[0][2]();
      expect(p.openFileInChineseView).not.toHaveBeenCalled();
      expect(p.injectedMarkdownViews.has(ios)).toBe(true);
    });
  });

  describe("the stats view", () => {
    it("opens a new tab scoped to all vocabulary, or to a note, and ignores the no-note placeholder", async () => {
      const view = statsView();
      const leaf = { setViewState: vi.fn(async () => {}), view };
      const p = plugin({ app: { workspace: workspace({}, { getLeaf: vi.fn(() => leaf) }), setting: undefined } });
      await p.openStatsView();
      expect(p.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_STATS });
      expect(view.setScope).toHaveBeenLastCalledWith("");
      expect(p.app.workspace.revealLeaf).toHaveBeenCalled();
      expect(p.app.workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
      await p.openStatsForNote("notes/a.md");
      expect(view.setScope).toHaveBeenLastCalledWith("notes/a.md");
      await p.openStatsForNote("_no_note");
      expect(view.setScope).toHaveBeenLastCalledWith("");
      await p.openStatsForNote("");
      expect(view.setScope).toHaveBeenLastCalledWith("");
    });

    it("reuses a stats view that is already open", async () => {
      const view = statsView();
      const existing = { view };
      const p = plugin({ app: { workspace: workspace({ [VIEW_TYPE_STATS]: [existing] }), setting: undefined } });
      await p.openStatsForNote("a.md");
      expect(p.app.workspace.getLeaf).not.toHaveBeenCalled();
      expect(p.app.workspace.revealLeaf).toHaveBeenCalledWith(existing);
      expect(view.setScope).toHaveBeenCalledWith("a.md");
    });

    it("closes the Settings window first when asked from there, and carries on if that fails", async () => {
      const close = vi.fn();
      const a = plugin({ app: { workspace: workspace({ [VIEW_TYPE_STATS]: [{ view: statsView() }] }), setting: { close } } });
      await a.openStatsView();
      expect(close).toHaveBeenCalled();
      const b = plugin({ app: { workspace: workspace({ [VIEW_TYPE_STATS]: [{ view: statsView() }] }), setting: { close: () => { throw new Error("x"); } } } });
      await expect(b.openStatsView()).resolves.toBeUndefined();
      const c = plugin({ app: { workspace: workspace({ [VIEW_TYPE_STATS]: [{ view: statsView() }] }), setting: {} } });
      await expect(c.openStatsView()).resolves.toBeUndefined();
    });
  });
});

describe("the story modal, the word popup and marking", () => {
  it("the story modal needs AI switched on", () => {
    const off = plugin({ settings: settings((s) => (s.ai.enabled = false)) });
    off.openGenerateStoryModal();
    expect(Notice.instances.at(-1)!.message).toBe("Enable AI in plugin settings first.");
    const on = plugin({ settings: settings((s) => (s.ai.enabled = true)) });
    on.openGenerateStoryModal();
    expect(document.body.querySelector(".cci-modal-front")).toBeTruthy();
  });

  it("the popup is opened with the tapped word, its element, the event and the sentence", () => {
    const open = vi.fn();
    const p = plugin({ popup: { open } });
    const el = document.createElement("span");
    const ev = new Event("click");
    p.openWordPopup("学习", el, ev, "我学习。");
    expect(open).toHaveBeenCalledWith("学习", el, ev, "我学习。");
  });

  it("marking a word sets its status, says so, and refreshes the views", () => {
    const setStatus = vi.fn();
    const v = chineseView();
    const p = plugin({ vocab: { setStatus }, app: { workspace: workspace({ [VIEW_TYPE_CHINESE]: [{ view: v }], [VIEW_TYPE_STATS]: [{ view: statsView() }] }) } });
    p.markWord("学习", "known");
    expect(setStatus).toHaveBeenCalledWith("学习", "known");
    expect(Notice.instances.at(-1)!.message).toBe("学习 → known");
    expect(v.redecorate).toHaveBeenCalled();
    p.markWordIgnored("学习", "a name");
    expect(setStatus).toHaveBeenLastCalledWith("学习", "ignored", "a name");
    expect(Notice.instances.at(-1)!.message).toBe("学习 → ignored");
    p.markWordIgnored("天气");
    expect(setStatus).toHaveBeenLastCalledWith("天气", "ignored", undefined);
  });
});

describe("computeNoteStats", () => {
  const tok = (surface: string, hsk?: string, over: Record<string, unknown> = {}) => ({ surface, isWord: true, candidates: [{}], selected: hsk ? { hsk: { source: "2.0", levels: [hsk] } } : undefined, ...over });
  const stats = (tokens: any[], records: Record<string, string>, over: (s: any) => void = () => {}) =>
    plugin({
      settings: settings(over),
      tokenizer: { tokenize: vi.fn(async () => tokens) },
      vocab: { bySurface: (s: string) => (records[s] ? { status: records[s] } : undefined) },
    }).computeNoteStats("text");

  it("counts word tokens by bucket, leaves out ignored words and non-words, and treats an unseen word as new", async () => {
    const out = await stats(
      [tok("甲"), tok("乙"), tok("丙"), tok("丁"), tok("戊"), tok("己"), { surface: "，", isWord: false, candidates: [] }, tok("庚", undefined, { candidates: [] })],
      { 甲: "known", 乙: "unknown", 丙: "meaningKnownPinyinUnknown", 丁: "ignored", 戊: "new" }
    );
    expect(out).toEqual({ total: 5, known: 1, partial: 1, unknown: 1, newCount: 2, topHsk: "" });
  });

  it("the top HSK level is the highest where the cumulative known share reaches the threshold, once there are enough words", async () => {
    const level = (lvl: string, n: number) => Array.from({ length: n }, (_, i) => tok(`w${lvl}${i}`, lvl));
    const tokens = [...level("1", 3), ...level("2", 3), ...level("3", 3)];
    const known: Record<string, string> = {};
    for (const t of tokens) if (!t.surface.startsWith("w3")) known[t.surface] = "known";
    const out = await stats(tokens, known, (s) => (s.topHskComfortThreshold = 0.6));
    expect(out.topHsk).toBe("3");
    const strict = await stats(tokens, known, (s) => (s.topHskComfortThreshold = 0.9));
    expect(strict.topHsk).toBe("2");
    const few = await stats(level("1", 4), Object.fromEntries(level("1", 4).map((t) => [t.surface, "known"])));
    expect(few.topHsk).toBe("");
  });

  it("a level the note has no words at is never its top level (a note of HSK 1-3 words was labelled 'Top HSK 7')", async () => {
    const tokens = Array.from({ length: 6 }, (_, i) => tok(`w${i}`, i < 3 ? "1" : "2"));
    const known = Object.fromEntries(tokens.map((t) => [t.surface, "known"]));
    expect((await stats(tokens, known)).topHsk).toBe("2");
    expect((await stats(tokens.slice(0, 5), Object.fromEntries(tokens.slice(0, 5).map((t) => [t.surface, "known"])))).topHsk).toBe("2");
  });

  it("an unset threshold means two thirds", async () => {
    const tokens = Array.from({ length: 6 }, (_, i) => tok(`w${i}`, "1"));
    const known = Object.fromEntries(tokens.slice(0, 5).map((t) => [t.surface, "known"]));
    const out = await stats(tokens, known, (s) => (s.topHskComfortThreshold = undefined));
    expect(out.topHsk).toBe("1");
  });
});
