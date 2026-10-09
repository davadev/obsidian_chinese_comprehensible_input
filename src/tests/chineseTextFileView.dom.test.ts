// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { makeView, editorOf, actionsOf } from "./__mocks__/viewHarness";
import CciPlugin from "../main";

/**
 * #119: the real ChineseTextFileView mounting a real CodeMirror EditorView in a DOM. happy-dom has no layout, so
 * nothing here measures anything: this pins the lifecycle rules in CLAUDE.md that used to be checkable only by
 * opening the app (pre-warm before the editor exists, frontmatter stripped at the view boundary, mode changes
 * reconfigure rather than rebuild). Geometry stays with `npm run check:layout`.
 */

installObsidianDom();


afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChineseTextFileView mounted in a DOM (#119)", () => {
  it("opens with the toolbar and a CodeMirror editor holding the note text", async () => {
    const { view, root } = makeView("你好，世界。\n");
    await view.onOpen();
    expect(root.classList.contains("cci-view")).toBe(true);
    expect(root.querySelector(".cci-toolbar-row")).toBeTruthy();
    expect(root.querySelector(".cm-editor")).toBeTruthy();
    expect(root.querySelector(".cm-content")?.textContent).toContain("你好，世界。");
    expect(actionsOf(view).map((a) => a.title)).toContain("Edit in Markdown");
  });

  it("pre-warms the tokenizer BEFORE the editor exists, so the decoration plugin finds the cache on first paint", async () => {
    // If the editor were built first, the decoration plugin's constructor would miss the cache and start its own
    // async tokenize: a second call, and a first paint without decorations (the bug fixed in 0.1.44).
    const { view, plugin } = makeView("预热顺序测试：你好世界\n");
    await view.onOpen();
    await new Promise((r) => setTimeout(r, 0));
    expect(plugin.tokenizer.tokenize).toHaveBeenCalledTimes(1);
  });

  it("strips frontmatter at the view boundary and puts it back on save", async () => {
    const { view, root } = makeView("---\ntags: [a]\n---\n你好\n");
    await view.onOpen();
    expect(root.querySelector(".cm-content")?.textContent).not.toContain("tags");
    expect(root.querySelector(".cm-content")?.textContent).toContain("你好");
    expect(view.getViewData()).toBe("---\ntags: [a]\n---\n你好\n");
  });

  it("crossing the edit boundary reconfigures the SAME EditorView: no destroy, no rebuild", async () => {
    const { view, root, state } = makeView("你好\n");
    await view.onOpen();
    const before = editorOf(view)!;
    const dom = root.querySelector(".cm-editor");
    const destroy = vi.spyOn(before, "destroy");

    expect(before.contentDOM.getAttribute("contenteditable")).toBe("false");
    state.mode = "edit";
    view.reconfigureEditor();
    expect(editorOf(view)).toBe(before);
    expect(root.querySelector(".cm-editor")).toBe(dom);
    expect(destroy).not.toHaveBeenCalled();
    expect(before.contentDOM.getAttribute("contenteditable")).toBe("true");

    state.mode = "read";
    view.reconfigureEditor();
    expect(editorOf(view)).toBe(before);
    expect(before.contentDOM.getAttribute("contenteditable")).toBe("false");
  });

  it("applySettingsToView on a mounted view does not redecorate; a toolbar change does, once", async () => {
    const { view, root, plugin } = makeView("你好\n");
    await view.onOpen();
    const redecorate = vi.spyOn(view, "redecorate");
    plugin.settings.readerFontPx = 31;
    view.applySettingsToView();
    expect(redecorate).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue("--cci-reader-font")).toBe("31px");

    (view as any).handleToolbarChange();
    expect(redecorate).toHaveBeenCalledTimes(1);
  });

  it("closing destroys the editor and resets the exposure session", async () => {
    const { view, plugin } = makeView("你好\n");
    await view.onOpen();
    const ed = editorOf(view)!;
    const destroy = vi.spyOn(ed, "destroy");
    await view.onClose();
    expect(destroy).toHaveBeenCalled();
    expect(editorOf(view)).toBeNull();
    expect(plugin.exposure.resetSession).toHaveBeenCalled();
  });
});

describe("tap-to-format through the real plugin method and a mounted view (#112, #119)", () => {
  /** The real CciPlugin.applyFormatRange, run against a mounted view; `this` is a plain object with what it reads. */
  async function tapRange(settings: Record<string, unknown>, from: number, to: number) {
    const { view, plugin } = makeView("你好世界\n");
    await view.onOpen();
    Object.assign(plugin.settings, settings);
    const self: any = {
      pendingFormatStart: from,
      pendingFormatStartSurface: "x",
      settings: plugin.settings,
      app: { workspace: { getLeavesOfType: () => [{ view }] } },
      refreshChineseViewToolbars: vi.fn(),
    };
    (CciPlugin.prototype as any).applyFormatRange.call(self, to);
    return { doc: editorOf(view)!.state.doc.toString(), self };
  }

  it("plain highlight armed: writes ==…== into the editor and clears the pending start", async () => {
    const { doc, self } = await tapRange({ einkMode: false, enabledFormats: ["highlight"] }, 0, 2);
    expect(doc).toBe("==你好==世界\n");
    expect(self.pendingFormatStart).toBeNull();
    expect(self.refreshChineseViewToolbars).toHaveBeenCalled();
  });

  it("E-ink mode: an armed saved colour is written as the plain highlight, not as a coloured mark", async () => {
    const { doc } = await tapRange(
      { einkMode: true, enabledFormats: ["hl:pink"], showHighlightColorsWithoutPlugin: true },
      0,
      2
    );
    expect(doc).toBe("==你好==世界\n");
  });

  it("E-ink off: the same armed colour writes a coloured mark (the overlay is the only difference)", async () => {
    const { doc } = await tapRange(
      { einkMode: false, enabledFormats: ["hl:pink"], showHighlightColorsWithoutPlugin: true },
      0,
      2
    );
    expect(doc).not.toBe("==你好==世界\n");
    expect(doc).toContain("你好");
    expect(doc).toMatch(/<mark|style=/);
  });

  it("tapping the end before the start still formats the same span", async () => {
    const { doc } = await tapRange({ einkMode: false, enabledFormats: ["highlight"] }, 2, 0);
    expect(doc).toBe("==你好==世界\n");
  });
});
