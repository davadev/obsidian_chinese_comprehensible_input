// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { Transaction } from "@codemirror/state";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { makeView, editorOf, actionsOf } from "./__mocks__/viewHarness";
import { VIEW_TYPE_CHINESE } from "../constants";

/**
 * #119, second half: the rest of ChineseTextFileView on a mounted view: the TextFileView surface Obsidian calls
 * (setViewData / getViewData / clear), which edits count as the user's (and so are saved), the header action, the
 * "Unsaved smart story preview" bar, the custom-word hand-off, and tap-to-format.
 */

installObsidianDom();

const captured: { opts?: any } = {};
vi.mock("../ui/EditDictionaryModal", () => ({
  EditDictionaryModal: class {
    constructor(_app: unknown, _plugin: unknown, opts: unknown) {
      captured.opts = opts;
    }
    open() {
      captured.opts = { ...captured.opts, opened: true };
    }
  },
}));

const guard = vi.hoisted(() => ({ preserves: null as null | boolean }));
vi.mock("../editor/formatApply", async (importOriginal) => {
  const m = await importOriginal<typeof import("../editor/formatApply")>();
  return { ...m, formattingPreservesContent: (d: string, c: any) => (guard.preserves === null ? m.formattingPreservesContent(d, c) : guard.preserves) };
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  Notice.instances.length = 0;
  captured.opts = undefined;
  guard.preserves = null;
});
afterEach(() => {
  document.body.innerHTML = "";
  Platform.isMobile = false;
});

describe("TextFileView surface", () => {
  it("identifies itself", () => {
    const withFile = makeView("", { file: { path: "a/笔记.md", basename: "笔记" } });
    expect(withFile.view.getViewType()).toBe(VIEW_TYPE_CHINESE);
    expect(withFile.view.getDisplayText()).toBe("中文: 笔记");
    expect(withFile.view.getIcon()).toBe("cci-zhong");
    expect(makeView("").view.getDisplayText()).toBe("Chinese Learning");
  });

  it("getViewData falls back to the stored text before the editor exists", () => {
    expect(makeView("原文\n").view.getViewData()).toBe("原文\n");
  });

  it("setViewData before the editor exists does not throw (Obsidian loads data before onOpen)", () => {
    const { view } = makeView("");
    expect(() => view.setViewData("你好\n", true)).not.toThrow();
  });

  it("setViewData swaps the note into the open editor, warming the tokenizer first, and strips frontmatter", async () => {
    const { view, plugin } = makeView("第一篇文章\n");
    await view.onOpen();
    plugin.tokenizer.tokenize.mockClear();
    view.setViewData("---\nk: v\n---\n第二篇文章\n", true);
    await tick();
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledWith("第二篇文章\n");
    expect(editorOf(view)!.state.doc.toString()).toBe("第二篇文章\n");
    expect(view.getViewData()).toBe("---\nk: v\n---\n第二篇文章\n");
  });

  it("setViewData with the same text only redecorates", async () => {
    const { view } = makeView("相同内容\n");
    await view.onOpen();
    const dispatch = vi.spyOn(editorOf(view)!, "dispatch");
    view.setViewData("相同内容\n", true);
    await tick();
    const specs = dispatch.mock.calls.map((c) => c[0] as { changes?: unknown; effects?: unknown });
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.every((sp) => sp.changes === undefined)).toBe(true); // no document change, only redecorate effects
  });

  it("a tokenizer that is not ready still lets the swap complete", async () => {
    const { view, plugin } = makeView("先\n");
    await view.onOpen();
    plugin.tokenizer.tokenize.mockRejectedValueOnce(new Error("no dictionary"));
    view.setViewData("后\n", true);
    await tick();
    expect(editorOf(view)!.state.doc.toString()).toBe("后\n");
  });

  it("clear() empties the editor and forgets the frontmatter", async () => {
    const { view } = makeView("---\na: b\n---\n内容\n");
    await view.onOpen();
    view.clear();
    expect(editorOf(view)!.state.doc.toString()).toBe("");
    expect(view.getViewData()).toBe("");
  });

  it("clear() before the editor exists is harmless", () => {
    expect(() => makeView("x").view.clear()).not.toThrow();
  });
});

