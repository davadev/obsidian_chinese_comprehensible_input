---
name: plugin-design-rules
description: Design and code rules for this Obsidian plugin that have each prevented a past regression (CSS, settings tab, editor/decorations, mobile/iOS, sync/data safety, coverage, lint). Use before editing src/, styles.css, settings, sync/mirror code, or the CodeMirror editor view.
---

# Plugin design rules

## Editor (ChineseTextFileView)
- `onOpen()` must `await tokenizer.tokenize(body)` **before** `ensureEditor(body)`, or first-paint decorations are missing.
- Edit/view boundary: `reconfigureEditor()` toggles the `editable` Compartment and dispatches `cciRedecorateEffect` in one transaction. Never destroy/recreate `EditorView` (white flash, scroll loss).
- Frontmatter is stripped at the view boundary (`splitFrontmatter()`); the editor never sees `---`.
- Display mode is read from `plugin.settings.defaultDisplayMode` at decoration build; switching calls `onChange()` → `handleToolbarChange()` → `redecorate()`.
- Colours gated by `showKnownColor` (off), `showPartialColor` (on), `showUnknownColor` (on); check these first if colours vanish.
- Trace call sequences and edge cases in the plan before any editor/state-replacement fix. iOS edit-mode keyboard gap is unfixable in place (mobile Edit routes to Obsidian's Markdown view).

## CSS (`styles.css`)
- No `!important`; no `text-decoration-line/-style/-color/-thickness/-skip-ink` longhands (one shorthand with `var()` parts).
- Inline colours via custom properties (`--cci-mark-bg`, `--cci-hl`); code writes the property, never inline `background`.
- Use Obsidian theme variables. E-ink rules live in the documented `eink:begin/end` block.
- Check: `npm run lint:css`, `npm run check:layout` (Chromium), `npm run check:webkit`. Layout bugs recur on E-ink and mobile; check both widths.

## Settings tab
- Declarative (`getSettingDefinitions()`); group under `setHeading` section; never flat-append.
- Per-device state (`lastSeenVersion`, `whatsNewHintedFor`) is listed in `NOT_IN_SETTINGS_TAB` and `FILTER_OUT.top`.
- New group needs a full Obsidian restart to appear (iPad: swipe the app away).

## Mobile / platform
- Never auto-download large data at startup (ECDICT download caused an iOS crash loop).
- Do not bump `minAppVersion` or use newer API without checking iOS install path (0.3.0 broke it).
- Node-only modules require `isDesktopOnly` (check-release enforces).
- Search/filter inputs must not rebuild the DOM per keystroke (closes the phone keyboard).

## Data safety / sync
- Never programmatically rewrite the user's target files or axes as a side effect of load/save. `mergeForSync` must be commutative and idempotent; add property tests when touching sync/mirror.
- Code reachable from persisted/synced/hand-edited data is kept and tested; legacy/unreachable code is deleted.

## Tests / lint
- 100 % coverage on all four metrics; no `v8 ignore`; never widen `exclude` (pinned by `coverageGate.test.ts`).
- `npm run check:dead-code` (knip, production mode) fails on exports/files only a test reaches. Delete the code; never add it to `ignoreIssues`. A deliberate test seam gets a `@public` JSDoc tag; `import type` of a pinned transitive goes in `ignoreDependencies` with a reason (`knip.jsonc`).
- `npm run lint` mirrors Obsidian's auto-review; 0 errors before tagging. Verify data claims against real CC-CEDICT (repo ships a 37-entry seed dict).
- AI prompt changes: run the eval harness (`scripts/model-eval.mjs`, `mnemonic-compare.mjs`) and show before/after samples; the app writes tones/pinyin, not the model.
