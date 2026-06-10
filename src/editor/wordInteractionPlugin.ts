import { EditorView, ViewPlugin } from "@codemirror/view";
import type CciPlugin from "../main";

const LONG_PRESS_MS = 450;

export function wordInteractionPlugin(plugin: CciPlugin) {
  return ViewPlugin.fromClass(
    class {
      view: EditorView;
      longPressTimer: number | null = null;
      pressedSurface: string | null = null;
      pressedTarget: HTMLElement | null = null;

      constructor(view: EditorView) {
        this.view = view;
        const dom = view.dom;
        dom.addEventListener("click", this.onClick);
        dom.addEventListener("pointerdown", this.onPointerDown);
        dom.addEventListener("pointerup", this.onPointerUp);
        dom.addEventListener("pointercancel", this.onPointerUp);
        dom.addEventListener("pointerleave", this.onPointerUp);
      }

      destroy() {
        const dom = this.view.dom;
        dom.removeEventListener("click", this.onClick);
        dom.removeEventListener("pointerdown", this.onPointerDown);
        dom.removeEventListener("pointerup", this.onPointerUp);
        dom.removeEventListener("pointercancel", this.onPointerUp);
        dom.removeEventListener("pointerleave", this.onPointerUp);
      }

      onClick = (ev: MouseEvent) => {
        const target = (ev.target as HTMLElement | null)?.closest(".cci-word") as HTMLElement | null;
        if (!target) return;
        const surface = target.getAttribute("data-cci-surface");
        if (!surface) return;
        ev.preventDefault();
        ev.stopPropagation();
        const mode = plugin.activeViewMode();
        if (mode === "mark-known") {
          plugin.markWord(surface, "known");
          return;
        }
        if (mode === "mark-unknown") {
          plugin.markWord(surface, "unknown");
          return;
        }
        const rec = plugin.vocab.bySurface(surface);
        const status = rec?.status ?? "new";
        if (status === "known" && !plugin.settings.knownWordPopups) return;
        plugin.openWordPopup(surface, target, ev);
      };

      onPointerDown = (ev: PointerEvent) => {
        const target = (ev.target as HTMLElement | null)?.closest(".cci-word") as HTMLElement | null;
        if (!target) return;
        const surface = target.getAttribute("data-cci-surface");
        if (!surface) return;
        this.pressedSurface = surface;
        this.pressedTarget = target;
        this.longPressTimer = window.setTimeout(() => {
          if (this.pressedSurface && this.pressedTarget) {
            plugin.openWordPopup(this.pressedSurface, this.pressedTarget, ev);
            this.pressedSurface = null;
            this.pressedTarget = null;
          }
        }, LONG_PRESS_MS);
      };

      onPointerUp = () => {
        if (this.longPressTimer != null) {
          window.clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
        this.pressedSurface = null;
        this.pressedTarget = null;
      };
    }
  );
}
