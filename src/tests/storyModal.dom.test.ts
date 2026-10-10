// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { GenerateStoryModal } from "../ui/GenerateStoryModal";

installObsidianDom();

function make(over: { aiEnabled?: boolean; generate?: (opts: Record<string, unknown>) => Promise<unknown> } = {}) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.ai.enabled = over.aiEnabled !== false;
  const generateAndSave = vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>(over.generate ?? (async () => ({})));
  const plugin: any = { settings, story: { generateAndSave } };
  const modal = new GenerateStoryModal(new App() as any, plugin);
  modal.open();
  const root = modal.contentEl as HTMLElement;
  return { modal, root, generateAndSave, settings };
}
const btn = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.startsWith(text))!;
const inputs = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLInputElement>("input[type=number]"));
const change = (el: HTMLElement) => el.dispatchEvent(new Event("change"));

beforeEach(() => {
  Notice.instances.length = 0;
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("GenerateStoryModal", () => {
  it("with AI switched off it says so and offers only Close", () => {
    const { root, modal } = make({ aiEnabled: false });
    expect(root.textContent).toContain("AI is disabled");
    expect(root.querySelector("select")).toBeNull();
    btn(root, "Close").click();
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
    expect(modal.contentEl.childElementCount).toBe(0); // onClose empties it
  });

  it("starts from the defaults in settings", () => {
    const { root, settings } = make();
    const [due, len] = inputs(root);
    expect(due.value).toBe(String(settings.story.defaultDueCount));
    expect(len.value).toBe(String(settings.story.defaultLengthChars));
    const [style, hsk] = Array.from(root.querySelectorAll<HTMLSelectElement>("select"));
    expect(style.value).toBe(settings.story.defaultStyle);
    expect(Array.from(style.options).map((o) => o.value)).toEqual(["story", "article", "dialogue"]);
    expect(hsk.value).toBe("auto");
    expect(root.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked).toBe(settings.story.includeGlossary);
  });

  it("sends exactly what was chosen, shows progress, and closes when it is done", async () => {
    let finish!: () => void;
    const { root, generateAndSave } = make({ generate: () => new Promise((r) => (finish = () => r({}))) });
    const [due, len] = inputs(root);
    due.value = "7";
    change(due);
    len.value = "450";
    change(len);
    const [style, hsk] = Array.from(root.querySelectorAll<HTMLSelectElement>("select"));
    style.value = "dialogue";
    change(style);
    hsk.value = "4";
    change(hsk);
    const gloss = root.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    gloss.checked = !gloss.checked;
    change(gloss);
    const gen = btn(root, "Generate");
    gen.click();
    await Promise.resolve();
    expect(gen.textContent).toBe("Generating…");
    expect(gen.hasAttribute("disabled")).toBe(true);
    expect(generateAndSave).toHaveBeenCalledWith({ dueCount: 7, lengthChars: 450, style: "dialogue", targetHsk: "4", includeGlossary: gloss.checked });
    finish();
    await vi.waitFor(() => expect(document.body.querySelector(".cci-modal-front")).toBeNull());
  });

  it("ignores a number box that does not hold a number", async () => {
    const { root, generateAndSave, settings } = make();
    const [due] = inputs(root);
    due.value = "abc";
    change(due);
    btn(root, "Generate").click();
    await Promise.resolve();
    expect(generateAndSave.mock.calls[0][0].dueCount).toBe(settings.story.defaultDueCount);
  });

  it("a failed generation tells the user, re-enables the button and stays open", async () => {
    const { root } = make({ generate: async () => { throw new Error("no key"); } });
    const gen = btn(root, "Generate");
    gen.click();
    await vi.waitFor(() => expect(Notice.instances.at(-1)?.message).toBe("Generation failed: no key"));
    expect(gen.textContent).toBe("Generate");
    expect(gen.hasAttribute("disabled")).toBe(false);
    expect(document.body.querySelector(".cci-modal-front")).toBeTruthy();
  });

  it("Cancel closes without generating", () => {
    const { root, generateAndSave } = make();
    btn(root, "Cancel").click();
    expect(generateAndSave).not.toHaveBeenCalled();
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
  });
});
