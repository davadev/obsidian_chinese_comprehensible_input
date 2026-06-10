# Chinese Comprehensible Input — Obsidian Plugin

Turn any Chinese note in Obsidian into a learner-friendly comprehensible-input reading environment. Dictionary-aware tokenization, exposure tracking, SRS, and optional OpenAI-compatible AI story generation. Works on desktop and mobile (no Node/Electron at runtime).

See `PR.md` for the full product spec and `NOTICE.md` for license notes (CC-CEDICT, HSK).

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
