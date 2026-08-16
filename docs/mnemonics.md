# Mnemonics

A mnemonic is a memory hook attached to one word. This plugin stores one
per word, shows it on the word popup, and (optionally) puts it *above*
the dictionary definitions so it's the first thing you read.

There are two ways to get one.

## Writing one by hand

Long-press a word → **Mnemonic…** → type it → done. This has always been
here and needs no AI.

## Generating one with AI

With AI enabled (**Settings → AI provider → Enabled**), the word popup
also shows **Mnemonic ✨**. Tapping it opens a preview:

- **Accept** saves the mnemonic onto the word.
- **Regenerate** rerolls with the same prompt — mnemonic quality is
  hit-or-miss by nature, and rerolling a few times is normal.
- **Cancel** writes nothing.

Nothing is saved until you press Accept, so an existing hand-written
mnemonic is never silently replaced. If one exists, the modal shows it
above the new suggestion.

### What a good mnemonic contains

The built-in system prompt asks the model for three things, because those
are the three things learners actually forget:

1. **Components / radicals** — the characters broken into parts, each
   given a concrete image.
2. **Tone** — encoded with a physical cue per syllable (1st flat and
   high, 2nd rising, 3rd dipping then rising, 4th a sharp drop, neutral
   light and quick).
3. **Meaning** — as the punchline, so recall runs image → meaning.

The model may also return a longer **story** when a scene genuinely
helps; it is stored alongside the mnemonic.

## Personalising the prompt

Mnemonics work best when they use *your* imagery. Under
**Settings → AI provider → Mnemonic prompt ▾** you can rewrite the user
half of the prompt — tell it about the people, places, films or jokes you
remember, ask for a different language, or point it at a memory palace
you already use.

These placeholders are substituted before sending:

| Placeholder | Value |
|---|---|
| `{word}` | The Chinese surface form |
| `{pinyin}` | Tone-marked pinyin |
| `{traditional}` | Traditional form, or `(same)` |
| `{definitions}` | Current dictionary glosses, `;`-separated |
| `{sentence}` | The sentence you tapped the word in, when known |
| `{hsk}` | HSK level(s), or `(not in HSK lists)` |
| `{existing}` | Your current mnemonic, or `(none yet)` |

Anything else in `{braces}` is left alone, so you can write literal
braces safely. Clearing the box falls back to the built-in prompt; the
**Reset to default prompt** button restores it explicitly.

The fixed system prompt (components + tone + meaning, JSON-only output)
is not editable — it's what keeps responses parseable.

## Seeing your mnemonics

- **Word popup** — turn on **Settings → Display → "Show mnemonic before
  full definition"** to put it above the definitions.
- **Dashboard → Words** — open a word's detail card.

Mnemonics live in the vocabulary store, so they sync with everything else
via the [vault mirror](./sync-mirror.md).

## See also

- [Word states](./word-states.md) — the rest of the popup card
- [OpenAI setup, privacy, and cost](./openai-setup.md) — what leaves your vault
- [Ollama tips](./ollama-tips.md) — picking a local model that follows JSON instructions
