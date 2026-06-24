# Display modes and colors

The Chinese view can render the same note in several ways, ranging from
"plain Chinese with subtle colors" to "every word stacked with pinyin
and English." This page covers what each option does and how to mix
them.

## The toolbar

<img src="../resources/screenshots/desktop-toolbar-annotated.png" alt="Annotated Chinese-view toolbar" width="620">

- **1 · Edit** (read ↔ edit) · **2 · Known** · **3 · Unknown** · **4 · Partial** — tap a word to set its status.
- **5 · Add custom word** · **6 · Highlighter** ([formatting mode](./formatting.md)).
- **7 · Status / HSK** color switch · **8 · More** (the display menu).
- **9 · Note status bar** — coverage %, top HSK.

The **More** menu holds the display controls:

<img src="../resources/screenshots/desktop-display-menu-annotated.png" alt="Annotated display menu" width="330">

- **1 · Show / hide colors** · **2 · Display mode** (2-line / 3-line / None).
- **3 · Known-word popups** · **4 · Font size** · **5 · Line spacing**.
- **6 · Stats** · **7 · Generate story**.

## Display modes

Set in display settings as **Default display mode** and switchable
per-note from the toolbar.

### Two-line

Each word renders with pinyin on top and characters below. Standard
ruby-text layout — your eye lands on the pinyin first and reads the
chars right under it. Ideal for content where you want pronunciation
support without losing the visual flow of the Chinese line.

### Three-line

English meaning on top, pinyin in the middle, characters on the
bottom. Heavier visually but great for new vocabulary or unfamiliar
content. Good while learning a new chapter — the gloss row also
pushes word boundaries apart so glosses don't overlap their neighbors.

### None

Plain Chinese only. Annotations only appear in the popup when you
long-press a word. Best for serious reading where two-line distracts.

Switching mode is instant — no scroll loss, no white flash. The plugin
uses CodeMirror compartments to swap decorations in place.

## Edit vs read

When the view is in **Edit** mode (toolbar button), annotations are
suppressed — you see plain Chinese as you type. Switching back to
**Read** restores them. This works for every display mode because the
plugin uses non-widget decorations during edit.

## Pinyin styles

- **Marks**: with diacritics — `xué xí`. Standard textbook style.
- **Numbers**: `xue2 xi2`. Easier on some fonts; some learners prefer
  it.
- **None**: pinyin row stays empty (useful in three-line mode if you
  want only Chinese + English).

## Colors

### What gets colored

Words get a colored tint based on **status** (default) or **HSK level**
(if you switch to HSK color mode). The tint applies in two-line,
three-line, and none modes — it's not display-mode-dependent.

A word's status drives both its color and how much help is shown (here in
3-line mode):

<img src="../resources/screenshots/desktop-three-line-annotated.png" alt="Three-line view with words colored by status" width="620">

1. **Known** (green) — characters only, no help.
2. **Partial** (yellow) — adds pinyin / meaning for a half-known word.
3. **New / untracked** (blue) — full gloss + pinyin + characters.
4. **Unknown** (red) — full gloss + pinyin + characters, flagged for attention.

### Color toggles

| Toggle | Default | What it does |
|--------|---------|--------------|
| **Show known color** | off | Tint known words. Off makes reading flow because most of the text is uncolored. |
| **Show partial color** | on | Half-known words show yellow — easy to spot for revisit. |
| **Show unknown color** | on | Red flags. Useful when learning new vocabulary. |
| **Show new color** | on | Subtle blue for unclassified words — the post-vault-index pile. |

In **HSK color mode** the per-status toggles are inert; the per-HSK
toggles (1–7) take over. Useful for picking a comfortable reading level
visually.

### Highlights vs. status colors

A manual highlight (from the [formatting mode](./formatting.md)) and a status /
HSK tint can land on the same word. **Settings → Formatting picker → "Highlight
overrides status / HSK colors"** decides which wins: on (default) shows the
highlight, off keeps the status color. See
[Formatting and highlighting](./formatting.md).

### Custom colors

You can override every status / HSK level color under **Custom
colors**. The plugin derives a sensible default HSK palette from your
Obsidian accent color on first install — most users never need to
change this.

## Behaviour toggles

### Known word popups

Default **off**. When off, long-pressing a known word does nothing —
clean reading. Turn on if you sometimes want to refresh your memory on
a word you "should" know.

### New word behavior

- **Subtle** (default): show new words with the subtle blue tint, no
  inline annotation.
- **Popup-only**: no tint, but tapping opens the popup.
- **Annotate**: full pinyin + meaning inline (forces three-line for
  these words).

### Unknown word behavior

- **Annotate** (default): unknown words get pinyin + meaning inline.
- **Popup-only**: clean reading; tap to see info.

## See also

- [Word states](./word-states.md) — what each status / color means.
- [FAQ](./faq.md) — common color / display confusion.
