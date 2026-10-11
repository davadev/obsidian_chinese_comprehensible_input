// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { btn, file, makeStats, q, qa, rec } from "./__mocks__/statsViewHarness";

/** Microtasks only: the tests run with faked timers, so a setTimeout-based flush would never return. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/**
 * Flashcards -> Smart story: the AI gate and connection test, the recap of what a story will use, generating, and what
 * to do with the result (open it, keep it as a note, generate again, discard it).
 */

installObsidianDom();
vi.mock("../ui/confirmInput", () => ({ confirmAsync: vi.fn(async () => true) }));

beforeEach(() => {
  Notice.instances.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const PREVIEW = "Stories/Preview.md";
async function smart(o: { ai?: boolean; due?: any[]; preview?: boolean; ready?: boolean | null; connected?: boolean } = {}) {
  const m = makeStats({
    due: o.due ?? [rec("甲"), rec("乙")],
    files: o.preview ? { [PREVIEW]: "story" } : {},
    settings: (s) => {
      s.flashcardsMode = "smart";
      s.ai.enabled = o.ai !== false;
    },
  });
  m.plugin.ai.testConnection.mockResolvedValue(o.connected !== false);
  await m.view.onOpen();
  if (o.ready !== undefined) m.view.smartReady = o.ready;
  m.view.setTab("flashcards");
  return m;
}
const status = (root: HTMLElement) => q(root, ".cci-fc-smart")?.textContent;

describe("gates", () => {
  it("says to enable AI when it is off", async () => {
    const m = await smart({ ai: false });
    expect(status(m.root)).toContain("AI provider is disabled.");
    expect(q(m.root, ".cci-fc-smart-params")).toBeNull();
  });

  it("tests the connection first, then shows the panel", async () => {
    const m = await smart();
    let release!: (ok: boolean) => void;
    m.plugin.ai.testConnection = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    m.view.smartReady = null;
    m.view.render();
    expect(status(m.root)).toContain("Testing AI connection…");
    release(true);
    await vi.waitFor(() => expect(q(m.root, ".cci-fc-smart-params")).toBeTruthy());
    expect(m.plugin.ai.testConnection).toHaveBeenCalledTimes(1);
  });

  it("a failed connection test says so, and so does one that throws", async () => {
    const bad = await smart({ connected: false });
    await vi.waitFor(() => expect(status(bad.root)).toContain("AI connection failed."));
    document.body.innerHTML = "";
    const boom = await smart();
    boom.plugin.ai.testConnection.mockRejectedValue(new Error("offline"));
    boom.view.smartReady = null;
    boom.view.render();
    await vi.waitFor(() => expect(status(boom.root)).toContain("AI connection failed."));
  });
});

describe("the recap", () => {
  it("states how many words are due and what the story will use", async () => {
    const m = await smart({ ready: true, due: [rec("甲"), rec("乙"), rec("丙")] });
    const items = qa(m.root, ".cci-fc-smart-params li").map((li) => li.textContent);
    expect(items[0]).toBe(`Due words today: 3 (story will use up to ${m.plugin.settings.story.defaultDueCount}).`);
    expect(items[2]).toBe(`Length: ~${m.plugin.settings.story.defaultLengthChars} characters.`);
    expect(items[3]).toContain("Known-coverage threshold:");
    expect(items[4]).toBe("Max repair iterations: 4.");
  });

  it("names the HSK target as auto for the story style and points to settings otherwise", async () => {
    const a = await smart({ ready: true });
    expect(qa(a.root, ".cci-fc-smart-params li")[1].textContent).toContain("auto");
    document.body.innerHTML = "";
    const b = makeStats({ due: [rec("甲")], settings: (s) => ((s.flashcardsMode = "smart"), (s.ai.enabled = true), (s.story.defaultStyle = "dialogue")) });
    await b.view.onOpen();
    b.view.smartReady = true;
    b.view.setTab("flashcards");
    expect(qa(b.root, ".cci-fc-smart-params li")[1].textContent).toContain("(see story settings)");
  });
});

describe("generating", () => {
  it("offers Generate story, which is disabled with nothing due and says why", async () => {
    const m = await smart({ ready: true, due: [] });
    expect((btn(m.root, "Generate story") as HTMLButtonElement).hasAttribute("disabled")).toBe(true);
    expect(m.root.textContent).toContain("No due words right now.");
  });

  it("generates with the story settings, shows progress, then the result and the notice", async () => {
    const m = await smart({ ready: true });
    btn(m.root, "Generate story").click();
    expect(btn(m.root, "Generating…").hasAttribute("disabled")).toBe(true);
    await vi.waitFor(() => expect(m.plugin.story.generatePreview).toHaveBeenCalled());
    const s = m.plugin.settings.story;
    expect(m.plugin.story.generatePreview).toHaveBeenCalledWith({ dueCount: s.defaultDueCount, lengthChars: s.defaultLengthChars, style: s.defaultStyle, targetHsk: "auto", includeGlossary: s.includeGlossary });
    await flush();
    expect(Notice.instances.at(-1)!.message).toBe("Story ready · score 0.91 · 1 repair pass(es).");
    vi.advanceTimersByTime(4000);
    expect(m.view.smartGenerating).toBe(false);
  });

  it("a second request while one is running is ignored", async () => {
    const m = await smart({ ready: true });
    let release!: (v: unknown) => void;
    m.plugin.story.generatePreview.mockImplementation(() => new Promise((r) => (release = r)));
    void m.view.runSmartGenerate(false);
    await m.view.runSmartGenerate(false);
    expect(m.plugin.story.generatePreview).toHaveBeenCalledTimes(1);
    release({ story: {}, score: 0, iterations: 0, file: file(PREVIEW) });
    await flush();
  });

  it("a failure is reported and the panel recovers", async () => {
    const m = await smart({ ready: true });
    m.plugin.story.generatePreview.mockRejectedValue(new Error("no key"));
    btn(m.root, "Generate story").click();
    await vi.waitFor(() => expect(Notice.instances.at(-1)?.message).toBe("Story generation failed: no key"));
    await flush();
    expect(m.view.smartGenerating).toBe(false);
    vi.advanceTimersByTime(6000);
  });

  it("generating again removes the old preview first, and tolerates it already being gone", async () => {
    const m = await smart({ ready: true, preview: true });
    await m.view.runSmartGenerate(true);
    expect(m.plugin.app.fileManager.trashFile).toHaveBeenCalledTimes(1);
    m.plugin.app.fileManager.trashFile.mockRejectedValue(new Error("gone"));
    await expect(m.view.runSmartGenerate(true)).resolves.toBeUndefined();
    await m.view.runSmartGenerate(false);
    expect(m.plugin.app.fileManager.trashFile).toHaveBeenCalledTimes(2);
  });

  it("generating again with no old preview just generates", async () => {
    const m = await smart({ ready: true });
    await m.view.runSmartGenerate(true);
    expect(m.plugin.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(m.plugin.story.generatePreview).toHaveBeenCalled();
  });
});

describe("the result", () => {
  it("shows the story's title and text when it is the preview this view made, then Open, Save, Generate again and Discard", async () => {
    const m = await smart({ ready: true, preview: true });
    m.view.currentPreview = { story: { title: "标题", textChinese: "这是正文" }, file: file(PREVIEW) };
    m.view.render();
    expect(q(m.root, ".cci-fc-smart-preview h4").textContent).toBe("标题");
    expect(q(m.root, ".cci-fc-smart-preview-text").textContent).toBe("这是正文");
    expect(qa(m.root, ".cci-fc-smart-actions button").map((b) => b.textContent)).toEqual(["Open preview", "Save as note", "Generate again", "Discard"]);
  });

  it("an untitled story is headed 'Generated story'; a preview from an earlier session shows only the actions", async () => {
    const m = await smart({ ready: true, preview: true });
    m.view.currentPreview = { story: { title: "", textChinese: "正文" }, file: file(PREVIEW) };
    m.view.render();
    expect(q(m.root, ".cci-fc-smart-preview h4").textContent).toBe("Generated story");
    m.view.currentPreview = { story: { title: "x", textChinese: "y" }, file: file("Other.md") };
    m.view.render();
    expect(q(m.root, ".cci-fc-smart-preview")).toBeNull();
    expect(btn(m.root, "Save as note")).toBeTruthy();
  });

  it("Generate again is disabled while generating", async () => {
    const m = await smart({ ready: true, preview: true });
    m.view.smartGenerating = true;
    m.view.render();
    expect((btn(m.root, "Generating…") as HTMLButtonElement).hasAttribute("disabled")).toBe(true);
  });

  it("Open preview opens it in the Chinese view", async () => {
    const m = await smart({ ready: true, preview: true });
    const setViewState = vi.fn(async () => {});
    m.plugin.app.workspace.getLeaf.mockReturnValue({ setViewState });
    btn(m.root, "Open preview").click();
    await flush();
    expect(m.plugin.app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(setViewState).toHaveBeenCalledWith({ type: "cci-chinese-view", state: { file: PREVIEW } });
  });

  it("Save as note keeps the preview as a note, says where, and clears it", async () => {
    const m = await smart({ ready: true, preview: true });
    m.view.currentPreview = { story: { title: "t", textChinese: "x" }, file: file(PREVIEW) };
    btn(m.root, "Save as note").click();
    await flush();
    expect(m.plugin.story.commitPreviewAsNote).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ path: PREVIEW }) }));
    expect(Notice.instances.at(-1)!.message).toBe("Saved to Stories/Saved.md.");
    expect(m.view.currentPreview).toBeNull();
  });

  it("Save as note works for a preview this session did not make, and a failure is reported", async () => {
    const m = await smart({ ready: true, preview: true });
    btn(m.root, "Save as note").click();
    await flush();
    expect(m.plugin.story.commitPreviewAsNote.mock.calls[0][0]).toMatchObject({ targets: [], score: 0, iterations: 0 });
    m.plugin.story.commitPreviewAsNote.mockRejectedValue(new Error("exists"));
    m.view.currentPreview = null;
    m.view.render();
    btn(m.root, "Save as note").click();
    await flush();
    expect(Notice.instances.at(-1)!.message).toBe("Save failed: exists");
  });

  it("Generate again from the result replaces the preview", async () => {
    const m = await smart({ ready: true, preview: true });
    btn(m.root, "Generate again").click();
    await flush();
    expect(m.plugin.story.generatePreview).toHaveBeenCalled();
  });

  it("Discard trashes the preview and forgets it, and does not mind it being gone already", async () => {
    const m = await smart({ ready: true, preview: true });
    m.view.currentPreview = { story: { title: "t", textChinese: "x" }, file: file(PREVIEW) };
    btn(m.root, "Discard").click();
    await flush();
    expect(m.plugin.app.fileManager.trashFile).toHaveBeenCalled();
    expect(m.view.currentPreview).toBeNull();
    const again = await smart({ ready: true, preview: true });
    again.plugin.app.fileManager.trashFile.mockRejectedValue(new Error("gone"));
    btn(again.root, "Discard").click();
    await flush();
    expect(again.view.currentPreview).toBeNull();
  });
});
