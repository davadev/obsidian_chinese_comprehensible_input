// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { EditDictionaryModal, type EditDictionaryProps } from "../ui/EditDictionaryModal";
import { makeKey } from "../dictionary/normalizeChinese";

/**
 * The dictionary editor. It writes either an override of a CC-CEDICT entry (keyed by the entry's canonical key) or a
 * custom word, both of which sync between devices, so what each button saves, what it refuses to save, and what it
 * removes is checked, along with the script label that tells the learner which form they are editing.
 */

installObsidianDom();

const confirm = vi.hoisted(() => ({ answer: true }));
vi.mock("../ui/confirmInput", () => ({ confirmAsync: vi.fn(async () => confirm.answer) }));

const ENTRY = { simplified: "学习", traditional: "學習", pinyin: "xué xí", definitions: ["to study"] };

function open(props: Partial<EditDictionaryProps> = {}, scriptVariant = "auto") {
  const plugin: any = {
    settings: { scriptVariant },
    setDictionaryOverride: vi.fn(async () => {}),
    deleteDictionaryOverride: vi.fn(async () => {}),
    setCustomWord: vi.fn(async () => {}),
    deleteCustomWord: vi.fn(async () => {}),
  };
  const modal = new EditDictionaryModal(new App() as any, plugin, { mode: "custom", surface: "", initial: {}, ...props });
  modal.open();
  const root = modal.contentEl as HTMLElement;
  return { modal, root, plugin };
}
const field = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll<HTMLElement>(".cci-edit-dict-row")).find((r) => r.querySelector("label")!.textContent === label)!.querySelector<HTMLInputElement & HTMLTextAreaElement>("input, textarea")!;
const type = (el: HTMLInputElement, v: string) => void (el.value = v);
const btn = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text)!;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const lastNotice = () => Notice.instances.at(-1)?.message;

