---
name: feature-done
description: Definition-of-done checklist for any feature or user-visible change in this plugin. Use before opening or merging a feature/fix PR, when adding a setting, command, UI element or behaviour change, or when asked "is this done?" / "what else needs updating?". Covers tests, docs, README, architecture index, What's new entry, screenshots, board item.
---

# Feature done checklist

Run through every line before the PR is marked ready. Skip a line only when it truly does not apply, and say so in the PR.

1. **Branch + PR**: work on `fix/<slug>` or `feat/<slug>`, never on `main`.
2. **Tests**: new/changed code has tests; `npm run test:cov` stays at 100 % (no `v8 ignore`; unreachable code is deleted, see `plugin-design-rules`).
3. **Checks**: `npm run build` (includes tsc), `npm run lint` (0 errors AND 0 warnings), `npm run check:dead-code` (new code is reachable from `src/main.ts`; nothing left half-finished), `npm run lint:css` if `styles.css` changed, `npm run check:layout` if layout/E-ink changed.
4. **Settings**: new setting goes under a section heading (never appended flat) and is covered in `src/tests/settingsCoverage.test.ts` (tab control, or `NOT_IN_SETTINGS_TAB` with a reason). Remind the user a full Obsidian restart is needed to see a new group.
5. **Docs**: update the matching `docs/<page>.md` and `docs/index.md` if a page was added; `README.md` if user-visible (incl. numbered legends); `docs/architecture.md` file index if files were added/moved; `docs/faq.md` if it answers a likely question.
6. **What's new**: user-visible or must-relearn change → entry in `RELEASE_NOTES` in `src/ui/whatsNew/releaseNotes.ts` (newest first, plain `X.Y.Z`, short and benefit-led). New `figure` id → builder in `src/ui/whatsNew/figures.ts`. For a minor release also extend `docs/release-notes-X.Y.0.md`.
7. **Screenshots**: UI changed in a screen that has an annotated image → invoke the `docs-screenshots` skill.
8. **Issue + board**: issue exists, labelled, on Planning board 3 with Tier and Release (see `triage-issue`). PR body says `Closes #N`.
9. **ROADMAP.md**: update only if the plan changed.
10. Next step is `release-beta` once merged. Every fix ships as a beta with BRAT assets; do not leave a fix un-released.
