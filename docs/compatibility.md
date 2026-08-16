# Themes and plugin compatibility

This plugin renders Chinese notes in its own view (**Chinese Learning
view**), so its relationship with themes and other community plugins is a
bit different from a normal Markdown note. This page lists what is
supported, what is supported *without* the other thing installed, and
where the limits are.

Two rules of thumb:

1. **Inside** the Chinese Learning view, this plugin does the rendering.
   Anything you see there — headings, checkboxes, highlights, ruby
   annotations — is drawn by this plugin's own CodeMirror decorations.
2. **Outside** it, in Obsidian's normal Markdown view, your notes are
   plain Markdown, so every theme and plugin behaves exactly as usual.
   Nothing this plugin writes to a note is proprietary.

---

## Themes

### Things-style task checkboxes

The [Things theme](https://github.com/colineckert/obsidian-things) (and
several others, e.g. Minimal and Border) supports *alternate checkboxes*:
task markers where the character inside the brackets picks an icon,
`- [!] urgent thing`. Standard Markdown only knows `- [ ]` and `- [x]`.

The Chinese Learning view renders these too, using its own Lucide-icon
widget. That means:

- It works **whether or not the Things theme is installed** — you don't
  need the theme to get the icons inside the Chinese view.
- The icon set is this plugin's, not the theme's, so a task can look
  slightly different inside the Chinese view than in your Markdown view.
  The *meaning* of each character matches the Things convention.
- The underlying note text is untouched — still `- [!] …` — so the theme
  renders its own version everywhere else.

Supported characters:

| Marker | Meaning | Marker | Meaning |
|---|---|---|---|
| `[ ]` | to do | `[k]` | key |
| `[/]` | in progress | `[w]` | win / trophy |
| `[x]` / `[X]` | done | `[u]` | trending up |
| `[-]` | cancelled | `[d]` | trending down |
| `[>]` | forwarded | `[S]` | savings |
| `[<]` | scheduled | `[I]` | idea |
| `[?]` | question | `[p]` | pro |
| `[!]` | important | `[c]` | con |
| `[*]` | star | `[f]` | fire |
| `["]` | quote | `[D]` | draft PR |
| `[l]` | location | `[P]` | open PR |
| `[b]` | bookmark | `[M]` | merged PR |
| `[i]` | info | | |

Any other character falls back to an empty square.

### Heading sizes, fonts, and colors

Headings inside the Chinese Learning view are scaled by this plugin
(H1–H6), because a heading line in two-line / three-line mode has to make
room for the pinyin and gloss rows. Your theme's heading *fonts* and
*colors* are not applied to annotated words in those modes — the
annotation widget draws them.

Reader font size, line spacing, and (since 0.5.0) the font colors of the
character / pinyin / English rows are all set in
**Settings → Chinese Comprehensible Input → Display**. The text-color
option is **off by default**, which is what keeps dark themes looking
correct out of the box; see [Display modes and colors](./display-modes.md).

---

## Plugins

### Highlightr

[Highlightr](https://github.com/chetachiezikeuzor/Highlightr-Plugin)
provides colored `<mark>` highlights. This plugin integrates with it in
both directions:

- If Highlightr is **installed and enabled**, its color palette is read
  from its settings and its colors appear in this plugin's tap-to-format
  picker as `hl:<color>` options.
- If Highlightr is **not installed**, turn on
  **Settings → Formatting picker → "Show highlight colors without
  Highlightr"** to get a built-in fallback palette (Pink, Red, Orange,
  Yellow, Green, Cyan, Blue, Purple). Those highlights render correctly
  inside the Chinese view; install Highlightr if you also want them
  styled in normal Markdown views.

Highlights are written as plain `==text==` or Highlightr's `<mark
style="...">` markup, so nothing is locked in. See
[Formatting and highlighting](./formatting.md) for the full picture,
including how a highlight interacts with a word's status/HSK color
(**"Highlight overrides status / HSK colors"**).

### remotely-save, Obsidian Sync, Syncthing, iCloud, …

This plugin's vocabulary and (optionally) its settings are mirrored to
plain JSON files **inside your vault**, deliberately outside
`.obsidian/`, so any file-level sync tool moves them without you having
to enable "sync config folder". Merge and conflict rules are documented
in [Vault-mirror sync](./sync-mirror.md) and
[Conflict resolution](./conflicts.md).

### BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the supported way
to install beta builds. Every release of this plugin ships `main.js`,
`manifest.json`, and `styles.css` as release assets, which is exactly
what BRAT needs. Prereleases (`0.X.Y-rc.N`) are visible to
**Add Beta Plugin** testers only; regular BRAT users stay on the last
stable release. See [Install via BRAT](./install.md).

### Dataview, Templater, and other Markdown-processing plugins

These work on your notes as normal **in Obsidian's Markdown view**. They
do **not** run inside the Chinese Learning view: that view is a custom
`FileView`, not a `MarkdownView`, so Obsidian's Markdown post-processor
pipeline (which is what those plugins hook into) is never invoked there.
A Dataview block will show up as its literal source text in the Chinese
view.

If you need a note's full plugin-rendered output, open it in the normal
Markdown view — the toolbar's back-to-Markdown button does this in one
tap, and on mobile the Edit mode routes there deliberately.

---

## Known limitations

- **Third-party Markdown post-processors don't run in the Chinese view**
  (see above). This is by design; the view has to control tokenization and
  annotation of every character position.
- **Most theme CSS does not reach annotated words.** They are rendered as
  widgets with this plugin's own classes (`.cci-stack-*`). Snippets can
  still target those classes if you want to restyle them.
- **Frontmatter is hidden in the Chinese view.** YAML is stripped at the
  view boundary and re-attached on save, so plugins that read frontmatter
  are unaffected — you just can't edit it there.
- **Custom checkbox characters are rendered, not clickable.** Toggling a
  task is done in the Markdown view.

Something missing or broken with a theme/plugin combination you use?
[Open an issue](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues).
