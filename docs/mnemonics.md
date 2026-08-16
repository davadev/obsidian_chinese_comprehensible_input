# Mnemonics

A mnemonic is a memory hook attached to one word. In this plugin it has
**two halves**:

| Half | What it is | Where you see it |
|---|---|---|
| **Emoji line** | A compact, mostly-emoji cue — max 40 characters | On the word card, always |
| **Story** | The prose that unpacks the emoji line | Behind the `▾` on the card |

Both are optional; fill in either, both, or neither.

## Why the emoji line is short

Two reasons. Emoji stick in memory better than a sentence you have to
re-read. And a **future** release may let you show the emoji line as the
third annotation line under a word, in place of the English gloss — a
bounded emoji strip fits in that narrow column, a paragraph never would.
That's why the field has a hard 40-character budget and a live counter.

## Writing or generating one

Long-press a word → **Mnemonic**. One button, one modal:

- Type your own emoji line and/or story, then **Save**.
- Or press **Generate with AI** (shown when AI is enabled in settings) —
  it fills **both fields in place**, so you can edit what it wrote, press
  Generate again to reroll, or throw it away with **Cancel**.
- Nothing is written to your vocabulary until you press Save. Clearing
  both fields and saving deletes the mnemonic.

A reroll sends whatever is currently in the fields as context, so you can
half-write a line and let the model finish it.

### What the AI aims for

The built-in system prompt asks for three things in the emoji line,
because those are what learners actually forget:

1. **Components / radicals** — each character part as a concrete image.
2. **Tone** — a consistent cue per syllable: ➡️ 1st (flat), ↗️ 2nd
   (rising), ↘️↗️ 3rd (dip then rise), ↘️ 4th (sharp drop), 〰️ neutral.
3. **Meaning** — last, so recall runs image → meaning.

Emoji come first; a word is allowed only where no emoji can carry the
idea (grammar particles, abstract senses). The story then says which
emoji stands for which component, names the tone cue, and lands on the
English meaning.

## Personalising the prompt

**Settings → AI provider → Mnemonic prompt ▾** holds the *user* half of
the prompt. Rewrite it to use imagery you personally remember, ask for a
different language, or point it at a memory palace you already use.

| Placeholder | Value |
|---|---|
| `{word}` | The Chinese surface form |
| `{pinyin}` | Tone-marked pinyin |
| `{traditional}` | Traditional form, or `(same)` |
| `{definitions}` | Current dictionary glosses, `;`-separated |
| `{sentence}` | The sentence you tapped the word in, when known |
| `{hsk}` | HSK level(s), or `(not in HSK lists)` |
| `{existing}` | What's in the emoji-line field right now |
| `{existingStory}` | What's in the story field right now |

Anything else in `{braces}` is passed through untouched. Clearing the box
falls back to the built-in prompt; **Reset to default prompt** restores it.

The emoji rules live in the fixed *system* prompt, so a customised user
template still gets them — and the JSON-only output contract stays intact.

## What happened to mnemonics written before 0.5.0

Before 0.5.0 there was a single free-text mnemonic field. On first load
after updating, the plugin migrates them — **nothing is deleted**:

- A mnemonic too long to be an emoji line is **moved into the story**
  field. The emoji line is left empty for you to fill in (or generate).
- A mnemonic that already fits stays on the emoji line.
- A record that somehow has both keeps both, untouched.

The migration is idempotent and also runs on data arriving from another
device via the vault mirror, so a device you haven't updated yet can't
undo it.

## Seeing your mnemonics

- **Word card** — the emoji line always shows; tap `▾` for the story.
  **Settings → Display → Advanced display → "Show mnemonic before full
  definition"** decides
  whether the block sits above or below the definitions.
- **Dashboard → Words** — open a word's detail card for both halves.

Mnemonics live in the vocabulary store, so they sync with everything else
via the [vault mirror](./sync-mirror.md).

## See also

- [Word states](./word-states.md) — the rest of the popup card
- [OpenAI setup, privacy, and cost](./openai-setup.md) — what leaves your vault
- [Ollama tips](./ollama-tips.md) — picking a local model that follows JSON instructions
