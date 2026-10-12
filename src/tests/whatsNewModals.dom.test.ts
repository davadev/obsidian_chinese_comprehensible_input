// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { WhatsNewModal } from "../ui/whatsNew/WhatsNewModal";
import { AiSetupModal } from "../ui/AiSetupModal";
import type { ReleaseNote } from "../ui/whatsNew/releaseNotes";

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
