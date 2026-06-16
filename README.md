# Chinese Comprehensible Input — Obsidian Plugin

Turn any Chinese note in Obsidian into a learner-friendly comprehensible-input reading environment. Dictionary-aware tokenization, exposure tracking, SRS, and optional OpenAI-compatible AI story generation. Works on desktop and mobile (no Node/Electron at runtime).

## Why This Plugin Exists

Learning a language should be enjoyable. Unfortunately, many learners experience the opposite: endless flashcards, grammar drills, vocabulary lists, and a constant feeling that progress is slow and difficult.

When I started learning Chinese, the biggest breakthrough was discovering Comprehensible Input.

The core idea is simple: instead of memorizing isolated words and grammar rules, you learn by consuming content that is just slightly above your current level. You acquire the language naturally through reading and listening, much like children learn their native language.

Tools such as DuChinese have shown how powerful this approach can be. Reading stories designed for your level is far more engaging than spending hours reviewing flashcards. For a long time, comprehensible input allowed me to progress while enjoying the process.

However, as your Chinese improves, a new problem appears.

At beginner and intermediate levels, common vocabulary appears frequently enough that repeated exposure naturally reinforces it. But as you advance, you start learning increasingly rare words. These words may only appear occasionally, making it difficult to retain them through reading alone. This is the point where many learners feel forced to return to flashcards and traditional spaced repetition systems.

The problem is that flashcards often break the flow and enjoyment of language learning. Instead of reading interesting content, you end up reviewing isolated vocabulary items again.

This plugin explores a different approach.

### Spaced Repetition Through Stories

Instead of using flashcards, this plugin uses stories and meaningful content as the vehicle for spaced repetition.

With the help of AI, it becomes possible to generate or adapt content that naturally includes the vocabulary you need to review. Rather than seeing a word on a card, you encounter it inside a story, dialogue, article, or topic that interests you.

The goal is to combine the effectiveness of spaced repetition with the enjoyment of comprehensible input.

You can import Chinese texts that interest you, track your vocabulary knowledge, and receive content tailored to the words that need reinforcement. Learning becomes less about reviewing cards and more about reading Chinese every day.

### A Better Reading Experience

Many Chinese reading tools provide pinyin and translations for every word. While helpful at first, this creates another problem: learners naturally rely on the easiest information available.

If English translations are always visible, your eyes drift toward English. If pinyin is always displayed, you start reading pinyin instead of recognizing characters.

As a result, character recognition develops more slowly than it should.

This plugin takes a different approach.

Words can be marked as:

- Known
- Partially known
- Unknown

Based on that knowledge, the plugin can selectively display characters, pinyin, or translations only where they are actually needed.

Words you already know remain visible as Chinese characters only, encouraging character recognition and reading fluency. Support is shown only for vocabulary that still requires assistance.

The result is a reading experience that provides help when necessary without constantly encouraging dependence on pinyin or translations.

### Measure Real Progress

Another important aspect of language learning is feedback.

Many learners have only a vague sense of their progress. They know they have studied for months or years, but they cannot easily quantify what they have learned.

By tracking vocabulary knowledge over time, this plugin provides measurable insights into your progress:

- How many words you know
- Which words are improving
- Which words are being forgotten
- Whether your vocabulary is growing over time

Seeing tangible progress can be highly motivating, especially during the long journey of learning Chinese. The goal is not only to make learning more effective, but also to help learners stay motivated by making their improvement visible.

### The Vision

The long-term vision of this project is simple:

Make Chinese learning feel more like reading and less like studying.

By combining comprehensible input, AI-generated content, vocabulary tracking, and story-based spaced repetition, this plugin aims to make language acquisition both effective and enjoyable—even beyond the intermediate stages where traditional comprehensible-input tools begin to struggle.

See `PR.md` for the full product spec and `NOTICE.md` for license notes (CC-CEDICT, HSK).

## Documentation

Detailed guides live in [`docs/`](./docs/index.md). Each settings section also links to the relevant page from inside Obsidian. Highlights:

- [FAQ](./docs/faq.md) — top issues and where the fix is
- [OpenAI setup, privacy, and cost](./docs/openai-setup.md)
- [Ollama tips: model choice and getting good output](./docs/ollama-tips.md)
- [Story generation, end to end](./docs/story-generation.md)
- [Display modes & colors](./docs/display-modes.md)
- [Word states (new / partial / known / unknown / ignored)](./docs/word-states.md)
- [Exposure tracking](./docs/exposure.md)
- [Spaced repetition](./docs/srs.md)
- [Vault-mirror sync (for users who don't sync .obsidian/)](./docs/sync-mirror.md)
- [Conflict resolution between devices](./docs/conflicts.md)

### Limitations

- Mobile + Ollama needs a reachable LAN/Tailscale host (`localhost` from the phone points at the phone). See [Ollama tips](./docs/ollama-tips.md#mobile-tailscale-tips).
- OpenAI mode sends prompt + target words to OpenAI's servers — fine for most users, see [the privacy section](./docs/openai-setup.md#2-privacy--your-text-leaves-obsidian).
- The bundled seed dictionary is tiny; real use needs CC-CEDICT (see Data below).

## Dev

```bash
npm install
npm run dev        # watch build
npm run build      # type-check + production bundle
npm test           # vitest
```

To install the dev build into a vault:
1. Build: `npm run build`.
2. Copy `manifest.json`, `main.js`, `styles.css` into `<vault>/.obsidian/plugins/chinese-comprehensible-input/`.
3. Enable in Obsidian → Community plugins.

## Data

A tiny seed dictionary is bundled for development. For real use, drop a CC-CEDICT shard at `<vault>/.cci-dictionary.json` (array of `{simplified, traditional, pinyin, definitions, hsk?}`). See `NOTICE.md` for license notes.
