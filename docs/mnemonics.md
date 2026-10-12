# Mnemonics

A mnemonic is a memory hook attached to one word. In this plugin it has
**two halves**:

| Half | What it is | Where you see it |
|---|---|---|
| **Emoji line** | A compact, mostly-emoji cue with the tone numbers — max 40 characters | On the word card, always |
| **Story** | The prose that unpacks the emoji line | Behind the `▾` on the card |

Both are optional; fill in either, both, or neither.

## Showing a mnemonic under a word

Since 0.7.7 the emoji line can sit on either annotation row — pick it for
line 2 or line 3 under **Settings → Display → Advanced display → Annotation
lines** (see [Display modes](./display-modes.md#what-goes-on-each-line)).

Inline it is clamped to **14 characters**, against the 40 the word card
allows. The card has a whole line to itself; a row under a word competes for
width with that word's neighbours, and emoji render nearly as wide as Han
characters — at 40 a two-character word would stretch to roughly seventeen
characters wide and shove the words beside it apart. Anything longer is cut
with an ellipsis. Nothing is lost: the clamp is applied when drawing, so your
stored mnemonic and the word card always keep the full text.

A row with no mnemonic simply is not drawn, so setting a row to Mnemonic
shows it only on the words that have one.

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

Since 0.9.0 the plugin works out everything it can itself and asks the model
only to draw. The model returns one **picture group per character** (1–3
emoji) and a story. The plugin then writes the line:

- **Words of several characters** — one picture per character, each followed
  by that character's **tone number** as a small raised digit:
  `🗺️²📖¹🏛️³` for 图书馆 (tú ² · shū ¹ · guǎn ³). The tone sits right
  after the character it belongs to. `⁰` is the neutral tone. The model is
  told what each character means (from the dictionary) and picks pictures
  that, in order, hint at the meaning of the whole word, so there is no
  separate meaning strip to repeat them.
- **A single character** — the parts it is built from, then the tone number,
  then a short emoji strip for the meaning: `❤️³🤔` for 想 (xiǎng).

Tone numbers are standard pinyin tone numbers, so ¹ is the flat first tone
and ⁴ is the falling fourth. Because the plugin writes them, they are always
right; in testing, models asked to write the tone cues themselves got them
wrong in up to half of the answers. It also frees arrows and other symbols
for the pictures themselves.

The line never contains Chinese characters, letters or digits from the model
— the word is already shown next to it. The plugin checks the model's answer
(right number of groups, emoji only, a short meaning strip, within the
40-character budget) and, if a rule was broken, asks once more with the
specific problem. If it is still wrong you are told what is off instead of
being handed a silently worse result, and Chinese characters are removed from
the line either way.

The story says which emoji stands for which character or part and lands on
the English meaning. The word's own characters always carry their
tone-marked pinyin — 学 (xué), not a bare 学 — and that pinyin is written by
the plugin from the dictionary, so a model slip cannot teach you a wrong
reading. Parts are described by their picture ("the water radical"), not by
pinyin.

Mnemonics you already have keep the style they were written in; generating
again replaces them with the new style.

## A mnemonic for every word in a note

Open a note in the reader, tap the **⋯** menu and choose **Generate
mnemonics**. The plugin finds the words in the note that have no mnemonic
yet and, once you confirm, writes one for each.

- **Which words** — by default every word that is not known: new words you
  have not classified yet, unknown words and the partly-known ones. Known
  words are never included, and neither are ignored ones. Change this under
  **Settings → Display → Advanced display → Words covered by "Generate
  mnemonics"**: only words you marked unknown or partial, or only words
  marked unknown.
- **Nothing is overwritten.** A word that already has a mnemonic (a line or
  a story) is left alone, so you can run it again after adding words.
- **Before it starts** you see how many words it will do, an estimate of the
  cost on OpenAI (a local Ollama model costs nothing), and what is sent: each
  word plus the sentence it first appears in. The list of words is one tap
  away.
- **While it runs** each mnemonic is saved as soon as it is made, so
  **Stop** — or closing the dialog — keeps everything already done. OpenAI
  runs a few words at once; a local model runs one at a time. After five
  failures in a row it stops and tells you to check your provider rather than
  burning through the whole note.
- **At the end** you get a summary, the words that failed with the reason
  (and a button to retry just those), and any word saved "with a caveat" — a
  mnemonic where the plugin could not get the model to follow every rule even
  after asking again, worth a quick look. Open the word and tap **Mnemonic**
  to edit or reroll it like any other.

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

The emoji rules live in the fixed *system* prompt, and the plugin appends the
character list (with each character's tone number and meaning) and the
character budget to your template, so a customised template still gets them —
and the JSON-only output contract stays intact. If you never edited the
template, 0.9.0 replaces the old default (which told the model to encode the
tones) with the new one; a template you changed is left exactly as it is.

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
