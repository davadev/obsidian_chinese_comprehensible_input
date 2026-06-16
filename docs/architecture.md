# Architecture

## Module overview

- **Entrypoint:** `src/main.ts` — `CciPlugin extends Plugin`. Registers two views (`cci-chinese-view`, `cci-stats-view`) and all commands.
- **Chinese view:** `src/view/ChineseTextFileView.ts` — owns a CodeMirror 6 `EditorView`. Strips YAML frontmatter before feeding text to CM6; prepends it on save.
- **Decorations:** `src/editor/chineseDecorations.ts` — `ViewPlugin` that builds `Decoration.replace` (RubyWidget for 2-line/3-line) or `Decoration.mark` (color-only/popup-only). Uses a shared LRU token cache (`src/tokenizer/tokenCache.ts`).
- **Tokenizer:** `src/tokenizer/TokenizerService.ts` — lattice-based (default) or `Intl.Segmenter`. Caches results in the shared module-level cache.
- **Vocabulary:** `src/vocabulary/` — `WordRecord` store with axes-based color state (`src/vocabulary/axes.ts`). Persisted via Obsidian `loadData`/`saveData`.
- **AI:** `src/ai/` — `StoryGenerator`, `AiProviderService` (OpenAI-compatible/Ollama). SSE streaming. Not initialized until user enables it in settings.
- **Settings:** `src/settings/defaults.ts` — single `DEFAULT_SETTINGS` object. Schema version tracked in `constants.ts`.

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
| `src/settings/types.ts` | All type definitions (`DisplayMode`, `ViewMode`, `CciSettings`) |
| `src/settings/defaults.ts` | Default settings values |
| `src/constants.ts` | Plugin ID, view type constants, folder defaults |
| `styles.css` | All styling — no CSS-in-JS |
