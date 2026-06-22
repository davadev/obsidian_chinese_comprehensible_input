import { EditorView, ViewPlugin } from "@codemirror/view";
import type CciPlugin from "../main";
import { extractSentenceAround } from "../ui/StatsView";

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOL = 8;

/** Pull the sentence containing the clicked `.cci-word` decoration so
 *  the popup can pass it to the AI "Enhance" action. Boundaries follow
 *  the same CJK + ASCII punctuation rules used by `StatsView`. Returns
 *  empty string when the click maps to a position CM6 can't resolve. */
function sentenceFor(view: EditorView, target: HTMLElement): string {
  try {
    const pos = view.posAtDOM(target);
    if (pos < 0) return "";
    return extractSentenceAround(view.state.doc.toString(), pos).text;
  } catch {
    return "";
  }
}

/**
 * Word tap / long-press behavior, per view mode:
 *  - Read: short tap = popup. PointerDown is preventDefault'd so the editor
 *    doesn't claim focus (no mobile keyboard, no caret move).
 *  - Mark known / Mark unknown: short tap marks the word. PointerDown
 *    preventDefault'd for the same reason.
 *  - Edit: short tap is normal CM6 cursor placement (with on-screen keyboard
 *    if applicable). Long-press still opens the popup.
 *  - Any mode: long-press opens the popup and suppresses the subsequent click.
 */
