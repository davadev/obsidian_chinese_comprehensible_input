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

## Explaining or proof reading a phrase (the lightbulb)

The lightbulb button in the reader's toolbar (next to the highlighter) works on a stretch of text instead of one word.
Tap it, tap the **first word** of the text, then the **last word**. A dropdown in the banner chooses what happens:
**Explain** or **Proof read**. The second tap opens a dialog that shows the text, its length and the likely cost, and
nothing is sent until you press the button there. **Exit** in the banner leaves the mode. With no AI set up, the button
tells you how to set it up instead of starting the mode.

The selection is limited (default 150 characters, about two or three sentences; **Settings → Explain & proof read → Longest
text**): more costs more and is explained worse. A longer selection is refused with the count, and you can simply tap an
earlier last word.

### Explain

- **One word** selected: you get the normal word note described above.
- **Several words or sentences**: a quick, cheap check first asks whether the text is generally correct (it is lenient:
  spoken or informal Chinese is fine). Then comes the explanation, which is about the **big picture**, not a dictionary
  entry per word: a natural translation, what the text expresses and when you would say it, its sentence skeleton, a
  **word by word** list that gives every word's *grammatical job in this sentence*, the grammar points that make it work,
  and notes. The plugin checks that the list covers the whole selection, in order (nothing left out, nothing added) and
  asks once more if it does not.
- A **typo** is mentioned briefly in the note, and the words are explained as written.
- If the check says the text is **wrong** (so broken that an explanation would teach something false), the dialog says why and
  offers **Proof read this instead**; it does not explain wrong grammar.
- Like the word note: preview first, then **Save as note** (same folder; `cci-explain-phrase` in its header), **Copy**
  or **Regenerate**.

### Proof read

It looks for real mistakes only (a wrong or missing character, a grammar slip, a wrong word or measure word, unnatural
word order, punctuation), not style. Each correction shows the wrong part, the fix, and a one-line reason. **Apply**
replaces that text **in your note** with one tap, **Apply all** does every one; **Copy corrected text** copies the whole
selection with the fixes. The corrected text is worked out by the plugin from the listed fixes, never taken from the model,
and a fix is written into the note only if the text there is still exactly what was shown (if the note changed while the
dialog was open, nothing is replaced and you are told to select again). Text that has formatting in the note (bold,
highlights, links) can still be applied when the wrong part itself is plain text; if the formatting runs through it, copy
the corrected text instead.

### Cost

Explaining a phrase makes two requests and proof reading one. The dialog shows an estimate before you start (OpenAI only;
a local model costs nothing) and the real cost afterwards, from the token usage the API reports. The word note shows its
real cost too.

## Saving, finding and regenerating

- **Save as note** writes `<word> <pinyin>.md` (so 行 xíng and 行 háng never collide) into **Settings → Explain & proof read →
  Folder** (default `Chinese Learning/Generated/Explanations`), and opens it in the reader if that setting is on.
- The note carries a small header (`cci-explain`, `cci-word`, the model, the prompt version, the date). The plugin finds
  a word's note through that header, so renaming or moving the note does not break it.
- If a word already has a note, Explain says so first and offers **Open it**; **Write a new version** generates again
  and saves beside the old one (`… 2.md`). **Nothing you wrote or edited is ever overwritten.**
- **Regenerate** in the dialog throws the preview away and writes a new one. **Copy** puts the Markdown on the clipboard.

## What is sent to the AI

**A word:** one request (plus at most one follow-up when a rule was broken): the word, its pinyin and traditional form, its HSK
level, its dictionary readings and definitions, one line per character (its pinyin and a short dictionary meaning), and
the sentence you opened the card from, if any. Nothing else from your vault is sent. With OpenAI this goes to OpenAI's
servers, with Ollama to your own; see [OpenAI setup, privacy, and cost](./openai-setup.md#2-privacy--your-text-leaves-obsidian).
A note costs a fraction of a cent to a few cents on OpenAI, depending on the model.

**A phrase or proof read** (the lightbulb): only the **selected text** is sent (with the note's formatting taken off), in two
requests for Explain (the quick check, then the explanation) and one for Proof read, plus at most one follow-up each when a
rule was broken. Nothing else from the note is sent, and the confirm dialog shows exactly what will go.

## Settings

**Settings → Explain & proof read** (a new group appears after a full restart of Obsidian):

- **Folder** — where saved notes go.
- **Open the note after saving** — in the reader.
- **Longest text to explain or proof read** — the limit for the lightbulb tool.
- **Advanced explain ▾ → Pinyin under example sentences** — the pinyin line under each example and combination.

## Telling the AI how you like things explained

**Settings → AI provider → AI prompts ▾** has one box per feature (Explain a word, Explain a phrase or sentence,
Proof read). Whatever you write there is added to the end of the built-in prompt with every request, so it is the place
for "explain in Czech", "I am at HSK 3, keep it simple" or "I care about grammar more than vocabulary". The answer format
is still checked by the plugin, so an instruction cannot break the saved note. These words are sent to the AI provider
along with the text.

For full control, **Replace a whole prompt ▾** (inside the same page) replaces a built-in prompt with your own; **start
from the built-in prompt** copies ours into the box so you can edit it, and **go back to the built-in prompt** empties
it again. A replacement prompt must still ask for the JSON the plugin expects: if it does not, the plugin tries one
repair and then shows what is wrong instead of saving a broken note. The built-in prompts were tested against real
answers; yours will not be.
