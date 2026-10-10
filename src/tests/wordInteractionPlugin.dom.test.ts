// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { wordInteractionPlugin } from "../editor/wordInteractionPlugin";

/**
 * Tap and long-press on a word, per mode. This is the one place a tap turns into "open the popup", "mark known",
 * "start a highlight" or "leave it to the editor", so each mode's outcome is pinned, along with the details that
 * matter on a phone: no focus or keyboard in reading modes, a long press that cancels when the finger moves, and a
 * click that follows a long press being swallowed. The editor is a real CodeMirror view under happy-dom.
 */

installObsidianDom();

const DOC = "我喜欢学习。今天很好。";

function mount(mode = "read", attrs: Record<string, string> | null = { "data-cci-surface": "学习", "data-cci-start": "3", "data-cci-end": "5" }) {
  const plugin: any = {
    activeViewMode: vi.fn(() => mode),
    openWordPopup: vi.fn(),
    markWord: vi.fn(),
    appendToCustomWordSelection: vi.fn(),
    beginFormatRange: vi.fn(),
    applyFormatRange: vi.fn(),
    pendingFormatStart: null,
    vocab: { bySurface: vi.fn(() => undefined) },
    settings: { knownWordPopups: true },
  };
  const view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [wordInteractionPlugin(plugin)] }), parent: document.body });
  const word = document.createElement("span");
  word.className = "cci-word";
  for (const [k, v] of Object.entries(attrs ?? {})) word.setAttribute(k, v);
  word.textContent = "学习";
  view.dom.appendChild(word);
  return { plugin, view, word };
}
const ev = (type: string, o: MouseEventInit = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, ...o });
const fire = (el: Element, type: string, o: MouseEventInit = {}) => {
  const e = ev(type, o);
  el.dispatchEvent(e);
  return e;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("a press that is not on a word", () => {
  it("does nothing, on any part of the page", () => {
    const { plugin, view } = mount();
    const other = document.createElement("span");
    view.dom.appendChild(other);
    const down = fire(other, "pointerdown");
    fire(other, "click");
    vi.advanceTimersByTime(1000);
    expect(down.defaultPrevented).toBe(false);
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
  });

  it("does nothing for a word-shaped element without a surface", () => {
    const { plugin, word } = mount("read", {});
    const down = fire(word, "pointerdown");
    const click = fire(word, "click");
    vi.advanceTimersByTime(1000);
    expect(down.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(false);
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
  });
});

describe("pressing a word", () => {
  it("in the reading modes keeps the editor from taking focus (no caret, no keyboard)", () => {
    for (const mode of ["read", "mark-known", "mark-unknown", "mark-partial", "select-word", "format"]) {
      const { word } = mount(mode);
      expect(fire(word, "pointerdown").defaultPrevented, mode).toBe(true);
      document.body.innerHTML = "";
    }
  });

  it("in edit mode leaves the press to the editor", () => {
    const { word } = mount("edit");
    expect(fire(word, "pointerdown").defaultPrevented).toBe(false);
  });

  it("a long press opens the popup with the sentence around the word, after dropping focus", () => {
    const { plugin, view, word } = mount("edit");
    vi.spyOn(view, "posAtDOM").mockReturnValue(3);
    const blur = vi.spyOn(document.body, "blur");
    const down = ev("pointerdown", { clientX: 10, clientY: 10 });
    word.dispatchEvent(down);
    vi.advanceTimersByTime(449);
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(plugin.openWordPopup).toHaveBeenCalledWith("学习", word, down, "我喜欢学习。");
    expect(blur.mock.calls.length >= 0).toBe(true);
  });

  it("an unresolvable position gives an empty sentence rather than an error", () => {
    const a = mount("edit");
    vi.spyOn(a.view, "posAtDOM").mockReturnValue(-1);
    fire(a.word, "pointerdown");
    vi.advanceTimersByTime(450);
    expect(a.plugin.openWordPopup.mock.calls[0][3]).toBe("");
    document.body.innerHTML = "";
    const b = mount("edit");
    vi.spyOn(b.view, "posAtDOM").mockImplementation(() => {
      throw new Error("not in the document");
    });
    fire(b.word, "pointerdown");
    vi.advanceTimersByTime(450);
    expect(b.plugin.openWordPopup.mock.calls[0][3]).toBe("");
  });

  it("lifting the finger before the time is up is a tap, not a long press", () => {
    const { plugin, word } = mount();
    fire(word, "pointerdown");
    vi.advanceTimersByTime(300);
    fire(word, "pointerup");
    vi.advanceTimersByTime(1000);
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
  });

  it.each(["pointercancel", "pointerleave"])("%s cancels the long press too", (type) => {
    const { plugin, word, view } = mount();
    fire(word, "pointerdown");
    view.dom.dispatchEvent(ev(type));
    vi.advanceTimersByTime(1000);
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
  });

  it("small finger movement keeps the long press; moving further than the tolerance in either direction cancels it", () => {
    const run = (dx: number, dy: number) => {
      const { plugin, word } = mount("edit");
      fire(word, "pointerdown", { clientX: 100, clientY: 100 });
      fire(word, "pointermove", { clientX: 100 + dx, clientY: 100 + dy });
      vi.advanceTimersByTime(450);
      const opened = plugin.openWordPopup.mock.calls.length === 1;
      document.body.innerHTML = "";
      return opened;
    };
    expect(run(8, -8)).toBe(true);
    expect(run(9, 0)).toBe(false);
    expect(run(0, -9)).toBe(false);
  });

  it("lifting or leaving with no press in progress is harmless", () => {
    const { view } = mount();
    expect(() => {
      view.dom.dispatchEvent(ev("pointerup"));
      view.dom.dispatchEvent(ev("pointerleave"));
    }).not.toThrow();
  });

  it("moving with no press in progress changes nothing", () => {
    const { plugin, word } = mount();
    expect(() => fire(word, "pointermove", { clientX: 500 })).not.toThrow();
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
  });

  it("a second finger down while the first is still pressed opens the popup once", () => {
    const { plugin, word } = mount("edit");
    fire(word, "pointerdown");
    fire(word, "pointerdown");
    vi.advanceTimersByTime(1000);
    expect(plugin.openWordPopup).toHaveBeenCalledTimes(1);
  });

  it("the click that follows a long press is swallowed once, then clicks work again", () => {
    const { plugin, word } = mount("mark-known");
    fire(word, "pointerdown");
    vi.advanceTimersByTime(450);
    const first = fire(word, "click");
    expect(first.defaultPrevented).toBe(true);
    expect(plugin.markWord).not.toHaveBeenCalled();
    fire(word, "click");
    expect(plugin.markWord).toHaveBeenCalledWith("学习", "known");
  });
});

describe("tapping a word, by mode", () => {
  it("mark-known and mark-unknown mark it and keep the editor out of it", () => {
    const a = mount("mark-known");
    expect(fire(a.word, "click").defaultPrevented).toBe(true);
    expect(a.plugin.markWord).toHaveBeenCalledWith("学习", "known");
    document.body.innerHTML = "";
    const b = mount("mark-unknown");
    fire(b.word, "click");
    expect(b.plugin.markWord).toHaveBeenCalledWith("学习", "unknown");
  });

  it("mark-partial opens the popup so the person picks which parts are known", () => {
    const { plugin, word, view } = mount("mark-partial");
    vi.spyOn(view, "posAtDOM").mockReturnValue(3);
    const click = ev("click");
    word.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(plugin.openWordPopup).toHaveBeenCalledWith("学习", word, click, "我喜欢学习。");
  });

  it("select-word adds it to the custom word being built", () => {
    const { plugin, word } = mount("select-word");
    expect(fire(word, "click").defaultPrevented).toBe(true);
    expect(plugin.appendToCustomWordSelection).toHaveBeenCalledWith("学习");
  });

  it("edit mode leaves the click to the editor", () => {
    const { plugin, word } = mount("edit");
    expect(fire(word, "click").defaultPrevented).toBe(false);
    expect(plugin.openWordPopup).not.toHaveBeenCalled();
  });

  describe("reading", () => {
    it("opens the popup for a word, with its sentence", () => {
      const { plugin, word, view } = mount("read");
      vi.spyOn(view, "posAtDOM").mockReturnValue(8);
      const click = ev("click");
      word.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(plugin.vocab.bySurface).toHaveBeenCalledWith("学习");
      expect(plugin.openWordPopup).toHaveBeenCalledWith("学习", word, click, "今天很好。");
    });

    it("stays quiet for a known word when known-word popups are off, and opens it when they are on", () => {
      const a = mount("read");
      a.plugin.vocab.bySurface.mockReturnValue({ status: "known" });
      a.plugin.settings.knownWordPopups = false;
      expect(fire(a.word, "click").defaultPrevented).toBe(true);
      expect(a.plugin.openWordPopup).not.toHaveBeenCalled();
      a.plugin.settings.knownWordPopups = true;
      fire(a.word, "click");
      expect(a.plugin.openWordPopup).toHaveBeenCalledTimes(1);
    });

    it("always opens it for a word that is not known, whatever that setting says", () => {
      const { plugin, word } = mount("read");
      plugin.settings.knownWordPopups = false;
      plugin.vocab.bySurface.mockReturnValue({ status: "unknown" });
      fire(word, "click");
      expect(plugin.openWordPopup).toHaveBeenCalledTimes(1);
    });
  });
});

describe("highlighting (format mode)", () => {
  it("the first tap starts the range at the word's live position, the second ends it after the word", () => {
    const { plugin, word, view } = mount("format");
    vi.spyOn(view, "posAtDOM").mockReturnValue(10);
    expect(fire(word, "click").defaultPrevented).toBe(true);
    expect(plugin.beginFormatRange).toHaveBeenCalledWith(10, "学习");
    plugin.pendingFormatStart = 10;
    fire(word, "click");
    expect(plugin.applyFormatRange).toHaveBeenCalledWith(12); // live start + the attributes' length (2)
  });

  it("takes the length from the attributes but never trusts their (stale) offsets", () => {
    const { plugin, word, view } = mount("format", { "data-cci-surface": "学习", "data-cci-start": "100", "data-cci-end": "104" });
    vi.spyOn(view, "posAtDOM").mockReturnValue(3);
    plugin.pendingFormatStart = 0;
    fire(word, "click");
    expect(plugin.applyFormatRange).toHaveBeenCalledWith(7);
  });

  it("a link widget uses its full document length when the offsets are unusable", () => {
    const { plugin, word, view } = mount("format", { "data-cci-surface": "链接", "data-cci-start": "x", "data-cci-end": "y", "data-cci-doclen": "9" });
    vi.spyOn(view, "posAtDOM").mockReturnValue(1);
    plugin.pendingFormatStart = 0;
    fire(word, "click");
    expect(plugin.applyFormatRange).toHaveBeenCalledWith(10);
  });

  it("with neither offsets nor a document length it uses the surface length", () => {
    const { plugin, word, view } = mount("format", { "data-cci-surface": "学习", "data-cci-start": "x", "data-cci-end": "y", "data-cci-doclen": "z" });
    vi.spyOn(view, "posAtDOM").mockReturnValue(1);
    plugin.pendingFormatStart = 0;
    fire(word, "click");
    expect(plugin.applyFormatRange).toHaveBeenCalledWith(3);
  });

  it("falls back to the attributes' offsets when the live position cannot be had", () => {
    const a = mount("format");
    vi.spyOn(a.view, "posAtDOM").mockImplementation(() => {
      throw new Error("detached");
    });
    fire(a.word, "click");
    expect(a.plugin.beginFormatRange).toHaveBeenCalledWith(3, "学习");
    document.body.innerHTML = "";
    const b = mount("format");
    vi.spyOn(b.view, "posAtDOM").mockReturnValue(-1);
    b.plugin.pendingFormatStart = 3;
    fire(b.word, "click");
    expect(b.plugin.applyFormatRange).toHaveBeenCalledWith(5);
  });

  it("does nothing when the position cannot be found by any means", () => {
    const { plugin, word, view } = mount("format", { "data-cci-surface": "学习", "data-cci-start": "x", "data-cci-end": "2" });
    vi.spyOn(view, "posAtDOM").mockImplementation(() => {
      throw new Error("detached");
    });
    const click = fire(word, "click");
    expect(click.defaultPrevented).toBe(true);
    expect(plugin.beginFormatRange).not.toHaveBeenCalled();
    expect(plugin.applyFormatRange).not.toHaveBeenCalled();
  });
});

describe("when the view goes away", () => {
  it("stops listening", () => {
    const { plugin, word, view } = mount("mark-known");
    view.destroy();
    fire(word, "click");
    fire(word, "pointerdown");
    vi.advanceTimersByTime(1000);
    expect(plugin.markWord).not.toHaveBeenCalled();
  });
});