export function wordInteractionPlugin(plugin: CciPlugin) {
  return ViewPlugin.fromClass(
    class {
      view: EditorView;
      longPressTimer: number | null = null;
      pressedSurface: string | null = null;
      pressedTarget: HTMLElement | null = null;
      pressedAtX = 0;
      pressedAtY = 0;
      longPressFired = false;

      constructor(view: EditorView) {
        this.view = view;
        const dom = view.dom;
        dom.addEventListener("click", this.onClick, true);
        dom.addEventListener("pointerdown", this.onPointerDown, true);
        dom.addEventListener("pointermove", this.onPointerMove, true);
        dom.addEventListener("pointerup", this.onPointerUp, true);
        dom.addEventListener("pointercancel", this.onPointerCancel, true);
        dom.addEventListener("pointerleave", this.onPointerCancel, true);
      }

      destroy() {
        const dom = this.view.dom;
        dom.removeEventListener("click", this.onClick, true);
        dom.removeEventListener("pointerdown", this.onPointerDown, true);
        dom.removeEventListener("pointermove", this.onPointerMove, true);
        dom.removeEventListener("pointerup", this.onPointerUp, true);
        dom.removeEventListener("pointercancel", this.onPointerCancel, true);
        dom.removeEventListener("pointerleave", this.onPointerCancel, true);
      }

      onPointerDown = (ev: PointerEvent) => {
        const target = (ev.target as HTMLElement | null)?.closest(".cci-word") as HTMLElement | null;
        if (!target) return;
        const surface = target.getAttribute("data-cci-surface");
        if (!surface) return;

        const mode = plugin.activeViewMode();
        // In non-edit modes, prevent the editor from grabbing focus / moving
        // the caret / popping the on-screen keyboard.
        if (mode !== "edit") {
          ev.preventDefault();
          ev.stopPropagation();
        }

        this.pressedSurface = surface;
        this.pressedTarget = target;
        this.pressedAtX = ev.clientX;
        this.pressedAtY = ev.clientY;
        this.longPressFired = false;
        this.longPressTimer = window.setTimeout(() => {
          if (!this.pressedSurface || !this.pressedTarget) return;
          this.longPressFired = true;
          // Always blur first so the on-screen keyboard goes away.
          (activeDocument.activeElement as HTMLElement | null)?.blur?.();
          plugin.openWordPopup(this.pressedSurface, this.pressedTarget, ev, sentenceFor(this.view, this.pressedTarget));
          this.pressedSurface = null;
          this.pressedTarget = null;
        }, LONG_PRESS_MS);
      };

      onPointerMove = (ev: PointerEvent) => {
        if (this.longPressTimer == null) return;
        if (
          Math.abs(ev.clientX - this.pressedAtX) > LONG_PRESS_MOVE_TOL ||
          Math.abs(ev.clientY - this.pressedAtY) > LONG_PRESS_MOVE_TOL
        ) {
          this.cancelLongPress();
        }
      };

      onPointerUp = () => {
        this.cancelLongPress();
      };

      onPointerCancel = () => {
        this.cancelLongPress();
      };

      private cancelLongPress() {
        if (this.longPressTimer != null) {
          window.clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
      }

      /** [start, end) for a tapped `.cci-word` in format mode. The POSITION must
       *  come from the live view (`posAtDOM`): the baked `data-cci-start/-end`
       *  attribute strings are NOT remapped when CM6 shifts decorations through a
       *  doc change, so right after a previous highlight they hold stale offsets
       *  until the async re-tokenize rebuilds — using them there mis-places the
       *  range and trips the data-loss guard. The LENGTH (`end − start`) is
       *  shift-invariant, so we take only that from the attributes. Falls back to
       *  the raw attributes only if `posAtDOM` can't resolve. */
      private formatSpanFor(
        target: HTMLElement,
        surface: string
      ): { start: number; end: number } | null {
        const aStart = Number(target.getAttribute("data-cci-start"));
        const aEnd = Number(target.getAttribute("data-cci-end"));
        const attrsOk = !Number.isNaN(aStart) && !Number.isNaN(aEnd);
        // doclen is the target's length in the DOCUMENT — equals surface length
        // for words, but for a link widget it's the full `[[…]]`/`![[…]]`/
        // `[text](url)` markup so the selection snaps over the whole link.
        const docLen = Number(target.getAttribute("data-cci-doclen"));
        const len = attrsOk
          ? aEnd - aStart
          : Number.isNaN(docLen)
          ? surface.length
          : docLen;
        try {
          const start = this.view.posAtDOM(target);
          if (start >= 0) return { start, end: start + len };
        } catch {
          /* fall through to raw attributes */
        }
        return attrsOk ? { start: aStart, end: aEnd } : null;
      }

      onClick = (ev: MouseEvent) => {
        const target = (ev.target as HTMLElement | null)?.closest(".cci-word") as HTMLElement | null;
        if (!target) return;
        const surface = target.getAttribute("data-cci-surface");
        if (!surface) return;

        // If long-press already handled this gesture, swallow the click.
        if (this.longPressFired) {
          ev.preventDefault();
          ev.stopPropagation();
          this.longPressFired = false;
          return;
        }

        const mode = plugin.activeViewMode();
        if (mode === "mark-known") {
          ev.preventDefault();
          ev.stopPropagation();
          plugin.markWord(surface, "known");
          return;
        }
        if (mode === "mark-unknown") {
          ev.preventDefault();
          ev.stopPropagation();
          plugin.markWord(surface, "unknown");
          return;
        }
        if (mode === "mark-partial") {
          ev.preventDefault();
          ev.stopPropagation();
          (activeDocument.activeElement as HTMLElement | null)?.blur?.();
          plugin.openWordPopup(surface, target, ev, sentenceFor(this.view, target));
          return;
        }
        if (mode === "select-word") {
          ev.preventDefault();
          ev.stopPropagation();
          plugin.appendToCustomWordSelection(surface);
          return;
        }
        if (mode === "format") {
          ev.preventDefault();
          ev.stopPropagation();
          // Resolve offsets from the LIVE view, not the baked data attributes:
          // those can be stale during the async re-tokenize window right after
          // an edit, which would map the next apply to the wrong range.
          const span = this.formatSpanFor(target, surface);
          if (!span) return;
          if (plugin.pendingFormatStart == null) {
            plugin.beginFormatRange(span.start, surface);
          } else {
            plugin.applyFormatRange(span.end);
          }
          return;
        }
        if (mode === "edit") {
          // Let CM6 handle the click normally — do not open popup, do not
          // intercept caret placement.
          return;
        }

        // Read mode: open popup.
        ev.preventDefault();
        ev.stopPropagation();
        const rec = plugin.vocab.bySurface(surface);
        const status = rec?.status ?? "new";
        if (status === "known" && !plugin.settings.knownWordPopups) return;
        (activeDocument.activeElement as HTMLElement | null)?.blur?.();
        plugin.openWordPopup(surface, target, ev, sentenceFor(this.view, target));
      };
    }
  );
}
