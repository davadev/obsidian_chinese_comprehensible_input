# Architecture

## Module overview

- **Entrypoint:** `src/main.ts` — `CciPlugin extends Plugin`. Registers two views (`cci-chinese-view`, `cci-stats-view`) and all commands.
- **Chinese view:** `src/view/ChineseTextFileView.ts` — owns a CodeMirror 6 `EditorView`. Strips YAML frontmatter before feeding text to CM6; prepends it on save.
- **Decorations:** `src/editor/chineseDecorations.ts` — `ViewPlugin` that builds `Decoration.replace` (RubyWidget for 2-line/3-line) or `Decoration.mark` (color-only/popup-only). Uses a shared LRU token cache (`src/tokenizer/tokenCache.ts`).
- **Tokenizer:** `src/tokenizer/TokenizerService.ts` — lattice-based (default) or `Intl.Segmenter`. Caches results in the shared module-level cache.
- **Vocabulary:** `src/vocabulary/` — `WordRecord` store with axes-based color state (`src/vocabulary/axes.ts`). Persisted via Obsidian `loadData`/`saveData`.
- **AI:** `src/ai/` — `StoryGenerator`, `AiProviderService` (OpenAI-compatible/Ollama). SSE streaming. Not initialized until user enables it in settings.
- **Settings:** `src/settings/defaults.ts` — single `DEFAULT_SETTINGS` object. Schema version tracked in `constants.ts`.
- **Script/region:** `settings.scriptVariant` decides whether the tokenizer trie indexes traditional surfaces as well as simplified (a union, not a swap). Invalidation is centralised in `CciPlugin.applyScriptSideEffects()`, called from `saveSettingsSilently()` — four paths can change the script (settings tab, view toolbar, `importSettings()`, `SettingsMirror`) and the last two replace settings wholesale, so a per-call-site fix would miss them.

## Key files

| Path | Purpose |
|------|---------|
| `src/main.ts` | Plugin lifecycle, command registration, view creation |
| `src/view/ChineseTextFileView.ts` | CM6 editor host, toolbar wiring, `onOpen`/`setViewData` |
| `src/view/ViewToolbar.ts` | Toolbar with display mode selector, marking buttons, overflow menu |
| `src/editor/chineseDecorations.ts` | `RubyWidget` + `buildChineseDecorations` ViewPlugin |
| `src/editor/wordInteractionPlugin.ts` | Click/long-press handler for popup and marking |
| `src/tokenizer/TokenizerService.ts` | Tokenizer orchestration + shared cache |
| `src/vocabulary/axes.ts` | `colorOf()` and `axesFromStatus()` — maps word status to color |
| `src/dictionary/displayForms.ts` | `displaySurface()` / `displayPinyin()` — script- and region-aware display; never converts between scripts |
| `src/dictionary/scriptDetect.ts` | One-directional Traditional detection for the auto-suggest and the story validator |
| `src/dictionary/taiwanReading.ts` | Parses CC-CEDICT's `Taiwan pr. [...]` gloss into `DictionaryEntry.pinyinTaiwan` |
| `src/settings/types.ts` | All type definitions (`DisplayMode`, `ViewMode`, `CciSettings`, `ScriptVariant`) |
| `src/settings/defaults.ts` | Default settings values |
| `src/constants.ts` | Plugin ID, view type constants, folder defaults |
| `styles.css` | All styling — no CSS-in-JS |