beforeEach(() => {
  confirm.answer = true;
  Notice.instances.length = 0;
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("override mode", () => {
  const base = { mode: "override" as const, surface: "学习", originalEntry: ENTRY, initial: { traditional: "學習", pinyin: "xué xí", pinyinTaiwan: "xue2 xi2", definitions: ["to study", "to learn"], hskLevel: "3" } };

  it("fills the form from the entry, locks the surface and offers Reset but not Delete", () => {
    const { root } = open(base);
    expect(root.querySelector("h3")!.textContent).toBe("Edit dictionary entry");
    expect(field(root, "Surface (simplified)").disabled).toBe(true);
    expect(field(root, "Surface (simplified)").value).toBe("学习");
    expect(field(root, "Traditional (optional)").value).toBe("學習");
    expect(field(root, "Pinyin (tone marks or numbers)").value).toBe("xué xí");
    expect(field(root, "Taiwan pinyin (optional)").value).toBe("xue2 xi2");
    expect(field(root, "Definitions (one per line)").value).toBe("to study\nto learn");
    expect(root.querySelector<HTMLSelectElement>("select")!.value).toBe("3");
    expect(btn(root, "Reset to dictionary default")).toBeTruthy();
    expect(Array.from(root.querySelectorAll("button")).some((b) => b.textContent === "Delete custom word")).toBe(false);
  });

  it("labels the surface by the entry's script, not by the setting", () => {
    expect(open({ ...base, surface: "學習" }, "simplified").root.textContent).toContain("Surface (traditional)");
    document.body.innerHTML = "";
    expect(open({ ...base, surface: "学习" }, "traditional").root.textContent).toContain("Surface (simplified)");
  });

  it("saves an override under the entry's canonical key, trimming and dropping empty fields", async () => {
    const { root, plugin, modal } = open(base);
    type(field(root, "Pinyin (tone marks or numbers)"), "  xué xí  ");
    type(field(root, "Taiwan pinyin (optional)"), "");
    type(field(root, "Traditional (optional)"), "");
    type(field(root, "Definitions (one per line)"), "to study\n\n  to learn  \n");
    btn(root, "Save").click();
    await flush();
    const [key, ov] = plugin.setDictionaryOverride.mock.calls[0];
    expect(key).toBe(makeKey("学习", "xué xí"));
    expect(ov).toMatchObject({ pinyin: "xué xí", pinyinTaiwan: undefined, traditional: undefined, definitions: ["to study", "to learn"], hsk: { source: "user", levels: ["3"] } });
    expect(typeof ov.updatedAt).toBe("string");
    expect(lastNotice()).toBe("Dictionary override saved.");
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
    void modal;
  });

  it("an override with no definitions or HSK level saves them as absent", async () => {
    const { root, plugin } = open({ ...base, initial: { pinyin: "xué xí" } });
    btn(root, "Save").click();
    await flush();
    expect(plugin.setDictionaryOverride.mock.calls[0][1]).toMatchObject({ definitions: undefined, hsk: undefined });
  });

  it("an emptied pinyin or traditional field is saved as absent, so the dictionary default shows through", async () => {
    const { root, plugin } = open(base);
    type(field(root, "Pinyin (tone marks or numbers)"), "   ");
    type(field(root, "Traditional (optional)"), " ");
    btn(root, "Save").click();
    await flush();
    expect(plugin.setDictionaryOverride.mock.calls[0][1]).toMatchObject({ pinyin: undefined, traditional: undefined });
  });

  it("cannot save without the original entry", async () => {
    const { root, plugin } = open({ ...base, originalEntry: undefined });
    btn(root, "Save").click();
    await flush();
    expect(plugin.setDictionaryOverride).not.toHaveBeenCalled();
    expect(lastNotice()).toBe("Missing original entry — cannot save override.");
    btn(root, "Reset to dictionary default").click();
    await flush();
    expect(plugin.deleteDictionaryOverride).not.toHaveBeenCalled();
  });

  it("Reset removes the override and closes", async () => {
    const { root, plugin } = open(base);
    btn(root, "Reset to dictionary default").click();
    await flush();
    expect(plugin.deleteDictionaryOverride).toHaveBeenCalledWith(makeKey("学习", "xué xí"));
    expect(lastNotice()).toBe("Override removed; using dictionary default.");
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
  });

  it("refuses a surface without Chinese characters", async () => {
    const { root, plugin } = open(base);
    const surface = field(root, "Surface (simplified)");
    surface.disabled = false;
    type(surface, "hello");
    btn(root, "Save").click();
    await flush();
    expect(plugin.setDictionaryOverride).not.toHaveBeenCalled();
    expect(lastNotice()).toBe("Surface must contain at least one Chinese character.");
  });
});

describe("custom mode", () => {
  it("a new word: the surface is editable, there is no Taiwan field, no Reset and no Delete", () => {
    const { root } = open({ mode: "custom", surface: "火锅", initial: {} });
    expect(root.querySelector("h3")!.textContent).toBe("Add custom word");
    expect(field(root, "Surface").disabled).toBe(false);
    expect(Array.from(root.querySelectorAll("label")).some((l) => l.textContent === "Taiwan pinyin (optional)")).toBe(false);
    expect(Array.from(root.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Save", "Cancel"]);
  });

  it.each([["traditional", "Surface (traditional)"], ["simplified", "Surface (simplified)"], ["auto", "Surface"]])(
    "labels the surface from the script setting (%s)",
    (variant, label) => {
      const { root } = open({ mode: "custom", surface: "火锅", initial: {} }, variant);
      expect(field(root, label)).toBeTruthy();
    }
  );

  it("requires pinyin", async () => {
    const { root, plugin } = open({ mode: "custom", surface: "火锅", initial: {} });
    btn(root, "Save").click();
    await flush();
    expect(plugin.setCustomWord).not.toHaveBeenCalled();
    expect(lastNotice()).toBe("Pinyin is required for custom words.");
  });

  it("saves the word under its surface and closes", async () => {
    const { root, plugin } = open({ mode: "custom", surface: "火锅", initial: {} });
    type(field(root, "Pinyin (tone marks or numbers)"), " huǒ guō ");
    type(field(root, "Traditional (optional)"), "火鍋");
    type(field(root, "Definitions (one per line)"), "hot pot");
    root.querySelector<HTMLSelectElement>("select")!.value = "5";
    btn(root, "Save").click();
    await flush();
    expect(plugin.setCustomWord).toHaveBeenCalledWith("火锅", {
      simplified: "火锅",
      traditional: "火鍋",
      pinyin: "huǒ guō",
      definitions: ["hot pot"],
      hsk: { source: "user", levels: ["5"] },
    });
    expect(lastNotice()).toBe('Custom word "火锅" saved.');
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
  });

  it("a custom word without a traditional form or definitions saves them as absent or empty", async () => {
    const { root, plugin } = open({ mode: "custom", surface: "火锅", initial: {} });
    type(field(root, "Pinyin (tone marks or numbers)"), "huǒ guō");
    btn(root, "Save").click();
    await flush();
    expect(plugin.setCustomWord).toHaveBeenCalledWith("火锅", { simplified: "火锅", traditional: undefined, pinyin: "huǒ guō", definitions: [], hsk: undefined });
  });

  it("an existing custom word has its surface locked and a Delete button that asks first", async () => {
    const { root, plugin } = open({ mode: "custom", surface: "火锅", isExistingCustom: true, initial: { pinyin: "huǒ guō" } });
    expect(field(root, "Surface").disabled).toBe(true);
    confirm.answer = false;
    btn(root, "Delete custom word").click();
    await flush();
    expect(plugin.deleteCustomWord).not.toHaveBeenCalled();
    confirm.answer = true;
    btn(root, "Delete custom word").click();
    await flush();
    expect(plugin.deleteCustomWord).toHaveBeenCalledWith("火锅");
    expect(lastNotice()).toBe("Custom word deleted.");
  });

  it("Cancel closes without saving", () => {
    const { root, plugin } = open({ mode: "custom", surface: "火锅", initial: {} });
    btn(root, "Cancel").click();
    expect(plugin.setCustomWord).not.toHaveBeenCalled();
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
  });
});

describe("on-screen keyboard (iOS)", () => {
  it("keeps the modal above the keyboard while it is open, and stops listening when it closes", () => {
    const listeners = new Map<string, () => void>();
    const vv = {
      height: 500,
      addEventListener: (t: string, fn: () => void) => void listeners.set(t, fn),
      removeEventListener: vi.fn((t: string) => void listeners.delete(t)),
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    try {
      const { root, modal } = open({ mode: "custom", surface: "火锅", initial: {} });
      expect(root.style.maxHeight).toBe("440px");
      vv.height = 300;
      listeners.get("resize")!();
      expect(root.style.maxHeight).toBe("240px");
      modal.close();
      expect(vv.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(listeners.size).toBe(0);
      modal.close(); // closing again must not throw
    } finally {
      Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    }
  });

  it("works where there is no visual viewport", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    const { modal } = open({ mode: "custom", surface: "火锅", initial: {} });
    expect(() => modal.close()).not.toThrow();
  });
});
