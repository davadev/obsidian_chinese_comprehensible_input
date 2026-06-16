# Spaced repetition

Spaced repetition is the strategy of reviewing a word right before
you're about to forget it — when the recall is hardest but still
possible. Get it right and the word sticks; the next review pushes
further out. Get it wrong and it comes back soon. Over time, well-known
words are reviewed once a year while shaky words come back daily.

This page explains how the plugin schedules reviews and which knobs
matter.

## What "due" means

Every word in your vocabulary store has:

- **Status** — new / partial / known / unknown / ignored / etc. (See
  [word states](./word-states.md).)
- **Interval (days)** — how far apart consecutive reviews are.
- **Ease** — a multiplier applied after a successful recall. Higher
  ease = the interval grows faster.
- **Due date** — when the next review is scheduled.

The Flashcards tab → **Due** view shows everything whose due date has
passed.

## What counts as a "review"

Two things:

1. **Opening a generated story** (or any Chinese note) that contains a
   due word — if you don't long-press / pop-up the word, the system
   counts that as a successful recall (you saw it and understood it in
   context).
2. **Long-pressing a word** to open the popup — that's the "I needed
   help" signal. Optionally treated as a failed recall depending on
   **Popup on due is failed recall**.

The split between "saw it in context" and "needed the popup" is the
plugin's secret sauce. You're not drilling flashcards in isolation —
you're reading real content, and the system uses your read-vs-popup
signal to schedule review.

## Knobs in SRS settings

### Initial interval (days)

Default **1**. When a word transitions from "new" to "known," the first
review is scheduled this many days out. Raise to 2–3 if you find the
default too aggressive.

### Initial ease

Default **2.5**. Multiplier applied after a successful review. With
ease 2.5, a 1-day interval becomes 2.5 days, then 6.25, then 15.6, then
39 — roughly doubling. Higher = faster spacing; lower = tighter
review cadence.

The Anki-classic default is 2.5; tweaking is rarely worth it.

### Popup on due is failed recall

Default **on**. When you long-press a word that's currently due, the
SRS records a failed recall (interval resets, ease drops a notch). If
off, popups are neutral — useful if you treat the popup as "let me
just double-check, not a real fail."

### Schedule known occasionally

Default **off**. When on, the SRS keeps already-known words on a slow
review schedule (every few weeks/months) so they don't fall out of
memory. When off, known words leave the review queue entirely after
graduation.

Beginners: leave off. Intermediate and beyond: consider turning on,
especially for low-frequency known words.

## How exposure interacts with SRS

The SRS doesn't act on every exposure — only on the ones that match its
trigger conditions. See [exposure tracking](./exposure.md) for what
"exposure" means and the dedup rules that prevent spammy double-counts.

In short:

- Every visible exposure of a due word is a successful recall.
- A long-press on a due word is a failed recall (if the toggle is on).
- Marking a word from the toolbar (Mark known / unknown / partial)
  directly overrides the SRS — no recall logic, you said "I know this."

## Reading the Flashcards "Due" view

Lists due words sorted by overdue-ness. Click a word to open it in the
popup and look at its current interval / ease / due date.

The dashboard panel at the top of the Stats view shows daily, weekly,
and monthly progress of "reviews completed" so you can see your habit
forming.

## When to ignore the SRS

If you're using the plugin purely for graded reading and not vocabulary
study, you can disable popups (**Known word popups** in display
settings) and the SRS effectively becomes a passive counter. The
vocabulary store still tracks exposures and statuses; you just don't
get drilled.

## See also

- [Exposure tracking](./exposure.md) — what feeds the SRS.
- [Word states](./word-states.md) — what the statuses mean.
- [Story generation](./story-generation.md) — Smart Story uses
  "due" words as its target list.
- [FAQ](./faq.md)
