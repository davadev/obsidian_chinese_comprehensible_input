import type { App } from "obsidian";
import type { CciSettings } from "../settings/types";

/**
 * Highlightr-plugin color compatibility (#21 phase 2).
 *
 * We render colored highlights inside the Chinese view and let the formatting
 * mode apply them. When Highlightr is installed we mirror its colors + method
 * (so user customizations carry over). When it is not installed, an opt-in
 * setting exposes the hardcoded Highlightr defaults; applying then writes a
 * portable inline `<mark style>` that also renders in normal reading view.
 *
 * The pure helpers (`slugify`, `parseMarkColor`, `highlightWrap`) are unit
 * tested; the `app.plugins` access is isolated in `readHighlightrSettings`.
 */

const HIGHLIGHTR_ID = "highlightr-plugin";

export interface HighlightColor {
  /** Stable slug used in the `hl:<slug>` option id and `hltr-<slug>` class. */
  slug: string;
  /** Human label shown in the picker (the original color name). */
  label: string;
  /** Resolved CSS color value (hex / rgba). */
  color: string;
  source: "highlightr" | "default";
}

/**
 * Highlightr's built-in default palette, as of this feature's implementation.
 * Used only when the plugin is absent and the opt-in setting is on.
 */
export const DEFAULT_HIGHLIGHT_PALETTE: ReadonlyArray<{ name: string; color: string }> = [
  { name: "Pink", color: "#FFB8EBA6" },
  { name: "Red", color: "#FF5582A6" },
  { name: "Orange", color: "#FFB86CA6" },
  { name: "Yellow", color: "#FFF3A3A6" },
  { name: "Green", color: "#BBFABBA6" },
  { name: "Cyan", color: "#ABF7F7A6" },
  { name: "Blue", color: "#ADCCFFA6" },
  { name: "Purple", color: "#D2B3FFA6" },
];

/** Lowercase, hyphenated slug — matches Highlightr's `hltr-<name>` convention. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface HighlightrSettings {
  highlighters?: Record<string, string>;
  highlighterOrder?: string[];
  /** Highlightr's "Choose highlight method": "inline-style" | "css-classes". */
  highlighterStyle?: string;
}

/** Read Highlightr's settings if the plugin is installed and enabled. */
function readHighlightrSettings(app: App): HighlightrSettings | null {
  const reg = app.plugins;
  if (!reg) return null;
  const enabled = reg.enabledPlugins;
  if (enabled && !enabled.has(HIGHLIGHTR_ID)) return null;
  const plugin = reg.plugins?.[HIGHLIGHTR_ID] ?? reg.getPlugin?.(HIGHLIGHTR_ID) ?? null;
  if (!plugin) return null;
  const settings = plugin.settings;
  return settings && typeof settings === "object" ? (settings as HighlightrSettings) : null;
}

/** Is the Highlightr plugin installed and enabled? */
export function highlightrInstalled(app: App): boolean {
  return readHighlightrSettings(app) !== null;
}

/**
 * The highlight colors currently available to the formatting mode:
 *  - Highlightr installed → its configured colors, in its order.
 *  - else opt-in on → the hardcoded defaults.
 *  - else → none.
 */
export function resolveHighlightPalette(app: App, settings: CciSettings): HighlightColor[] {
  const hl = readHighlightrSettings(app);
  if (hl && hl.highlighters) {
    const map = hl.highlighters;
    const order = Array.isArray(hl.highlighterOrder) ? hl.highlighterOrder : Object.keys(map);
    const out: HighlightColor[] = [];
    for (const name of order) {
      const color = map[name];
      if (typeof color !== "string") continue;
      out.push({ slug: slugify(name), label: name, color, source: "highlightr" });
    }
    return out;
  }
  if (settings.showHighlightColorsWithoutPlugin) {
    return DEFAULT_HIGHLIGHT_PALETTE.map((c) => ({
      slug: slugify(c.name),
      label: c.name,
      color: c.color,
      source: "default" as const,
    }));
  }
  return [];
}

/** Find a palette entry by its `hl:<slug>` option id. */
export function highlightColorForId(
  id: string,
  palette: HighlightColor[]
): HighlightColor | null {
  if (!id.startsWith("hl:")) return null;
  const slug = id.slice(3);
  return palette.find((c) => c.slug === slug) ?? null;
}

