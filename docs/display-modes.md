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
- **3 · Known-word popups** · **4 · Font size** · **5 · Line spacing** ·
  **Chinese size** · **Annotation size**.
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

## Text size

Three separate controls. All of them live in **Settings → Display**, and all
of them are also in the toolbar's **More** menu — they are things you adjust
while reading, not once during setup:

- **Reader font size (px)** — scales the whole view together. Start here.
- **Chinese size (%)** — the characters only, relative to the rows above
  them. Raise it when the characters feel cramped at a font size that is
  comfortable for English: Han glyphs pack far more stroke detail into the
  same square than Latin letters do, so they need more size to read
  without strain.
- **Annotation size (%)** — the pinyin and translation rows only. Raise it
  if they get too small to read on a high-resolution screen.

### Why the two percentages behave differently

Each word is only as wide as its **widest row**. With the downloaded
CC-CEDICT dictionary the English translation is that row for **82%** of
its 125,008 entries at default sizes — 98% for single-character words,
where a long translation sits over one narrow glyph.

So:

- **Annotation size always changes word spacing.** You are growing the
  row that usually sets the width, so the Chinese spreads apart.
- **Chinese size mostly doesn't — at first.** Below about 120% the
  characters are still narrower than their translation, so they grow
  inside a box that was already that wide. Push further and they
  progressively overtake it, word by word: the translation still sets
  the width for 64% of words at 140%, but only 42% at 200%. Spacing
  opens up gradually rather than all at once.

In two-line mode with pinyin there is no translation row at all, so the
characters set the width immediately and the whole line scales together.

## What goes on each line

The Chinese characters are always the bottom line. The rows above them are
yours to choose, in **Settings → Display → Annotation lines**:

```
   line 3   English / mnemonic        (three-line mode only)
   line 2   pinyin / English / mnemonic
   line 1   你好                       always the characters
```

- **Line 2** sits directly above the characters, and is the only row a
  two-line layout shows. If you want English under the Chinese without
  pinyin, set it here and stay in two-line mode.
- **Line 3** appears only in three-line mode. It cannot show pinyin,
  because pinyin is aligned one syllable per character — which only works
  directly above them.

Setting both rows to the same thing is allowed but warned about; it just
prints the same text twice.

### When a row disappears

Each kind of content retires on its own terms, and follows the content
wherever you put it:

- **Pinyin** goes once you know both the characters and the pronunciation.
- **English** goes once you know the meaning.
- **A mnemonic** goes once you know the word completely — it exists to
  help you recall something you can't yet, so it retires with the rest.

A row is also skipped for any word that has nothing to put there — a word
with no mnemonic, or no translation.

### Mnemonics on a line

Mnemonics are truncated hard inline, much shorter than on the word card.
They are mostly emoji, and emoji are about as wide as Chinese characters,
so a full-length one would stretch its word far wider than its neighbours.
Tap the word to read the whole thing.

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

### Reader text colors

The status / HSK colors above are **background** tints. Separately, under
**Settings → Display → Advanced display → Reader text colors**, you can set the **font**
color of each of the three reader rows:

| Row | What it colors |
|---|---|
| Characters | The Chinese characters, in every display mode |
| Pinyin | The pinyin row in two-line / three-line mode |
| English translation | The gloss row in three-line mode |

The master toggle is **off by default**, and while it is off your theme
decides all three colors (`--text-normal` / `--text-muted` /
`--text-faint`) — which is what keeps dark themes readable. Turn it on
and you get black characters with grey pinyin and grey translation, each
adjustable with a color picker. Turning it back off restores the theme's
colors immediately.

This lives in settings only, not in the view toolbar: it's a "set it
once" preference, unlike the display mode. Background tints, highlights,
and text colors all combine, so a red-tinted unknown word can still have
black characters.

## Behaviour toggles

### Known word popups

Default **off**. When off, long-pressing a known word does nothing —
clean reading. Turn on if you sometimes want to refresh your memory on
a word you "should" know.

## See also

- [Word states](./word-states.md) — what each status / color means.
- [FAQ](./faq.md) — common color / display confusion.
