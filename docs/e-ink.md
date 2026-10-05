# E-ink readers

The plugin works on e-ink devices — Boox, Bigme, reMarkable-style readers, anything
running Obsidian on an e-paper screen — but its default look is tuned for colour.
Since 0.7.8 there is a built-in **E-ink mode**; this page explains it, and also keeps
the CSS snippet it grew out of for anyone who wants to tweak the look by hand.

## E-ink mode

**Settings → Display → E-ink mode.** One switch. It replaces the coloured tints with
underlines, and it needs no CSS:

| Colour mode | What you see |
|---|---|
| **Status** (known / partial / unknown) | known = light underline, partial = dotted, unknown = solid, **new = unmarked** |
| **HSK level** | one solid underline **plus the level (1–7) as a small number** beside the word |

In HSK mode the number does the job colour used to do: seven levels cannot be told
apart by underline weight and style without turning into noise, so the level is
written out instead. `7` stands for HSK 7–9. Words with no HSK level stay unmarked,
as they are in colour mode.

- **It is an overlay, not a preset.** It changes none of your other settings — turn it
  off and your colours, colour mode and switches are exactly as you left them.
- **It applies to this device only.** It is deliberately *not* synced: a choice made
  because of an e-ink screen should not switch your phone to underlines.
- **The colour pickers are greyed out while it is on**, because the reading view no
  longer uses them. They still tint the **statistics** view, and they come back the
  moment you turn the mode off. The "Color … words" switches stay live: with E-ink mode
  on they decide *which* words get an underline.
- **Level-number size.** In E-ink mode with HSK colours there is a size slider, in
  Settings → Display and in the reading view's **…** menu beside the other size sliders,
  from 50 % to 130 % of the default. The number follows the reader font size (it is
  sized relative to the characters, so the "bigger Chinese, smaller annotations" recipe
  in [Display modes](./display-modes.md#text-size) keeps it in proportion) and ignores
  annotation size. It never goes below 6 px, which is also where 50 % lands at the
  default 22 px font, so at smaller reader fonts the low end of the slider stops
  changing anything; the cap at 130 % is where the number would start to rival the
  character.
- **It works in every display mode** — plain, two-line and three-line.
- If you already use the snippet below, **remove it when you turn E-ink mode on**. The
  mode's rules are more specific and win, but two systems styling the same words is just
  confusing.

Things to know:

- A highlighted word keeps its highlight and shows no underline or number: when a
  highlight and a status colour would both show, the plugin shows only one (by default the
  highlight), exactly as in colour mode.
- In HSK mode you lose the known / unknown signal, as you do in HSK colour mode. Use
  Status mode when you want it.
- **Underlines are drawn under the characters.** Plain and annotated words get exactly the
  same underline, at the same height, in any font. In the default two-line layout, a word
  whose pinyin is wider than its characters (聊 天) is underlined character by character, so
  the line can look broken where the pinyin pushes them apart.
- **A word's number stays with the word.** If a word wraps across two lines, the number follows
  its last part; it never drops to the next line on its own.
- E-ink mode never changes how tall a line is, whatever your font size, line spacing or
  annotation size.
- In HSK mode, each annotated word gains a small gap for its number, so text can re-wrap
  slightly when you switch the mode on.
- Dotted 3 px lines and numbers as small as 6 px are unproven on real e-paper. If something reads
  badly on your device, please say so on
  [#112](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues/112).

## The CSS snippet

**The approach and the original snippet are [huwhowell](https://github.com/huwhowell)'s**,
contributed in [issue #112](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues/112),
along with the first photo any of us had seen of the plugin running on e-paper.
The version below is theirs with the scoping corrected — see
[what changed](#what-changed-from-the-original) if you are already using it.

> I have not tested this on an e-ink device myself. The selectors and their
> specificity are verified against the plugin's stylesheet; the judgement that
> 3px underlines at these weights read well on e-paper is huwhowell's.

### Why underlines

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

### Using the snippet

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
  (`cci-color-hsk-1` … `-7`) and still paint in full colour. The built-in
  [E-ink mode](#e-ink-mode) handles HSK by writing the level as a number; the
  snippet does not.
- **A highlighted word keeps its highlight.** When a highlight and a status colour
  would both show, the plugin shows only one — by default the highlight — so a
  highlighted word carries no status class for this snippet to restyle. If you want the
  highlight band gone too, add `.cci-view .cci-stack-hl { background-image: none; }` —
  but then you lose highlights entirely, which may be worse. Your call.
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

## Snippet or built-in mode?

Use **E-ink mode** unless you want to change the look itself. It is maintained with the
plugin, understands HSK mode, is device-local, and greys out the settings it makes
irrelevant. The snippet stays here as the starting point if you want different line
weights or colours — copy it, change the values, and leave E-ink mode off.

The mode reproduces this snippet exactly for the status colours (a layout check in the
repository compares them), so switching from one to the other changes nothing you can see
in Status mode.

If you read on e-ink, [#112](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues/112)
is the place to say what would work better for you.

## See also

- [Display modes and colors](./display-modes.md) — the colour system this replaces.
- [Themes and plugin compatibility](./compatibility.md) — what other CSS can and cannot reach.
- [Word states](./word-states.md) — what each status means.
