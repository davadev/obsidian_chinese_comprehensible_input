# E-ink readers

The plugin works on e-ink devices — Boox, reMarkable-style readers, anything
running Obsidian on an e-paper screen — but its default look is tuned for colour.
This page carries a CSS snippet that replaces the status tints with underlines,
which reads far better in black and white.

**The approach and the original snippet are [huwhowell](https://github.com/huwhowell)'s**,
contributed in [issue #112](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues/112),
along with the first photo any of us had seen of the plugin running on e-paper.
The version below is theirs with the scoping corrected — see
[what changed](#what-changed-from-the-original) if you are already using it.

> I have not tested this on an e-ink device myself. The selectors and their
> specificity are verified against the plugin's stylesheet; the judgement that
> 3px underlines at these weights read well on e-paper is huwhowell's.

## Why underlines

The default styling puts a translucent colour behind each word. On a
black-and-white panel those tints all render as similar greys, so they are hard
to tell apart and they compete with the characters themselves — which is exactly
what you are trying to read.

Underlines sit on a common baseline and differ only in weight and line style, so
they stay distinguishable without adding visual noise:

| Status | Mark |
|---|---|
| Known | 3px light grey, solid — present but barely noticeable |
| Partial | 3px black, dotted — moderate weight |
| Unknown | 3px black, solid — heaviest |
| New | deliberately unmarked |

Leaving **new** words unmarked is a deliberate choice, not an omission. There is
a hard limit to how many states can be told apart in greyscale, and absence of a
mark is itself a usable signal.

## The snippet

Save this as a `.css` file in `.obsidian/snippets/` and enable it under
**Settings → Appearance → CSS snippets**.

```css
/* E-ink: replace status tints with underlines. Scoped to the reading view. */
.cci-view .cci-word.cci-color-known,
.cci-view .cci-word.cci-color-partial,
.cci-view .cci-word.cci-color-unknown,
.cci-view .cci-word.cci-color-new {
  background: none;
  border-bottom: none;
}
.cci-view .cci-word.cci-color-known   { border-bottom: 3px solid #aaa; }
.cci-view .cci-word.cci-color-partial { border-bottom: 3px dotted #000; }
.cci-view .cci-word.cci-color-unknown { border-bottom: 3px solid #000; }
/* New: deliberately left unmarked. */
```

No `!important` anywhere, on purpose. `.cci-view` adds enough specificity to win
against the plugin's own rules, so your snippet stays overridable by anything you
add later.

## What it does not cover

Three things this cannot reach, so you know before you wonder:

- **HSK colour mode is untouched.** Those are separate classes
  (`cci-color-hsk-1` … `-7`) and still paint in full colour. Seven levels cannot
  be told apart by underline weight and style without becoming noise, which is
  the open design question behind making this a built-in setting rather than a
  snippet.
- **The search / formatting highlight stays coloured in 2-line and 3-line
  modes.** That band is painted as a background *image* (a gradient) on the
  annotated word, so resetting `background-color` does not remove it. Adding
  `.cci-view .cci-stack-hl { background-image: none; }` removes it entirely —
  but then you lose the highlight, which may be worse. Your call.
- **Annotated and plain words render through different paths.** The snippet
  above targets the word element, which both share; anything you add for the
  annotation rows needs its own `.cci-stack-*` rules.

## What changed from the original

If you are using the version posted in #112, three things are worth fixing:

1. **`[class*="known"]` also matches `unknown`.** The class string is
   `cci-color-unknown`, which contains `known` as a substring. Both rules had
   the same specificity and both used `!important`, so the winner was decided by
   source order — `unknown` happened to come last and the result looked right.
   Reorder the blocks and unknown words silently turn grey.
2. **The selectors were not scoped**, so they also reached the statistics view
   (`cci-color-known` on the stat cards, `cci-row-color-known` on table rows),
   the triage buttons (`is-known`) and the toolbar banner — stripping
   backgrounds and adding 3px underlines in places you probably did not intend.
3. **The `:root` block was inert.** The plugin writes `--cci-color-known` and
   friends as inline styles on `document.body` whenever custom colours are set
   (the default), and an inline style beats `:root`. That is why the original
   needed `!important` on the class rules — they were the only part doing
   anything.

## A built-in setting?

Wanted, and tracked in
[#112](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues/112).
The blocker is the HSK question above: an "underline mode" has to decide what
HSK colour mode *does* — disable it, collapse it, or accept that it looks wrong —
and that is a design decision rather than a CSS one.

If you read on e-ink, the issue is the place to say what would work for you.

## See also

- [Display modes and colors](./display-modes.md) — the colour system this replaces.
- [Themes and plugin compatibility](./compatibility.md) — what other CSS can and cannot reach.
- [Word states](./word-states.md) — what each status means.
