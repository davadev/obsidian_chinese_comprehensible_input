---
name: docs-screenshots
description: Create or refresh annotated screenshots (numbered callouts and green boxes) for README and docs. Use when a UI screen with an annotated image changed, when adding a new documented screen, or when callout numbers/boxes look misaligned or stale.
---

# Annotated screenshots

Images in `resources/screenshots/` are **rendered from the real plugin UI, not hand-captured**. Misalignment history: hardcoded pixel boxes (old `scripts/annotate-screenshots.py`), hand-captured scale drift, GitHub renumbering `<ol>` legends, inconsistent widths.

## Rules
- Use `node scripts/render-screenshots.mjs [scene …]` (scenes: toolbar, lightbulb, phrase-confirm, phrase-explain, proofread, explain-word, whatsnew). Display menu: `node scripts/render-display-menu.mjs`. Needs `$CHROME_HEADLESS_SHELL` or Playwright's browser cache.
- Callouts are placed by **CSS selector + `getBoundingClientRect()`** in `callouts()` of `scripts/screenshots/entry.ts`. Never place boxes or numbers by pixel coordinates. New annotated screen = new scene in `entry.ts`, not a new Python script. `annotate-screenshots.py` is legacy; migrate images off it when touched.
- One width and 2x scale for all images (`--force-device-scale-factor=2`); height comes from `data-content-height`.
- Legends in README/docs are **bullet lists with literal bold numbers** (`- **1** · text`), never markdown ordered lists (GitHub renumbers lists with gaps).
- Obsidian chrome is approximated (`THEME` css in the script); content inside is the plugin's.

## Steps
1. Make UI change, update fixtures in `scripts/screenshots/` if the scene data must change.
2. Re-render the affected scenes.
3. `npm run check:screenshots` (also a CI step) re-renders to a temp folder and fails on bad callout geometry or a selector that no longer matches. It cannot see wrong *content*, so still:
4. **Open every output PNG with the Read tool and inspect it**: each numbered circle sits on its target, boxes fully enclose the element, no clipped text, numbers read 1..n in the legend order, no stale element.
5. Cross-check each legend in `README.md` and `docs/*.md` (`grep -rn "<scene-name>" README.md docs`): same count, same order, same wording as the UI.
6. Commit script/fixture changes and images together in the feature PR (not a later sweep).
7. Before any tag: show the user the images and wait for approval.
