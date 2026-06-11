# Chinese Comprehensible Input — AGENTS.md

## Commands

```bash
npm run dev          # watch-mode esbuild
npm run build        # tsc --noEmit --skipLibCheck + production esbuild → main.js
npm test             # vitest (src/tests/**/*.test.ts)
```

Build order: always run `npm run build` (includes type-check). No separate lint step.

Tests stub `obsidian` via `src/tests/__mocks__/obsidian.ts` (vitest alias in `vitest.config.ts`). No CI workflow in repo — releases are manual.

## Architecture

- **Entrypoint:** `src/main.ts` — `CciPlugin extends Plugin`. Registers two views (`cci-chinese-view`, `cci-stats-view`) and all commands.
- **Chinese view:** `src/view/ChineseTextFileView.ts` — owns a CodeMirror 6 `EditorView`. Strips YAML frontmatter before feeding text to CM6; prepends it on save.
- **Decorations:** `src/editor/chineseDecorations.ts` — `ViewPlugin` that builds `Decoration.replace` (RubyWidget for 2-line/3-line) or `Decoration.mark` (color-only/popup-only). Uses a shared LRU token cache (`src/tokenizer/tokenCache.ts`).
- **Tokenizer:** `src/tokenizer/TokenizerService.ts` — lattice-based (default) or `Intl.Segmenter`. Caches results in the shared module-level cache.
- **Vocabulary:** `src/vocabulary/` — `WordRecord` store with axes-based color state (`src/vocabulary/axes.ts`). Persisted via Obsidian `loadData`/`saveData`.
- **AI:** `src/ai/` — `StoryGenerator`, `AiProviderService` (OpenAI-compatible/Ollama). SSE streaming. Not initialized until user enables it in settings.
- **Settings:** `src/settings/defaults.ts` — single `DEFAULT_SETTINGS` object. Schema version tracked in `constants.ts`.

## Critical Constraints

- **Token cache pre-warm MUST happen before editor creation.** `onOpen()` must `await tokenizer.tokenize(body)` before `ensureEditor(body)` — otherwise decorations miss the first paint and annotations fail to render. (Fixed in 0.1.44; do not regress.)
- **Edit boundary crossing uses compartment + `redecorate()`, not a full editor rebuild.** `reconfigureEditor()` toggles the `editable` `Compartment` and dispatches `cciRedecorateEffect` in one transaction — no `EditorView` destroy/recreate. This avoids white flash and scroll loss. Works for all display modes because `emitDecoration()` already produces `Decoration.mark` (not widgets) when `activeViewMode() === "edit"`.
- **Frontmatter is stripped at the view boundary.** The editor never sees `---` blocks — handled in `splitFrontmatter()` in `ChineseTextFileView.ts`.
- **Display mode** is read from `plugin.settings.defaultDisplayMode` at decoration build time — switching mode calls `onChange()` → `handleToolbarChange()` → `redecorate()`, no editor rebuild.
- **Color visibility** is gated by `showKnownColor` (default off), `showPartialColor` (default on), `showUnknownColor` (default on) — check these if colors seem missing.

## Release Process

1. Bump `version` in `manifest.json`, `package.json`, and add entry to `versions.json`.
2. `npm run build` → produces `main.js`.
3. Commit all changes, tag `0.1.XX`.
4. `gh release create 0.1.XX --title "0.1.XX — description" --notes "..." main.js manifest.json styles.css`

BRAT requires the release assets: `main.js`, `styles.css`, `manifest.json`.

Commit convention: `0.1.XX — short description`.

## Key Files Quick Reference

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
