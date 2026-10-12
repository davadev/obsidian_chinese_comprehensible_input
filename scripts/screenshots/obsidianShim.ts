// The obsidian stub the unit tests use, with `setIcon` drawing the real Lucide icons Obsidian ships (the stub only records
// the icon name). Used by scripts/render-screenshots.mjs only.
import icons from "./icons.json";
export * from "../../src/tests/__mocks__/obsidian";

export function setIcon(el: HTMLElement, name: string): void {
  const inner = (icons as Record<string, string>)[name];
  if (!inner) throw new Error(`render-screenshots: no icon data for "${name}" (add it to scripts/screenshots/icons.json)`);
  el.setAttribute("data-icon", name);
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
