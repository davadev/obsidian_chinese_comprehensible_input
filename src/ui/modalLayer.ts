import type { Modal } from "obsidian";

/**
 * Lift one of this plugin's modals above this plugin's own popup layers.
 *
 * `.cci-popup` (z-index 100), `.cci-bottom-sheet` (200) and `.cci-overflow`
 * (300) all outrank Obsidian's `--layer-modal`, so a modal opened while any
 * of them is on screen renders *underneath* and cannot be interacted with.
 * The matching `.modal-container.cci-modal-front` rule in styles.css puts
 * ours at 400 — scoped to our own container so no other plugin's or
 * Obsidian's layering changes.
 *
 * Call this from `onOpen()` (or right after constructing a bare `Modal`)
 * for every modal we open. Callers that launch a modal *from* the word
 * popup should still close the popup, which is the primary fix; this is
 * the backstop.
 */
export function liftModal(modal: Modal): void {
  modal.containerEl.addClass("cci-modal-front");
}
