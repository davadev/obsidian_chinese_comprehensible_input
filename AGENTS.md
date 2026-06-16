# Chinese Comprehensible Input — AGENTS.md

## Commands

```bash
npm run dev                              # watch-mode esbuild
npm run build                            # tsc --noEmit --skipLibCheck + production esbuild → main.js
npm test                                 # vitest (src/tests/**/*.test.ts)
npm run check-release                    # pre-release validator — REQUIRED before tagging
npm run check-release -- --tag 0.X.Y     # also checks tag matches manifest.version
npm run check-release -- --with-build    # also runs `npm run build` + `npm test`
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
- **Every fix MUST be released with BRAT artifacts immediately.** The user tests via BRAT, so any fix must be tagged + released with `main.js`, `manifest.json`, `styles.css` — no exceptions. Do not leave a fix un-released. **Always start with `npm run check-release`; never skip it.** That script catches missing artifacts (the 0.1.56–0.1.59 iPad regression that shipped without `styles.css` would have failed it) and version skew between `manifest.json` / `package.json` / `versions.json`.

## Release Process

0. **Run `npm run check-release`. Must report `0 failed` before you tag.** Re-run after every version bump and after `npm run build` so the new `main.js` size is re-checked. If anything fails, fix it before tagging — never bypass. WARN-level findings (yellow `!`) are non-blocking but worth a look.
1. Bump `version` in `manifest.json`, `package.json`, and add entry to `versions.json`.
2. `npm run build` → produces `main.js`.
3. Commit all changes, tag `0.1.XX`.
4. `npm run check-release -- --tag 0.1.XX --with-build` — final guard that the tag matches the manifest version and that build + tests still pass. Must report `0 failed`.
5. `gh release create 0.1.XX --title "0.1.XX — description" --notes "..." main.js manifest.json styles.css`

BRAT requires the release assets: `main.js`, `styles.css`, `manifest.json`.

CI form: drop `npm run check-release -- --with-build` into a workflow step before `gh release create`. The script auto-picks the tag from `GITHUB_REF_NAME` / `GITHUB_REF`, so no extra wiring is needed.

### What `check-release` covers

Mechanical guards (FAIL blocks release):

- All five required artifacts exist: `manifest.json`, `main.js`, `versions.json`, `README.md`, `LICENSE`.
- `styles.css` present iff source declares any `cci-` class (catches the 0.1.56–0.1.59 iPad regression).
- Every JSON file parses; `manifest.json` has `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly`.
- `manifest.version` equals `package.json.version` AND is listed in `versions.json`.
- When `--tag` (or `GITHUB_REF_NAME`) is given, it equals `manifest.version`.
- `manifest.fundingUrl`, when set, points to a known financial-support service (GitHub Sponsors, Ko-fi, Buy Me a Coffee, Patreon, OpenCollective, Liberapay, PayPal, Stripe).
- No hardcoded user paths in source (`/Users/foo/...`, `/home/foo/...`, `C:\Users\foo\...`).
- If `isDesktopOnly !== true`, source must not import Node-only modules (`fs`, `path`, `child_process`, `os`, `electron`).
- `package.json` defines `build` and `test` scripts; with `--with-build`, they actually run and pass.

Heuristic guards (WARN — review but don't block):

- README.md mentions purpose / usage / settings / limitations.
- `console.log` count in `src/` ≤ 30 (over the threshold suggests ungated debug output).
- External network usage (`fetch` / `requestUrl`) is documented in README or `docs/`.
- Files that call `adapter.read/write/exists/mkdir/list/append/remove/rename` also use `normalizePath()` somewhere in the file.
- No stray distributable cruft at repo root (orphan `.ts`, `.bak`, `.DS_Store`, `main.js.map`). `*.config.{ts,js,mjs}` is allowlisted.

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
