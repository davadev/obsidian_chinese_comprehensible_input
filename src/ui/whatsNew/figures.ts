import { setIcon } from "obsidian";

/**
 * Small illustrations for the "What's new" popup, drawn from the real interface elements instead of shipped as
 * screenshots: they follow the user's theme and font, add nothing to the plugin's size, and cannot go stale in a
 * way a screenshot does. They are decoration (aria-hidden, not clickable); the item's text carries the meaning.
 */

export type FigureId = "toolbar" | "mnemonic";
export const FIGURE_IDS: FigureId[] = ["toolbar", "mnemonic"];

/** The toolbar's icon buttons in order, as in `ViewToolbar`: known, unknown, partial, add custom word, highlighter. */
const TOOLBAR_ICONS = ["check-circle-2", "x-circle", "circle-help", "square-plus", "highlighter"];

function row(parent: HTMLElement, label: string, build: (strip: HTMLElement) => void, withBulb = false): void {
  const line = parent.createDiv({ cls: "cci-fig-line" });
  line.createSpan({ cls: "cci-fig-label", text: label });
  const strip = line.createDiv({ cls: "cci-fig-strip" });
  for (const icon of TOOLBAR_ICONS) setIcon(strip.createDiv({ cls: "cci-fig-btn" }), icon);
  // The new lightbulb button, right after the highlighter, ringed so the eye finds it.
  if (withBulb) setIcon(strip.createDiv({ cls: "cci-fig-btn cci-fig-new" }), "lightbulb");
  build(strip);
  setIcon(strip.createDiv({ cls: "cci-fig-btn" }), "more-horizontal");
}

function toolbarFigure(fig: HTMLElement): void {
  row(fig, "Before", (strip) => {
    const pills = strip.createDiv({ cls: "cci-fig-pills" });
    pills.createSpan({ cls: "cci-fig-pill is-on", text: "Status" });
    pills.createSpan({ cls: "cci-fig-pill", text: "HSK" });
  });
  row(
    fig,
    "Now",
    (strip) => {
      strip.createDiv({ cls: "cci-fig-mode", text: "Status" });
    },
    true
  );
  fig.createDiv({
    cls: "cci-fig-caption",
    text: "One button names the colouring in use; tap it to switch. That made room for the new lightbulb, ringed.",
  });
}

function mnemonicFigure(fig: HTMLElement): void {
  const word = fig.createDiv({ cls: "cci-fig-word" });
  word.createDiv({ cls: "cci-fig-mnemonic", text: "🗺️²📖¹🏛️³" });
  word.createDiv({ cls: "cci-fig-pinyin", text: "tú shū guǎn" });
  word.createDiv({ cls: "cci-fig-hanzi", text: "图书馆" });
  fig.createDiv({
    cls: "cci-fig-caption",
    text: "One picture per character, with its tone number right after it: map, book, building, tones 2, 1, 3.",
  });
}

/** Draw the illustration `id` into `parent`. */
export function renderFigure(parent: HTMLElement, id: FigureId): HTMLElement {
  const fig = parent.createDiv({ cls: `cci-whatsnew-figure cci-fig-${id}`, attr: { "aria-hidden": "true" } });
  if (id === "toolbar") toolbarFigure(fig);
  else mnemonicFigure(fig);
  return fig;
}
