/**
 * Vitest setup: Obsidian's runtime exposes `window`, `activeDocument`,
 * and `activeWindow` as globals that source files now reference for
 * popout-window compatibility. Node has none of these, so unit tests
 * referenced any of them would crash with "X is not defined". Wire them
 * through to the existing `globalThis` and to whatever `document` stub
 * the individual test installed.
 */
(globalThis as { window?: unknown }).window = globalThis;
if (!Object.getOwnPropertyDescriptor(globalThis, "activeDocument")) {
  Object.defineProperty(globalThis, "activeDocument", {
    configurable: true,
    get() {
      return (globalThis as { document?: unknown }).document;
    },
  });
}
if (!Object.getOwnPropertyDescriptor(globalThis, "activeWindow")) {
  Object.defineProperty(globalThis, "activeWindow", {
    configurable: true,
    get() {
      return globalThis;
    },
  });
}
