import type { App } from "obsidian";
import type { CciSettings, FormatId } from "../settings/types";
import { FORMAT_LABELS, isHighlight } from "./formatApply";
import { resolveHighlightPalette } from "./highlightPalette";
import { isEinkMode } from "../view/einkMode";

/**
 * Resolves the formatting-mode option list (#21 phase 2): the 9 fixed base
 * formats plus any available highlight colors, ordered and visibility-filtered
 * per the user's settings. Shared by the toolbar dropdown (visible only) and
 * the settings reorder list (all options).
 */

export const BASE_FORMAT_IDS: readonly FormatId[] = [
  "bold",
  "italic",
  "highlight",
  "strike",
  "code",
  "h1",
  "h2",
  "h3",
  "quote",
];

export interface FormatOption {
  id: string;
  label: string;
  /** Set for colored highlights — used to render a swatch. */
  color?: string;
}

/** Every option currently available (depends on the highlight palette). */
export function availableFormatOptions(app: App, settings: CciSettings): FormatOption[] {
  const base: FormatOption[] = BASE_FORMAT_IDS.map((id) => ({ id, label: FORMAT_LABELS[id] }));
  const colors: FormatOption[] = resolveHighlightPalette(app, settings).map((c) => ({
    id: `hl:${c.slug}`,
    label: `Highlight: ${c.label}`,
    color: c.color,
  }));
  return [...base, ...colors];
}

/**
 * Options in the user's order. Persisted `formatOrder` ids come first (in
 * order); any newly-available option not yet in `formatOrder` is appended.
 * When `includeHidden` is false, `formatHidden` ids are filtered out.
 */
export function orderedFormatOptions(
  app: App,
  settings: CciSettings,
  includeHidden: boolean
): FormatOption[] {
  const avail = availableFormatOptions(app, settings);
  const byId = new Map(avail.map((o) => [o.id, o] as const));
  const seen = new Set<string>();
  const out: FormatOption[] = [];
  for (const id of settings.formatOrder) {
    const o = byId.get(id);
    if (o) {
      out.push(o);
      seen.add(id);
    }
  }
  for (const o of avail) if (!seen.has(o.id)) out.push(o);
  return includeHidden ? out : out.filter((o) => !settings.formatHidden.includes(o.id));
}

/**
 * What the reading view's picker offers. Same as `orderedFormatOptions(…, false)`
 * except in E-ink mode (#112), where the coloured highlights are dropped (pastel
 * tints all print as the same light grey on e-paper) and the plain `==` highlight is
 * always offered, even if the user hid it, so the picker can never come up without a
 * highlight. It is an overlay: the saved order / hidden list are not touched, and the
 * settings list keeps using `orderedFormatOptions(…, true)` to show the real state.
 */
export function pickerFormatOptions(app: App, settings: CciSettings): FormatOption[] {
  if (!isEinkMode(settings)) return orderedFormatOptions(app, settings, false);
  return orderedFormatOptions(app, settings, true).filter(
    (o) => !o.id.startsWith("hl:") && (o.id === "highlight" || !settings.formatHidden.includes(o.id))
  );
}

/**
 * The armed formats as the reading view should act on them. In E-ink mode a saved
 * colour (`hl:pink`) is mapped to the plain highlight, never dropped: dropping it
 * could leave the list empty, and an empty list means "clear all formatting" to the
 * tap-to-format flow. Mapping also keeps the plain checkbox usable (a hidden armed
 * colour would otherwise count as "another highlight is armed"). Elsewhere: as saved.
 */
export function effectiveFormats(settings: CciSettings): string[] {
  if (!isEinkMode(settings)) return settings.enabledFormats;
  const out: string[] = [];
  for (const id of settings.enabledFormats) {
    const mapped = id.startsWith("hl:") ? "highlight" : id;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Armed list after the user ticks / unticks `id` in the picker menu. Unticking the
 * plain highlight in E-ink mode also clears any saved colour, which the menu showed
 * as the plain highlight (see `effectiveFormats`) — otherwise it would stay armed
 * out of sight.
 */
export function toggleFormat(settings: CciSettings, id: string, on: boolean): string[] {
  const cur = settings.enabledFormats;
  if (on) return [...cur, id];
  if (isEinkMode(settings) && id === "highlight") return cur.filter((f) => !isHighlight(f));
  return cur.filter((f) => f !== id);
}

/** One-time notice for switching E-ink mode on, or null when the picker looks the same. */
export function einkPickerNotice(app: App, settings: CciSettings): string | null {
  const real = orderedFormatOptions(app, settings, false);
  const differs =
    real.some((o) => o.id.startsWith("hl:")) || !real.some((o) => o.id === "highlight");
  if (!differs) return null;
  return (
    "E-ink mode: the formatting picker offers only the plain highlight (shown in grey). " +
    "Turn E-ink mode off to get your own picker back."
  );
}
