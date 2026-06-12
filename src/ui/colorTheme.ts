import { CciSettings, CustomColors } from "../settings/types";

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

/**
 * Read the active Obsidian accent color and derive a 7-step shade ramp
 * (HSK 1 lightest → HSK 7 darkest) by varying HSL lightness on the same
 * hue. Used as the install-time default and by the Reset button.
 *
 * If the accent value can't be parsed (very old theme, non-hex color),
 * fall back to the built-in rainbow defaults from defaults.ts.
 */
export function deriveHskColorsFromAccent(): CustomColors["hsk"] {
  const accent = readAccentHex();
  const hsl = accent ? hexToHsl(accent) : null;
  if (!hsl) {
    return {
      "1": "#dc3c3c",
      "2": "#e08c2a",
      "3": "#dcb41e",
      "4": "#2ea043",
      "5": "#3aa0c0",
      "6": "#586bdc",
      "7": "#9c4dc6",
    };
  }
  // Light → dark across 7 steps. Keep some saturation floor so the
  // lightest shades remain identifiable rather than washed-out gray.
  const lightnesses = [82, 72, 62, 52, 42, 34, 26];
  const out: CustomColors["hsk"] = {
    "1": "#000000",
    "2": "#000000",
    "3": "#000000",
    "4": "#000000",
    "5": "#000000",
    "6": "#000000",
    "7": "#000000",
  };
  for (let i = 0; i < 7; i++) {
    const level = String(i + 1) as keyof CustomColors["hsk"];
    out[level] = hslToHex(hsl.h, Math.max(35, hsl.s), lightnesses[i]);
  }
  return out;
}

function readAccentHex(): string | null {
  const cs = getComputedStyle(document.body);
  // Obsidian exposes the accent as `--interactive-accent` in hex form on
  // recent versions and as `--accent` / `--accent-h` etc. on older ones.
  const tryVars = ["--interactive-accent", "--text-accent", "--accent"];
  for (const v of tryVars) {
    const raw = cs.getPropertyValue(v).trim();
    if (!raw) continue;
    const hex = normalizeToHex(raw);
    if (hex) return hex;
  }
  return null;
}

function normalizeToHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    return null;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }
  const hsl = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(s);
  if (hsl) {
    return hslToHex(parseFloat(hsl[1]), parseFloat(hsl[2]), parseFloat(hsl[3]));
  }
  return null;
}

function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, "0");
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  return `#${toHex2((r + m) * 255)}${toHex2((g + m) * 255)}${toHex2((b + m) * 255)}`;
}
