import type { App } from "obsidian";
import type { CciSettings, FormatId } from "../settings/types";
import { FORMAT_LABELS } from "./formatApply";
import { resolveHighlightPalette } from "./highlightPalette";

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
