# Display modes and colors

The Chinese view can render the same note in several ways, ranging from
"plain Chinese with subtle colors" to "every word stacked with pinyin
and English." This page covers what each option does and how to mix
them.

## Display modes

Set in display settings as **Default display mode** and switchable
per-note from the toolbar.

### Two-line

Each word renders as Chinese on top, pinyin below. Ideal for reading
with audio support — your eyes still see the characters first, pinyin
underneath as a glance-fallback.

### Three-line

Chinese, pinyin, English meaning. Heavier visually but great for new
vocabulary or unfamiliar content. Good while learning a new chapter.

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
