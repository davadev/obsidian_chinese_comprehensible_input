# Story generation, end to end

The plugin's headline feature: turn a list of vocabulary you need to
review into a short, readable Chinese story you can actually enjoy.
This page explains what happens behind the scenes so you understand
which settings to touch when results aren't what you want.

## What it does

<img src="../resources/screenshots/mobile-smart-story.png" alt="Smart story generation panel" width="320">

*Flashcards → **Smart story**: the panel shows how many words are due today,
the target HSK level (auto), length, the known-coverage threshold, and the
repair-iteration cap, then **Generate story**.*

When you click **Generate story** in the Flashcards tab (or wait for
the daily auto-generator), the plugin:

1. **Picks target words.** By default, the next 12 words your spaced
   repetition system says are due. You can override count, style, and
   target HSK level in the modal.
2. **Picks a target HSK level.** "Auto" looks at your due-words list and
   chooses a level that matches it. Or pick a level by hand.
3. **Optionally samples your known words.** If **Send known words** is
   on, a percentage of your known-word inventory rides along so the
   model can use them as filler vocabulary.
4. **Sends a prompt to your AI provider** — OpenAI or Ollama, depending
   on which you've selected. Includes the system prompt (graded
   Chinese instructions), target words with pinyin + meaning, and the
   sample.
5. **Validates the draft.** A pure-JS validator scans the returned
   Chinese for each required target word verbatim. If any are missing,
   it kicks off the repair loop.
6. **Repair loop.** Up to **Max repair iterations** times, the plugin
   re-sends the draft + the missing-word list, asking the model to
   rewrite. Best-of-N: the version with the fewest missing words wins.
7. **Writes a note** in your **Generated stories folder** with the
   final Chinese text plus YAML frontmatter listing the target words,
   model, and validation score.

## Default folder + filename

The story note lands in `Chinese Learning/Generated/` by default. File
names are date-stamped and include the first target word as a hint:
`2026-06-16 — 学习.md`.

You can change the folder in Story settings.

## Daily auto-generation

Turn on **Auto-generate a daily story** and set a local time (e.g.
08:00). The plugin checks once on launch and then every 5 minutes; the
first time the configured time has passed today and the AI is reachable,
it generates one story and marks today as done.

If the AI fails (network blip, model down), it retries every 30 minutes.
Failed days don't carry over — at midnight the retry state is wiped.

## What gets sent to the AI

For each request:

- **System prompt** (fixed): instructions for graded Chinese, JSON
  output shape, no English explanations inside the Chinese.
- **Target words**: each as `word (pinyin) — English definition`.
- **Optionally**, the known-words sample.
- **Length hint**: ~`Default length chars` characters of Chinese.

On a repair pass, also:

- The previous draft.
- The list of target words still missing.
- Words flagged "too hard" by the validator (above the target HSK).

Nothing else from your vault gets sent — no other notes, no other
vocabulary entries, no settings.

## What "good enough" means

The validator marks a story acceptable when:

- Every target word appears verbatim in `textChinese`.
- The proportion of characters that map to known or below-target-HSK
  words exceeds **Known-coverage threshold** (default 80 %).

If both pass, the repair loop exits. Otherwise it keeps trying up to the
iteration cap.

## Generated YAML frontmatter

Each generated note opens with frontmatter you can read:

```yaml
---
chinese_learning_generated: true
generated_at: 2026-06-16T08:00:12Z
provider: openai
model: gpt-5.4-mini
target_hsk: 4
target_words:
  - 学习
  - 努力
  - 进步
validation_score: 0.91
---
```

Useful for spot-checking which model produced which story and
how cleanly it matched the targets.

## Knob recap

| Setting | What it does | When to touch |
|---------|--------------|---------------|
| **Default due count** | How many target words per story | Lower (8) for tighter stories, raise (16+) for marathon sessions |
| **Default length chars** | Roughly how long the story is | 200 for snack-size; 600+ for serious reading |
| **Default style** | story / article / dialogue | Personal taste |
| **Known-coverage threshold** | Quality bar for filler vocabulary | Lower to 70 % if your model can't hit 80 % |
| **Include glossary** | Add a learner-side glossary block | On is helpful for review |
| **Send known words** + **%** | Feed your vocabulary to the model | On + 100 % for beginners ([why](./ollama-tips.md#send-known-words-helps-beginners-enormously)) |
| **Auto-generate a daily story** | Background daily run | Set and forget |
| **Auto-generate time** | Local time the daily run targets | Pick a time you can actually read |

## When things go wrong

- **Story drops target words** → bump **Max repair iterations**; for
  small Ollama models, also switch to a stronger model. See
  [Ollama tips](./ollama-tips.md).
- **Story too hard** → see [FAQ](./faq.md#the-generated-chinese-is-too-hard-for-me).
- **Story never finishes** → see [FAQ](./faq.md#story-generation-hangs-or-times-out).

## See also

- [OpenAI setup](./openai-setup.md)
- [Ollama tips](./ollama-tips.md)
- [Spaced repetition](./srs.md) — drives which words count as "due."
- [FAQ](./faq.md)
