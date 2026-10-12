// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { WhatsNewModal } from "../ui/whatsNew/WhatsNewModal";
import { AiSetupModal } from "../ui/AiSetupModal";
import type { ReleaseNote } from "../ui/whatsNew/releaseNotes";
import { FIGURE_IDS, renderFigure } from "../ui/whatsNew/figures";
import { RELEASE_NOTES } from "../ui/whatsNew/releaseNotes";

/** The two small dialogs: the one-time "What's new" popup and the "Set up AI first" prompt. */

installObsidianDom();
afterEach(() => (document.body.innerHTML = ""));

const NOTES: ReleaseNote[] = [
  { version: "0.9.0", title: "What's new in 0.9.0", intro: "Intro one.", items: [{ title: "A", text: "first" }, { title: "B", text: "second" }] },
  { version: "0.9.1", title: "What's new in 0.9.1", intro: "Intro two.", items: [{ title: "C", text: "third" }] },
];
const btn = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text)!;

describe("WhatsNewModal", () => {
  it("shows a section per note with its items, and closes on Got it", () => {
    const modal = new WhatsNewModal(new App() as any, NOTES);
    modal.open();
    const root = modal.contentEl as HTMLElement;
    expect(Array.from(root.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["What's new in 0.9.0", "What's new in 0.9.1"]);
    expect(root.querySelectorAll(".cci-whatsnew-intro")).toHaveLength(2);
    const items = Array.from(root.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["A — first", "B — second", "C — third"]);
    expect(root.querySelector("li strong")!.textContent).toBe("A");
    expect(modal.containerEl.classList.contains("cci-modal-front")).toBe(true);
    const close = vi.spyOn(modal, "close");
    btn(root, "Got it").click();
    expect(close).toHaveBeenCalled();
  });

  it("draws an item's illustration under its text, and only for items that have one", () => {
    const withFigure: ReleaseNote[] = [{ version: "0.9.0", title: "T", intro: "I", items: [{ title: "A", text: "a", figure: "toolbar" }, { title: "B", text: "b" }] }];
    const modal = new WhatsNewModal(new App() as any, withFigure);
    modal.open();
    const items = Array.from((modal.contentEl as HTMLElement).querySelectorAll("li"));
    expect(items[0].querySelector(".cci-whatsnew-figure.cci-fig-toolbar")).toBeTruthy();
    expect(items[1].querySelector(".cci-whatsnew-figure")).toBeNull();
  });

  it("empties itself when closed", () => {
    const modal = new WhatsNewModal(new App() as any, NOTES);
    modal.open();
    modal.close();
    expect((modal.contentEl as HTMLElement).textContent).toBe("");
  });
});

describe("AiSetupModal", () => {
  const make = (setting: unknown) => {
    const app: any = new App();
    app.setting = setting;
    const modal = new AiSetupModal(app, "chinese-comprehensible-input", "Explain");
    modal.open();
    return { modal, root: modal.contentEl as HTMLElement };
  };

  it("says what is missing and names the feature", () => {
    const { root } = make(undefined);
    expect(root.querySelector("h2")!.textContent).toBe("Set up AI first");
    expect(root.textContent).toContain("Explain needs an AI provider.");
    expect(root.textContent).toContain("OpenAI API key");
    expect(root.textContent).toContain("Ollama");
  });

  it("Open settings closes the dialog and opens this plugin's tab", () => {
    const setting = { open: vi.fn(), openTabById: vi.fn() };
    const { modal, root } = make(setting);
    const close = vi.spyOn(modal, "close");
    btn(root, "Open settings").click();
    expect(close).toHaveBeenCalled();
    expect(setting.open).toHaveBeenCalled();
    expect(setting.openTabById).toHaveBeenCalledWith("chinese-comprehensible-input");
  });

  it("copes with an Obsidian that has no settings handle, and Not now just closes", () => {
    const { root } = make(undefined);
    expect(() => btn(root, "Open settings").click()).not.toThrow();
    const again = make({ open: vi.fn(), openTabById: vi.fn() });
    const close = vi.spyOn(again.modal, "close");
    btn(again.root, "Not now").click();
    expect(close).toHaveBeenCalled();
    again.modal.close();
    expect(again.root.textContent).toBe("");
  });
});

describe("figures", () => {
  const draw = (id: "toolbar" | "mnemonic") => renderFigure(document.createElement("div"), id);

  it("are decoration only: hidden from screen readers and not clickable", () => {
    for (const id of FIGURE_IDS) expect(draw(id).getAttribute("aria-hidden")).toBe("true");
  });

  it("show the toolbar before and now: two pills become one button", () => {
    const fig = draw("toolbar");
    const lines = Array.from(fig.querySelectorAll(".cci-fig-line"));
    expect(lines.map((l) => l.querySelector(".cci-fig-label")!.textContent)).toEqual(["Before", "Now"]);
    expect(lines[0].querySelectorAll(".cci-fig-pill")).toHaveLength(2);
    expect(lines[0].querySelector(".cci-fig-pill.is-on")!.textContent).toBe("Status");
    expect(lines[0].querySelector(".cci-fig-mode")).toBeNull();
    expect(lines[1].querySelectorAll(".cci-fig-pill")).toHaveLength(0);
    expect(lines[1].querySelector(".cci-fig-mode")!.textContent).toBe("Status");
    // the same icon buttons around it on both rows
    expect(lines[0].querySelectorAll(".cci-fig-btn")).toHaveLength(lines[1].querySelectorAll(".cci-fig-btn").length);
    expect(fig.querySelector(".cci-fig-caption")!.textContent).toContain("tap it to switch");
  });

  it("show a mnemonic as it appears over a word, with the tone after each picture", () => {
    const fig = draw("mnemonic");
    expect(fig.querySelector(".cci-fig-mnemonic")!.textContent).toBe("🗺️²📖¹🏛️³");
    expect(fig.querySelector(".cci-fig-hanzi")!.textContent).toBe("图书馆");
    expect(fig.querySelector(".cci-fig-pinyin")!.textContent).toBe("tú shū guǎn");
  });

  it("are all known: every figure a release note asks for exists", () => {
    for (const n of RELEASE_NOTES) for (const i of n.items) if (i.figure) expect(FIGURE_IDS).toContain(i.figure);
    // few enough that the popup does not become a gallery
    const count = RELEASE_NOTES[0].items.filter((i) => i.figure).length;
    expect(count).toBeLessThanOrEqual(3);
  });
});
