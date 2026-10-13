# Chinese Comprehensible Input — AGENTS.md

Obsidian plugin. This file holds only what applies to **every** edit. Procedures live in skills (`.claude/skills/`); long rationale in `docs/`.

## Commands

```bash
npm run dev                 # watch-mode esbuild
npm run build               # tsc --noEmit --skipLibCheck + production esbuild → main.js
npm test                    # vitest (src/tests/**/*.test.ts)
npm run test:cov            # vitest + v8 coverage; CI enforces 100 % on all four metrics
npm run lint                # local mirror of Obsidian's community-plugin auto-review (0 errors required)
npm run lint:fix            # apply autofixable rules
npm run lint:css            # stylelint on styles.css (chrome 138 target)
npm run lint:cloud-parity   # reproduce the auto-review's type-aware warnings
npm run check:layout        # real Chromium layout check (E-ink); check:webkit = WebKit
npm run check:dead-code     # knip --production: unused files/exports/deps (tests do not count as users)
npm run check:screenshots   # re-render annotated docs images to a temp dir, verify callout geometry
npm run check-release       # pre-release validator — REQUIRED before tagging
                            #   -- --tag 0.X.Y | --with-build | --with-lint | --strict
```

Always `npm run build` (type-check included) before claiming done. Tests stub `obsidian` via `src/tests/__mocks__/obsidian.ts`; UI is tested under happy-dom (`src/tests/*.dom.test.ts`). CI runs build + test + coverage + check-release + layout + webkit on every push to `main` and every PR.

## Skills: when to use which

Project skills live in `.claude/skills/<name>/SKILL.md`. Load one with the `Skill` tool (or `/<name>`) **before** starting the work it covers, then follow its checklist step by step. Do not reconstruct the steps from memory.

| Trigger (user words or situation) | Skill |
|---|---|
| About to open/merge a feature or fix PR; adding a setting, command or UI; "is it done?", "what else needs updating?" | `feature-done` |
| About to edit `src/`, `styles.css`, settings, sync/mirror or the editor view | `plugin-design-rules` |
| Annotated screenshot, numbered callouts, README/docs images, misaligned boxes | `docs-screenshots` |
| Change merged to `main` and needs testing; "release", "tag", "ship a beta", "publish" | `release-beta` |
| User **explicitly** says "promote", "go stable", "release for everyone" | `release-stable` |
| Opening/labelling an issue, "what's next?", Planning board, after a release | `triage-issue` |
| Dependabot PR, `npm install/update`, `package.json`, `.npmrc`, action pins | `dependency-update` |

Typical flow for a change: `plugin-design-rules` (while coding) → `feature-done` (before the PR; it calls `docs-screenshots` if a documented screen changed) → merge → `release-beta` → later, only when told, `release-stable`. `triage-issue` brackets the flow (issue before, board update after). When unsure which release skill applies, it is `release-beta`.

## Always-on rules

- Work on a branch (`fix/…`, `feat/…`, `release/X.Y.Z`), PR, CI green, then merge. Never routine work on `main`.
- Coverage is 100 %. Unreachable code is **deleted**, never `v8 ignore`d or excluded. Code reachable from persisted/synced/hand-edited data is kept and tested.
- No `!important` and no `text-decoration` longhands in `styles.css`.
- Group new settings under a heading; cover them in `settingsCoverage.test.ts`.
- Editor: `await tokenizer.tokenize(body)` before `ensureEditor(body)`; mode/edit switches use the compartment + `redecorate()`, never an `EditorView` rebuild. Details in `plugin-design-rules`.
- **Every fix is released** as a beta with `main.js`, `manifest.json`, `styles.css` for BRAT. Start with `npm run check-release`; never skip it.
- **Every release starts as a prerelease** (`X.Y.Z-beta.N`). Stable only on explicit user instruction. `main`'s `manifest.json` must never advertise a version with no published release; never commit a `-beta.N` version to `main`.
- Releases are tag-driven (`.github/workflows/release.yml`); never `gh release create` by hand.
- No dependency younger than 14 days; `@codemirror/state|view` pinned exact; bundled packages pinned; Actions pinned to SHAs. See `dependency-update`.
- Local `npm run lint` must be 0 errors before tagging: a lint error risks community-plugin delisting.

## Planning

Priority, strictly top-down: (1) Maintenance (bugs, security, deps, CI, data safety, performance) → next fix release `0.9.x`; (2) user feature requests; (3) planned features per `ROADMAP.md`; (4) long-term: text to speech (#67), custom local LLM (#184), Active Reading (#183), local-first/offline. Every open issue is on the Planning board https://github.com/users/davadev/projects/3 with Tier and Release (see `triage-issue`).

## Reference

- Architecture & key file index → [`docs/architecture.md`](./docs/architecture.md)
- Release policies, CI, check-release coverage, dependency rationale → [`docs/release-process.md`](./docs/release-process.md)
- Direction and planned releases → [`ROADMAP.md`](./ROADMAP.md)
- Commit convention: `0.X.Y — short description`.
