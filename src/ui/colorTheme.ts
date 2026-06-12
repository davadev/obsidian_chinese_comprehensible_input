import { CciSettings } from "../settings/types";

/**
 * Push the user's custom colors into CSS custom properties on document.body
 * so the existing `.cci-color-*` selectors pick them up via color-mix().
 *
 * Called from main.ts at onload and again from saveSettings so a color
 * picker change takes effect live without restart.
 */
export function applyCustomColors(settings: CciSettings): void {
  const root = document.body;
  const c = settings.customColors;
  if (!c) return;
  root.style.setProperty("--cci-color-known", c.known);
  root.style.setProperty("--cci-color-partial", c.partial);
  root.style.setProperty("--cci-color-unknown", c.unknown);
  root.style.setProperty("--cci-color-new", c.new);
  for (const level of ["1", "2", "3", "4", "5", "6", "7"] as const) {
    root.style.setProperty(`--cci-color-hsk-${level}`, c.hsk[level]);
  }
}
