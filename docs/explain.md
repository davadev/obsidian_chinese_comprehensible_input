# Explain

**Explain** writes a thorough usage note for one word: not just the translation (the dictionary card and **Enhance**
already do that), but *when you need it, how to use it, how learners get it wrong, and how it is built*. It shows the
note in a dialog first (with a progress bar while it is written, usually 20 to 40 seconds); nothing is saved to your vault until you press **Save**.

It appears on the word card as **Explain**, next to Mnemonic and Edit, whenever AI is switched on. It works with or
without a sentence; if you opened the card from a sentence, that sentence is sent too so the model can pick the sense
you met (it still covers the other senses).

## What is in a note

Every note has the same layout, so it is easy to scan on a phone:

| Section | What it gives you |
|---|---|
| **At a glance** | The core meaning, part of speech, HSK level and register (neutral, spoken, formal…), then a short summary of why you need the word. |
| **When you need this word** | Two to four concrete situations ("To say that…"). |
| **Meanings** | Every sense, most common first, each with a short example. |
| **How it behaves in a sentence** | The sentence pattern, the measure word for a noun, and notes on position, negation, objects and complements. For particles and other function words this is written as a grammar point. |
| **Common combinations** | Frequent collocations and set phrases, with pinyin. |
| **Examples** | Five to eight natural sentences in different contexts and registers (daily life, work, spoken, formal), each with pinyin and English. |
| **Watch out** | Pitfalls that really trip learners up: a rule in one line, the wrong form when the model is sure of one, and the right form. Each is built from something the note already says (a confusion with a similar word, the sentence pattern, a habit carried over from English, or a register slip), and there may be none. |
| **Similar words** | Near-synonyms and easily confused words, and when to choose which. |
| **The characters** | For each character: its meaning, radical, how it is built from parts (which part gives the sound and which the meaning), and where it comes from. |
| **Notes** | Mainland vs Taiwan differences, politeness, frequency, related idioms. |

Example sentences are ordinary Chinese paragraphs in the note, so the plugin's reader annotates them like any other note
(colours, taps, popups).

## How reliable is it?

It is written by the AI model, so treat it like a good tutor's notes, not like a dictionary. The plugin does not give the
model free rein:

- **The facts come from your dictionary.** The pinyin, the HSK level, every dictionary reading and its meanings, and a
  line per character (using the reading *this* word has) are put in the request as ground truth.
- **The plugin checks what it can see.** Every example must contain the word, each mistake needs the wrong sentence, the
  correction and the reason, rows may not be half-filled, and there must be one entry per character. If a rule is
  broken the model is asked once more with the specific problem; if it is still wrong the dialog tells you what is off
  instead of hiding it.
- **It cannot check that a rule is true.** A note says so on its face: *AI-generated; check anything important against
  a dictionary or a teacher.*
- **Pitfalls are the weakest part.** Writing a realistic wrong sentence needs knowledge of real learner errors, which a
  model does not reliably have, so the section asks for short rules tied to the rest of the note, shows a wrong form
  only when the model is sure of it, and is left out rather than padded.
- **Etymology is marked when it is shaky.** Each character's origin is labelled *established* or *a popular or uncertain
  account*; the model is told to leave it out rather than invent one.

## Saving, finding and regenerating

- **Save as note** writes `<word> <pinyin>.md` (so 行 xíng and 行 háng never collide) into **Settings → Explanations →
  Folder** (default `Chinese Learning/Generated/Explanations`), and opens it in the reader if that setting is on.
- The note carries a small header (`cci-explain`, `cci-word`, the model, the prompt version, the date). The plugin finds
  a word's note through that header, so renaming or moving the note does not break it.
- If a word already has a note, Explain says so first and offers **Open it**; **Write a new version** generates again
  and saves beside the old one (`… 2.md`). **Nothing you wrote or edited is ever overwritten.**
- **Regenerate** in the dialog throws the preview away and writes a new one. **Copy** puts the Markdown on the clipboard.

## What is sent to the AI

One request (plus at most one follow-up when a rule was broken): the word, its pinyin and traditional form, its HSK
level, its dictionary readings and definitions, one line per character (its pinyin and a short dictionary meaning), and
the sentence you opened the card from, if any. Nothing else from your vault is sent. With OpenAI this goes to OpenAI's
servers, with Ollama to your own; see [OpenAI setup, privacy, and cost](./openai-setup.md#2-privacy--your-text-leaves-obsidian).
A note costs a fraction of a cent to a few cents on OpenAI, depending on the model.

## Settings

**Settings → Explanations** (a new group appears after a full restart of Obsidian):

- **Folder** — where saved notes go.
- **Open the note after saving** — in the reader.
- **Pinyin under example sentences** — the pinyin line under each example and combination.