describe("which edits are saved", () => {
  it("a USER edit asks Obsidian to save, and the echo of our own data is ignored", async () => {
    const { view } = makeView("你好\n", { mode: "edit" });
    await view.onOpen();
    const save = vi.spyOn(view, "requestSave");
    editorOf(view)!.dispatch({ changes: { from: 0, insert: "大" }, annotations: Transaction.userEvent.of("input.type") });
    expect(save).toHaveBeenCalledTimes(1);

    view.setViewData(view.getViewData(), false); // Obsidian handing our own text back must not rewrite the doc
    await tick();
    expect(editorOf(view)!.state.doc.toString()).toBe("大你好\n");
  });

  it("a programmatic edit (a file load) never saves, or it would overwrite the new file with the old text", async () => {
    const { view } = makeView("你好\n");
    await view.onOpen();
    const save = vi.spyOn(view, "requestSave");
    editorOf(view)!.dispatch({ changes: { from: 0, insert: "大" } });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("header action and focus", () => {
  it("'Edit in Markdown' hands the file to Obsidian's own editor in source mode", async () => {
    const { view } = makeView("你好\n", { file: { path: "a/笔记.md", basename: "笔记" } });
    await view.onOpen();
    const action = actionsOf(view).find((a) => a.title === "Edit in Markdown")!;
    await action.cb(null);
    expect((view as any).leaf.setViewState).toHaveBeenCalledWith({ type: "markdown", state: { file: "a/笔记.md", mode: "source" } });
  });

  it("with no file open the action does nothing", async () => {
    const { view } = makeView("你好\n");
    await view.onOpen();
    await actionsOf(view)[0].cb(null);
    expect((view as any).leaf.setViewState).not.toHaveBeenCalled();
  });

  it("on mobile a tap outside edit mode drops the keyboard focus again; in edit mode it keeps it", async () => {
    vi.useFakeTimers();
    try {
      Platform.isMobile = true;
      const { view, state } = makeView("你好\n");
      await view.onOpen();
      const dom = editorOf(view)!.contentDOM;
      const blur = vi.spyOn(dom, "blur");

      dom.dispatchEvent(new Event("focusin"));
      vi.runOnlyPendingTimers();
      expect(blur).toHaveBeenCalledTimes(1);

      state.mode = "edit";
      dom.dispatchEvent(new Event("focusin"));
      vi.runOnlyPendingTimers();
      expect(blur).toHaveBeenCalledTimes(1);

      state.mode = "read";
      Platform.isMobile = false;
      dom.dispatchEvent(new Event("focusin"));
      vi.runOnlyPendingTimers();
      expect(blur).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("custom word hand-off", () => {
  const open = (view: any, surface: string) => view.openAddCustomWord(surface);

  it("an empty selection tells the user and opens nothing", async () => {
    const { view } = makeView("x");
    await open(view, " \n ");
    expect(Notice.instances.map((n) => n.message)).toEqual(["Select one or more Chinese characters first."]);
    expect(captured.opts).toBeUndefined();
  });

  it("opens the dictionary editor in custom mode with a pinyin guess assembled per character", async () => {
    const pinyin: Record<string, string> = { 苹: "píng", 果: "guǒ" };
    const { view } = makeView("x", { plugin: { dictionary: { lookup: (s: string) => (pinyin[s] ? [{ pinyin: pinyin[s] }] : []) } } });
    await open(view, "苹 果");
    expect(captured.opts).toMatchObject({ mode: "custom", surface: "苹果", isExistingCustom: false, initial: { pinyin: "píng guǒ" }, opened: true });
  });

  it("a whole-word dictionary entry wins over per-character guesses", async () => {
    const { view } = makeView("x", { plugin: { dictionary: { lookup: (s: string) => (s === "苹果" ? [{ pinyin: "píng guǒ" }] : [{ pinyin: "?" }]) } } });
    await open(view, "苹果");
    expect(captured.opts.initial.pinyin).toBe("píng guǒ");
  });

  it("an existing custom word is opened for editing with its saved fields", async () => {
    const { view } = makeView("x", {
      plugin: { dictionaryCustomWords: { 苹果: { traditional: "蘋果", pinyin: "píng guǒ", definitions: ["apple"], hsk: { levels: ["2"] } } } },
    });
    await open(view, "苹果");
    expect(captured.opts).toMatchObject({
      isExistingCustom: true,
      initial: { traditional: "蘋果", pinyin: "píng guǒ", definitions: ["apple"], hskLevel: "2" },
    });
  });
});

describe("unsaved smart-story preview bar", () => {
  const file = { path: "Stories/preview.md", basename: "preview" };
  const setup = async (over: Record<string, unknown> = {}) => {
    const m = makeView("你好\n", {
      file,
      plugin: {
        story: {
          previewPath: () => file.path,
          commitPreviewAsNote: vi.fn(async () => ({ path: "Stories/saved.md" })),
          deletePreview: vi.fn(async () => {}),
          generatePreview: vi.fn(async () => ({ file: { path: "Stories/new.md" } })),
        },
        ...over,
      },
    });
    await m.view.onOpen();
    return m;
  };
  const bar = (root: HTMLElement) => root.querySelector(".cci-preview-actions")!;
  const button = (root: HTMLElement, text: string) => Array.from(bar(root).querySelectorAll("button")).find((b) => b.textContent === text)!;

  it("appears only for the preview file", async () => {
    const m = await setup();
    expect(bar(m.root).textContent).toContain("Unsaved smart story preview");
    const other = makeView("你好\n", { file: { path: "Notes/other.md", basename: "other" }, plugin: { story: { previewPath: () => file.path } } });
    await other.view.onOpen();
    expect(bar(other.root).children).toHaveLength(0);
  });

  it("Save as note commits the preview and opens the saved note", async () => {
    const m = await setup();
    button(m.root, "Save as note").click();
    await tick();
    expect(m.plugin.story.commitPreviewAsNote).toHaveBeenCalled();
    expect(Notice.instances.at(-1)!.message).toBe("Saved to Stories/saved.md.");
    expect(m.plugin.openFileInChineseView).toHaveBeenCalledWith({ path: "Stories/saved.md" });
  });

  it("a failed save says why and opens nothing", async () => {
    const m = await setup();
    m.plugin.story.commitPreviewAsNote.mockRejectedValue(new Error("disk full"));
    button(m.root, "Save as note").click();
    await tick();
    expect(Notice.instances.at(-1)!.message).toBe("Save failed: disk full");
    expect(m.plugin.openFileInChineseView).not.toHaveBeenCalled();
  });

  it("Discard trashes the preview and returns to Smart stories", async () => {
    const m = await setup();
    button(m.root, "Discard").click();
    await tick();
    expect(m.plugin.app.fileManager.trashFile).toHaveBeenCalledWith(file);
    expect(m.plugin.settings.flashcardsMode).toBe("smart");
    expect(m.plugin.saveSettings).toHaveBeenCalled();
    expect(m.plugin.openStatsView).toHaveBeenCalled();
  });

  it("Discard still returns to Smart stories when the file is already gone", async () => {
    const m = await setup();
    m.plugin.app.fileManager.trashFile.mockRejectedValue(new Error("missing"));
    button(m.root, "Discard").click();
    await tick();
    expect(m.plugin.openStatsView).toHaveBeenCalled();
  });

  it("Generate again replaces the preview with a new one", async () => {
    const m = await setup();
    const regen = button(m.root, "Generate again");
    regen.click();
    await tick();
    expect(regen.textContent).toBe("Generating...");
    expect(m.plugin.story.deletePreview).toHaveBeenCalled();
    expect(m.plugin.story.generatePreview).toHaveBeenCalledWith(expect.objectContaining({ targetHsk: "auto" }));
    expect(m.plugin.openFileInChineseView).toHaveBeenCalledWith({ path: "Stories/new.md" });
  });

  it("a failed generation restores the button and says why", async () => {
    const m = await setup();
    m.plugin.story.generatePreview.mockRejectedValue(new Error("no key"));
    const regen = button(m.root, "Generate again");
    regen.click();
    await tick();
    expect(Notice.instances.at(-1)!.message).toBe("Generation failed: no key");
    expect(regen.textContent).toBe("Generate again");
    expect(regen.hasAttribute("disabled")).toBe(false);
  });

  it("Back to Smart stories opens the stats view in smart mode", async () => {
    const m = await setup();
    button(m.root, "Back to Smart stories").click();
    await tick();
    expect(m.plugin.settings.flashcardsMode).toBe("smart");
    expect(m.plugin.openStatsView).toHaveBeenCalled();
  });

  it("refreshToolbar redraws the bar", async () => {
    const m = await setup();
    const spy = vi.spyOn(m.view as any, "refreshPreviewActions");
    m.view.refreshToolbar();
    expect(spy).toHaveBeenCalled();
  });
});

describe("tap-to-format on the editor", () => {
  const doc = "你好世界\n";

  it("adds formats as a USER edit, so the note is saved", async () => {
    const { view } = makeView(doc);
    await view.onOpen();
    const save = vi.spyOn(view, "requestSave");
    view.applyFormatToRange(0, 2, ["bold"]);
    expect(editorOf(view)!.state.doc.toString()).toBe("**你好**世界\n");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("removes the named formats in reverse mode", async () => {
    const { view } = makeView("**你好**世界\n");
    await view.onOpen();
    view.applyFormatToRange(2, 4, ["bold"], undefined, true);
    expect(editorOf(view)!.state.doc.toString()).toBe("你好世界\n");
  });

  it("clears all formatting when nothing is armed", async () => {
    const { view } = makeView("**你好**世界\n");
    await view.onOpen();
    view.applyFormatToRange(2, 4, []);
    expect(editorOf(view)!.state.doc.toString()).toBe("你好世界\n");
  });

  it("does nothing when there is nothing to change", async () => {
    const { view } = makeView(doc);
    await view.onOpen();
    const dispatch = vi.spyOn(editorOf(view)!, "dispatch");
    view.applyFormatToRange(0, 2, []);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("aborts, without writing, if the edit would alter the note's text (data-loss guard)", async () => {
    const { view } = makeView(doc);
    await view.onOpen();
    guard.preserves = false;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    view.applyFormatToRange(0, 2, ["bold"]);
    expect(editorOf(view)!.state.doc.toString()).toBe(doc);
    expect(Notice.instances.at(-1)!.message).toContain("Formatting change aborted");
  });

  it("with no editor open it is a no-op", () => {
    expect(() => makeView(doc).view.applyFormatToRange(0, 2, ["bold"])).not.toThrow();
  });
});

describe("redecorate helpers", () => {
  it("forceRetokenize and redecorate dispatch their effects on a mounted view, and are no-ops without one", async () => {
    const closed = makeView(doc());
    expect(() => {
      closed.view.forceRetokenize();
      closed.view.redecorate();
      closed.view.reconfigureEditor();
    }).not.toThrow();

    const { view } = makeView(doc());
    await view.onOpen();
    const dispatch = vi.spyOn(editorOf(view)!, "dispatch");
    view.forceRetokenize();
    view.redecorate();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("opening a traditional-script note asks the plugin whether to switch script", async () => {
    const { view, plugin } = makeView("漢語學習\n");
    await view.onOpen();
    expect(plugin.maybeSuggestTraditional).toHaveBeenCalledWith("漢語學習\n");
  });
});

function doc() {
  return "你好\n";
}