export interface HighlightWrap {
  open: string;
  close: string;
}

/**
 * The opening/closing wrap for a colored highlight. Mirrors Highlightr's
 * css-classes method when that plugin is installed and so configured; otherwise
 * writes a portable inline `<mark style>` that renders everywhere.
 */
export function highlightWrap(hc: HighlightColor, app: App): HighlightWrap {
  const hl = readHighlightrSettings(app);
  if (hl && hl.highlighterStyle === "css-classes") {
    return { open: `<mark class="hltr-${hc.slug}">`, close: "</mark>" };
  }
  return { open: `<mark style="background:${hc.color};">`, close: "</mark>" };
}

/** Default `==…==` highlight background (matches `.cci-md-highlight` CSS). */
export const DEFAULT_HIGHLIGHT_BG = "var(--text-highlight-bg, rgba(255, 208, 0, 0.45))";

export interface HighlightSpan {
  /** Start of the opening delimiter / `<mark …>` tag. */
  openFrom: number;
  /** Start of the highlighted content. */
  contentFrom: number;
  /** End of the highlighted content. */
  contentTo: number;
  /** End of the closing delimiter / `</mark>`. */
  closeTo: number;
  /** Resolved color for a colored `<mark>`; undefined = default `==`. */
  color?: string;
}

/**
 * Locate every highlight in `text`: extended-markdown `==…==` and Highlightr
 * `<mark …>…</mark>`. Single source of truth shared by the markdown renderer
 * (which hides delimiters + marks the content) and the Chinese decorations
 * (which color the characters of annotated/ruby words). Overlapping spans are
 * resolved by keeping the earlier one. Pure → unit tested.
 */
export function findHighlightSpans(text: string, palette: HighlightColor[]): HighlightSpan[] {
  const spans: HighlightSpan[] = [];

  const reEq = /==([^=\n]+?)==/g;
  let m: RegExpExecArray | null;
  while ((m = reEq.exec(text))) {
    const openFrom = m.index;
    spans.push({
      openFrom,
      contentFrom: openFrom + 2,
      contentTo: openFrom + m[0].length - 2,
      closeTo: openFrom + m[0].length,
    });
  }

  const reMark = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
  while ((m = reMark.exec(text))) {
    if (m[2].length === 0) continue;
    const color = parseMarkColor(m[1], palette);
    if (!color) continue;
    const openFrom = m.index;
    const contentFrom = openFrom + m[1].length + "<mark>".length;
    const contentTo = contentFrom + m[2].length;
    spans.push({ openFrom, contentFrom, contentTo, closeTo: contentTo + "</mark>".length, color });
  }

  spans.sort((a, b) => a.openFrom - b.openFrom);
  // Drop spans that overlap an already-accepted one.
  const out: HighlightSpan[] = [];
  let lastClose = -1;
  for (const s of spans) {
    if (s.openFrom < lastClose) continue;
    out.push(s);
    lastClose = s.closeTo;
  }
  return out;
}

const COLOR_VALUE_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|[a-zA-Z]+)$/;

/**
 * Pull a sanitized background color out of a `<mark>` tag's attribute string.
 * Accepts `style="background[-color]: <value>"` or `class="hltr-<slug>"`
 * (resolved via the palette). Returns null when no safe color is found — this
 * guards against CSS injection from arbitrary note text.
 */
export function parseMarkColor(attrs: string, palette: HighlightColor[]): string | null {
  const styleMatch = /(?:^|[;\s"'])background(?:-color)?\s*:\s*([^;"']+)/i.exec(attrs);
  if (styleMatch) {
    const raw = styleMatch[1].trim();
    if (COLOR_VALUE_RE.test(raw)) return raw;
  }
  const classMatch = /class\s*=\s*["']([^"']*)["']/i.exec(attrs);
  if (classMatch) {
    for (const cls of classMatch[1].split(/\s+/)) {
      const m = /^hltr-(.+)$/.exec(cls);
      if (m) {
        const hit = palette.find((c) => c.slug === m[1]);
        if (hit && COLOR_VALUE_RE.test(hit.color)) return hit.color;
      }
    }
  }
  return null;
}
