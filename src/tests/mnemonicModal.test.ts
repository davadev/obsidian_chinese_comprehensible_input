import { describe, it, expect, vi } from "vitest";
import { MnemonicModal } from "../ui/MnemonicModal";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { WordRecord } from "../vocabulary/VocabularyTypes";

/**
 * Regression guard for 0.7.7.
 *
 * `MnemonicModal.save()` persisted through `vocab.updateMnemonic()` and closed,
 * and that was correct for years: the mnemonic only ever appeared on the word
 * card, which re-reads its record every time it opens.
 *
 * #56 made the mnemonic a possible ANNOTATION ROW in the reading view. The
 * vocabulary store has no change notification — every other mutating UI path
 * calls `plugin.refreshChineseViews()` at the call site (WordPopup, StatsView) —
 * so without that call the row kept the old text. Clearing was the worse half:
 * the notice said "Mnemonic cleared." while the cleared text stayed on screen.
 *
 * These tests drive `save()` directly. The modal's DOM lives in `render()`, which
 * needs a real document, so the two input fields are stubbed — `save()` only ever
 * reads `.value` off them.
 */

function makeRec(): WordRecord {
  return { surfaces: ["学习"], status: "new" } as unknown as WordRecord;
}

function makeModal(line: string, story: string) {
  const updateMnemonic = vi.fn();
  const refreshChineseViews = vi.fn();
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    vocab: { updateMnemonic },
    refreshChineseViews,
    // `displaySurface` takes the dictionary as an OPTIONAL argument and never
    // reaches it at the default scriptVariant "auto", which returns surfaces[0].
    dictionary: undefined,
  };
  const modal = new MnemonicModal(
    {} as never,
    plugin as never,
    makeRec(),
    "我在学习中文。"
  );
  // Stand in for the fields render() would have built.
  (modal as unknown as { lineInput: { value: string } }).lineInput = { value: line };
  (modal as unknown as { storyInput: { value: string } }).storyInput = { value: story };
  return { modal, updateMnemonic, refreshChineseViews };
}

/** `save()` is private; tests reach it the way the Save button does. */
function save(modal: MnemonicModal): void {
  (modal as unknown as { save: () => void }).save();
}

describe("MnemonicModal.save", () => {
  it("refreshes the reading view after saving, so a mnemonic row appears at once", () => {
    const { modal, updateMnemonic, refreshChineseViews } = makeModal("🌊🐟", "a story");
    save(modal);
    expect(updateMnemonic).toHaveBeenCalledWith("学习", {
      text: "🌊🐟",
      story: "a story",
    });
    // The assertion that was missing in 0.7.7-beta.5.
    expect(refreshChineseViews).toHaveBeenCalledTimes(1);
  });

  it("refreshes after CLEARING too — the worse half of the bug", () => {
    // Emptying both fields stores `undefined` and shows "Mnemonic cleared.";
    // without the refresh the old text stayed above the word, contradicting the
    // notice the user had just read.
    const { modal, updateMnemonic, refreshChineseViews } = makeModal("", "");
    save(modal);
    expect(updateMnemonic).toHaveBeenCalledWith("学习", {
      text: undefined,
      story: undefined,
    });
    expect(refreshChineseViews).toHaveBeenCalledTimes(1);
  });

  it("stores against surfaces[0], never a converted form", () => {
    // Storage key has to stay surfaces[0] so vocab.ensure() cannot push a guessed
    // variant into the record — see the constructor's note.
    const { modal, updateMnemonic } = makeModal("🌊", "");
    save(modal);
    expect(updateMnemonic.mock.calls[0][0]).toBe("学习");
  });

  it("trims whitespace rather than storing a blank mnemonic", () => {
    const { modal, updateMnemonic } = makeModal("   ", "  ");
    save(modal);
    expect(updateMnemonic).toHaveBeenCalledWith("学习", {
      text: undefined,
      story: undefined,
    });
  });
});
