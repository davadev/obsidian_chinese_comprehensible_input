# Exposure tracking

Every time you see a Chinese word in a note, the plugin can count that
as an "exposure." Enough exposures + the right interactions (or lack of
them) is what graduates a word from new → partial → known. This page
explains what counts and the dedup rules.

## What is an exposure?

The plugin watches the Chinese view and marks words as exposed when
they are visible to you for long enough. "Long enough" is configurable
— see **Minimum visible ms** below.

The point is to count *real* reading, not flashes during scroll. If you
fly past a sentence in 50 ms, the words shouldn't count as exposed.

## Settings under Exposure tracking

### Minimum visible ms

Default **1000** (one second). A word must be on-screen for this many
milliseconds before it counts. Raise to 2000+ if you skim a lot and want
exposures to mean "I actually read it."

### Max once per note per session

Default **on**. A single word in a single note can count as exposed
only once per session, no matter how long you stare at it. Prevents
"sitting on one paragraph" from inflating your stats.

### Max once per day

Default **off**. When on, a word can't be counted again on the same
calendar day even across different notes. Useful if you re-read the same
material a lot and want a stricter dedup.

### Popup counts as exposure

Default **on**. When you long-press a word and look at the popup, that
counts as an exposure (you definitely saw it). Turn off if you want
popups to be neutral — just a lookup, not a contribution to known-ness.

### Generated reading counts as exposure

Default **on**. Words in generated stories count toward exposure totals
just like words in your own notes. Turn off if you want a clean split
between "real reading" and "AI-generated practice."

## How exposure pushes status

Exposure feeds the vocabulary store, which can promote a word
automatically based on how often you see it without needing the popup:

- A few visible exposures with no popups → the word drifts toward
  **known** in the dashboard's progress charts.
- A long-press popup logs a "needed help" event → blocks the drift
  toward known, or actively pulls the word back toward **partial**.

You can always override by hand: long-press → Mark known / partial /
unknown.

## The interaction with SRS

Once a word is **known**, it enters the spaced repetition queue (see
[SRS](./srs.md)). Each subsequent exposure of a due word counts as a
successful recall and the interval extends. A popup on a due word
counts as a failure (if **Popup on due is failed recall** is on).

So exposure does two things in sequence:

1. Before known: build the case for graduating the word to known.
2. After known: drive the SRS schedule.

## When to tune the dedup rules

- **You're a first-time user** who's never read Chinese in Obsidian:
  leave defaults. They're tuned for the median case.
- **You re-read the same materials a lot** (textbook chapters, song
  lyrics): turn on **Max once per day** so exposure counts reflect
  fresh reads, not repeats.
- **You skim faster than you read**: bump **Minimum visible ms** to
  2000+.
- **You use the popup as a translator, not a fail signal**: turn off
  **Popup counts as exposure**.

## See also

- [Spaced repetition](./srs.md) — what happens after a word is known.
- [Word states](./word-states.md) — the full status taxonomy.
- [FAQ](./faq.md)
