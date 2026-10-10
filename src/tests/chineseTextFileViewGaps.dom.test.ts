// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { makeView, editorOf, actionsOf } from "./__mocks__/viewHarness";

/**
 * The rest of ChineseTextFileView: the frontmatter edge cases (a note's `---` block must survive a round trip
 * whatever it looks like), settings that arrive null, and races between loading a note and closing the view.
 */

installObsidianDom();

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("frontmatter at the view boundary", () => {
  const cases: Array<[string, string, string]> = [
    ["a bare '---' with no newline", "---", "---"],
    ["an opening line that is not exactly '---'", "--- not frontmatter\n你好\n", "--- not frontmatter\n你好\n"],
    ["a block that never closes", "---\na: 1\n你好", "---\na: 1\n你好"],
    ["a block closed by '---' at the very end of the file", "---\na: 1\n---", ""],
    ["a block closed and followed by text", "---\na: 1\n---\n你好\n", "你好\n"],
    ["a closing line with spaces around it", "---\na: 1\n  ---  \n你好", "你好"],
  ];
  it.each(cases)("round-trips %s", async (_n, data, body) => {
    const { view } = makeView(data);
    await view.onOpen();
    expect(editorOf(view)!.state.doc.toString()).toBe(body);
    expect(view.getViewData()).toBe(data);
  });

  it("does not look past 200 lines for the closing '---'", async () => {
    const data = "---\n" + "k: v\n".repeat(250) + "---\n你好";
    const { view } = makeView(data);
    await view.onOpen();
    expect(editorOf(view)!.state.doc.toString()).toBe(data);
  });

  it("opens a view whose data is not set yet", async () => {
    const { view } = makeView("");
    (view as unknown as { data: unknown }).data = undefined;
    await view.onOpen();
    expect(editorOf(view)!.state.doc.toString()).toBe("");
    expect(view.getViewData()).toBe("");
  });
});

describe("what the toolbar asks the view for", () => {
  it("the document text comes from the editor, and from the stored data when there is none", async () => {
    const { view } = makeView("正文\n");
    await view.onOpen();
    const toolbar = (view as unknown as { toolbar: { getDocText: () => string } }).toolbar;
    expect(toolbar.getDocText()).toBe("正文\n");
    await view.onClose();
    expect(toolbar.getDocText()).toBe("正文\n");
    (view as unknown as { data: unknown }).data = undefined;
    expect(toolbar.getDocText()).toBe("");
  });
});

describe("settings that arrive null (import, sync, hand-edited data.json)", () => {
  it("fall back to the defaults for font, line spacing and annotation scale", async () => {
    const { view, root, plugin } = makeView("你好\n");
    await view.onOpen();
    Object.assign(plugin.settings, { readerFontPx: null, readerLineSpacing: null, annotationScalePercent: null });
    view.applyReaderFont();
    view.applyReaderLineSpacing();
    view.applyAnnotationScales();
    expect(root.style.getPropertyValue("--cci-reader-font")).toBe("22px");
    expect(root.style.getPropertyValue("--cci-line-spacing")).toBe("1");
    expect(root.style.getPropertyValue("--cci-annotation-scale")).toBe("1");
  });
});

describe("races and failures", () => {
  it("a note that finishes loading after the view was closed is dropped quietly", async () => {
    const { view, plugin } = makeView("先\n");
    await view.onOpen();
    let release!: () => void;
    plugin.tokenizer.tokenize.mockImplementationOnce(() => new Promise<never[]>((r) => (release = () => r([]))));
    view.setViewData("后\n", true);
    await view.onClose();
    release();
    await tick();
    expect(editorOf(view)).toBeNull();
  });

  it("opening twice replaces the first editor instead of leaking it", async () => {
    const { view } = makeView("你好\n");
    await view.onOpen();
    const first = editorOf(view)!;
    const destroy = vi.spyOn(first, "destroy");
    await view.onOpen();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(editorOf(view)).not.toBe(first);
  });

  it("a settings change still applies when CodeMirror cannot say where the scroll is", async () => {
    const { view, root } = makeView("你好\n");
    await view.onOpen();
    vi.spyOn(editorOf(view)!, "lineBlockAtHeight").mockImplementation(() => {
      throw new Error("not measured yet");
    });
    expect(() => view.applySettingsToView()).not.toThrow();
    expect(() => view.reconfigureEditor()).not.toThrow();
    expect(root.getAttribute("data-display")).toBeTruthy();
  });

  it("a settings change before the editor exists only updates the root element", () => {
    const { view, root } = makeView("你好\n");
    (view as unknown as { containerEl: unknown }).containerEl = {
      children: [document.createElement("div"), root],
    };
    expect(() => view.applySettingsToView()).not.toThrow();
  });

  it("the header pencil opens the note in Obsidian's Markdown view, in source mode", async () => {
    const { view } = makeView("你好\n", { file: { path: "a/笔记.md", basename: "笔记" } });
    await view.onOpen();
    const pencil = actionsOf(view).find((a) => a.icon === "pencil")!;
    await pencil.cb(null);
    expect((view as unknown as { leaf: { setViewState: ReturnType<typeof vi.fn> } }).leaf.setViewState).toHaveBeenCalledWith({
      type: "markdown",
      state: { file: "a/笔记.md", mode: "source" },
    });
  });

  it("a mobile tap in a view that has since moved to edit mode is not blurred", async () => {
    vi.useFakeTimers();
    try {
      const { Platform } = await import("obsidian");
      Platform.isMobile = true;
      const { view, state } = makeView("你好\n");
      await view.onOpen();
      const dom = editorOf(view)!.contentDOM;
      const blur = vi.spyOn(dom, "blur");
      dom.dispatchEvent(new Event("focusin"));
      state.mode = "edit"; // between the tap and the timer
      vi.runOnlyPendingTimers();
      expect(blur).not.toHaveBeenCalled();
      Platform.isMobile = false;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a custom word guess skips characters the dictionary does not know", async () => {
    const { view } = makeView("x", { plugin: { dictionary: { lookup: (s: string) => (s === "苹" ? [{ pinyin: "píng" }] : []) } } });
    expect((view as unknown as { guessPinyinForSurface: (s: string) => string }).guessPinyinForSurface("苹果")).toBe("píng");
  });
});
