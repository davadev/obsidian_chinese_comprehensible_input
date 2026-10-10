// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Modal } from "obsidian";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { liftModal } from "../ui/modalLayer";
import { confirmAsync } from "../ui/confirmInput";

/**
 * Phase B, first part: the smallest shells. liftModal keeps our modals above our own popup layers; confirmAsync
 * replaces `confirm()` (disabled on iOS) for every destructive prompt, so each way it can end has to resolve exactly once
 * and to the safe answer (`false`) unless the person pressed the destructive button.
 */

installObsidianDom();

afterEach(() => {
  document.body.innerHTML = "";
});

const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>(".setting-item button"));
const button = (text: string) => buttons().find((b) => b.textContent === text)!;

describe("liftModal", () => {
  it("adds the front-layer class to the modal's own container only", () => {
    const m = new Modal(new App());
    liftModal(m);
    expect(m.containerEl.classList.contains("cci-modal-front")).toBe(true);
    expect(document.body.querySelector(".cci-modal-front")).toBeNull(); // not opened, so not in the page
  });
});

describe("confirmAsync", () => {
  it("shows the message and a Cancel and a Delete button, the destructive one marked as a warning", () => {
    void confirmAsync(new App(), "Really remove this?");
    expect(document.body.querySelector(".modal-container, div")!.textContent).toContain("Really remove this?");
    expect(buttons().map((b) => b.textContent)).toEqual(["Cancel", "Delete"]);
    expect(document.body.querySelector(".cci-modal-front")).toBeTruthy();
  });

  it("resolves true on the confirm button, with a custom label, and closes the modal", async () => {
    const p = confirmAsync(new App(), "Reset?", "Reset");
    button("Reset").click();
    await expect(p).resolves.toBe(true);
    expect(document.body.querySelector(".cci-modal-front")).toBeNull();
  });

  it("resolves false on Cancel", async () => {
    const p = confirmAsync(new App(), "Delete?");
    button("Cancel").click();
    await expect(p).resolves.toBe(false);
  });

  it("resolves false when the modal is dismissed any other way (Esc, a click outside)", async () => {
    let opened!: Modal;
    const open = Modal.prototype.open;
    const spy = vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
      opened = this;
      open.call(this);
    });
    const p = confirmAsync(new App(), "Delete?");
    opened.close();
    await expect(p).resolves.toBe(false);
    spy.mockRestore();
  });

  it("an answer given by a button is not overridden when the modal then closes", async () => {
    const p = confirmAsync(new App(), "Delete?");
    button("Delete").click();
    expect(await p).toBe(true);
  });
});
