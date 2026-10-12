# 0.9.0 release notes (draft for the GitHub release)

Paste everything between the rules into the GitHub release when 0.9.0 is promoted to stable (edit the auto-generated notes).
The in-app "What's new" popup is `src/ui/whatsNew/releaseNotes.ts`; this text is the longer, public version.

---

## Chinese Comprehensible Input 0.9.0: help while you read

0.9.0 is about the moments when reading stops: a word you can't place, a sentence you can't parse, a tone you keep forgetting, a line of Chinese you wrote and aren't sure of. Everything new that uses AI is optional; the plugin still works fully without it.

### New

- **Explain a word.** Tap a word → **Explain**: when you need it, every meaning, how it behaves in a sentence, examples across contexts, the mistakes learners make (a rule plus the correct form), similar words and how each character is built. Preview first, then save it as a note or copy it. The facts (pinyin, HSK, dictionary readings) come from your dictionary; the plugin checks what it can and says so when something is off. ([guide](docs/explain.md))
- **Explain a sentence, or proof read your own Chinese.** The new **lightbulb** button: tap the first and last word, then pick **Explain** (translation, structure, the job of every word, grammar points) or **Proof read** (real mistakes only, the simplest fix, **Apply** it into your note in one tap, never overwriting text that changed meanwhile). You see the length limit and the likely cost before anything is sent.
- **Mnemonics you can trust.** The plugin now works out the tone numbers and the word's own pinyin itself; the model only draws, one picture of the meaning per character with its tone digit right after it (`🗺️²📖¹🏛️³`). Names are badged. **⋯ → Mnemonics for this note…** fills in, regenerates or removes the mnemonics of a whole note, with the real cost shown afterwards. ([guide](docs/mnemonics.md))
- **One Status / HSK button.** The two toolbar pills are a single fixed-width button that shows the colouring in use; tap it to flip. That made room for the lightbulb.
- **You are in control of the AI.** Every AI answer shows what it cost (OpenAI). **Settings → AI provider → AI prompts**: tell the AI how you like things explained (language, level, focus) per feature, or replace a whole prompt. The AI settings are tidier: essentials up front, prompts and technical options on their own pages. Every AI action points you to setup when no key or server is configured.
- **A "What's new" popup**, once, after a real restart, with a Don't show again button (and a switch in Settings → About).

### Changed

- The mnemonic line is now emoji only, with superscript tone digits. Mnemonics you already have are untouched. A customised mnemonic prompt template is kept; the unmodified old default is replaced by the new one.
- Settings moved: *Explanations* is now **Explain & proof read**; the *Words covered by "Mnemonics for this note"* setting moved from Display to **AI provider → AI prompts → Mnemonics**; Diagnostics and the pinyin-rewrite switch are on **Advanced AI**.

### Fixed

- Banner buttons (Explain ▾ / Exit) no longer wrap on narrow screens.

### Upgrading

Restart Obsidian after updating (new settings groups register at start). Your vocabulary, settings and mnemonics carry over unchanged. If you use OpenAI, nothing else is needed; the plugin shows a cost estimate before each lightbulb request and the real cost afterwards.

### Behind the scenes

Mnemonic and Explain output is structured JSON validated against facts the plugin already has, with one repair attempt; prompts were compared against the old harness on real model output before shipping (tooling in `scripts/`, run only through GitHub workflows). Annotated screenshots in the docs are now rendered from the real UI (`node scripts/render-screenshots.mjs`).

**Closes:** #185, #186, #210, #230. (#192 is a maintenance item whose main complaint was already fixed in 0.8.0; close it as completed or leave it for a later fix release.)

---
