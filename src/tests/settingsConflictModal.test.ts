import { describe, it, expect, vi } from "vitest";
import {
  SettingsConflictModal,
  type SettingsConflict,
} from "../ui/SettingsConflictModal";

/**
 * Regression guard for #123.
 *
 * `onResolve` fired only from `finish()`, and `finish()` only from the three
 * buttons. Obsidian closes a Modal on Esc and on a background click without
 * touching either, so dismissing the dialog resolved nothing: the caller's
 * promise never settled and its `conflictModalOpen` flag stayed set, which made
 * every later `absorbExternalChange()` a silent no-op. Settings sync was dead
 * until Obsidian restarted, with nothing said to the user.
 *
 * The class doc comment already claimed "Cancelling keeps everything local" —
 * there was simply no code implementing it.
 *
 * These drive the lifecycle directly. The constructor touches no DOM (it only
 * seeds the choice map), and `onClose()` needs nothing but a `contentEl` with
 * an `empty()`.
 */

const conflicts: SettingsConflict[] = [
  { keyPath: "readerFontPx", local: 22, remote: 26 },
  { keyPath: "annotationScalePercent", local: 100, remote: 80 },
];

function makeModal() {
  const onResolve = vi.fn();
  const modal = new SettingsConflictModal({} as never, conflicts, onResolve);
  (modal as unknown as { contentEl: { empty: () => void } }).contentEl = {
    empty: () => {},
  };
  return { modal, onResolve };
}

/** `finish()` is private; the buttons are the only production caller. */
const finish = (m: SettingsConflictModal) =>
  (m as unknown as { finish: () => void }).finish();

describe("SettingsConflictModal dismissal", () => {
  it("resolves when dismissed without pressing a button", () => {
    const { modal, onResolve } = makeModal();
    modal.onClose();
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("dismissal keeps everything local, as the doc comment promises", () => {
    // An empty choice map means no key is taken from remote — the caller reads
    // it as "keep local for every conflict", which is exactly what the
    // "Keep all local" button produces.
    const { modal, onResolve } = makeModal();
    modal.onClose();
    const choices = onResolve.mock.calls[0][0] as Map<string, string>;
    expect(choices.size).toBe(0);
  });

  it("does not resolve twice when a button was pressed first", () => {
    // `finish()` calls `close()`, which calls `onClose()`. Without the guard
    // the caller would be resolved a second time, with a different map.
    const { modal, onResolve } = makeModal();
    finish(modal);
    modal.onClose();
    expect(onResolve).toHaveBeenCalledTimes(1);
    const choices = onResolve.mock.calls[0][0] as Map<string, string>;
    expect(choices.get("readerFontPx")).toBe("remote");
  });

  it("still defaults every conflict to remote when a button is used", () => {
    const { modal, onResolve } = makeModal();
    finish(modal);
    const choices = onResolve.mock.calls[0][0] as Map<string, string>;
    expect(choices.size).toBe(conflicts.length);
    for (const c of conflicts) expect(choices.get(c.keyPath)).toBe("remote");
  });
});
