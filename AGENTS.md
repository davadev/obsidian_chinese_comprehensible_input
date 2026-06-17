# Chinese Comprehensible Input — AGENTS.md

## Commands

```bash
npm run dev                              # watch-mode esbuild
npm run build                            # tsc --noEmit --skipLibCheck + production esbuild → main.js
npm test                                 # vitest (src/tests/**/*.test.ts)
npm run test:cov                         # vitest run + v8 coverage report (terminal + coverage/index.html + lcov)
npm run test:cov:open                    # same, then opens the HTML report in your browser
npm run test:watch                       # vitest watch mode
npm run lint                             # local mirror of Obsidian's community-plugin auto-review
npm run lint:fix                         # apply autofixable rules in place
npm run check-release                    # pre-release validator — REQUIRED before tagging
npm run check-release -- --tag 0.X.Y     # also checks tag matches manifest.version
npm run check-release -- --with-build    # also runs `npm run build` + `npm test` + `npm run lint`
npm run check-release -- --with-lint     # runs the Obsidian-parity lint only (no build/test)
```

Build order: always run `npm run build` (includes type-check). Always run `npm run lint` before tagging — its config (`eslint.config.mjs`) mirrors the Obsidian community-plugin auto-review so 0 errors locally means the cloud review will also pass.

Tests stub `obsidian` via `src/tests/__mocks__/obsidian.ts` (vitest alias in `vitest.config.ts`). GitHub Actions runs build + test + coverage + `check-release` on every push to `main` and every PR. Releases are still intentionally manual so BRAT assets and notes are reviewed before publishing.

### Coverage targets

`npm run test:cov` writes `coverage/index.html` (browsable drill-down), `coverage/lcov.info` (CI / editor integrations), and prints the summary table to the terminal. `vitest.config.ts` now tracks the unit-testable surface of the repo: pure logic modules stay inside coverage and the Obsidian runtime / DOM-heavy shells stay out until we add a dedicated jsdom + Obsidian harness. CI enforces the current thresholds, so raise them only after the new floor is proven stable locally.

## Critical Constraints

- **Token cache pre-warm MUST happen before editor creation.** `onOpen()` must `await tokenizer.tokenize(body)` before `ensureEditor(body)` — otherwise decorations miss the first paint and annotations fail to render. (Fixed in 0.1.44; do not regress.)
- **Edit boundary crossing uses compartment + `redecorate()`, not a full editor rebuild.** `reconfigureEditor()` toggles the `editable` `Compartment` and dispatches `cciRedecorateEffect` in one transaction — no `EditorView` destroy/recreate. This avoids white flash and scroll loss. Works for all display modes because `emitDecoration()` already produces `Decoration.mark` (not widgets) when `activeViewMode() === "edit"`.
- **Frontmatter is stripped at the view boundary.** The editor never sees `---` blocks — handled in `splitFrontmatter()` in `ChineseTextFileView.ts`.
- **Display mode** is read from `plugin.settings.defaultDisplayMode` at decoration build time — switching mode calls `onChange()` → `handleToolbarChange()` → `redecorate()`, no editor rebuild.
- **Color visibility** is gated by `showKnownColor` (default off), `showPartialColor` (default on), `showUnknownColor` (default on) — check these if colors seem missing.
- **Every fix MUST be released with BRAT artifacts immediately.** The user tests via BRAT, so any fix must be tagged + released with `main.js`, `manifest.json`, `styles.css` — no exceptions. Do not leave a fix un-released. **Always start with `npm run check-release`; never skip it.** That script catches missing artifacts (the 0.1.56–0.1.59 iPad regression that shipped without `styles.css` would have failed it) and version skew between `manifest.json` / `package.json` / `versions.json`.
- **Every release starts as prerelease — never assume stable unless the user explicitly says so.** The `gh release create` command must always use `--prerelease`. Only promote to stable (`gh release edit 0.X.Y --prerelease=false`) when the user explicitly instructs you to do so. The default assumption is always prerelease; stable is opt-in after manual verification.

## Release Process

The release pipeline is now **tag-driven** via `.github/workflows/release.yml`. Pushing a SemVer-shaped tag (`0.X.Y` for stable, `0.X.Y-rc.1` / `0.X.Y-beta.2` for prerelease) triggers an Ubuntu runner that re-runs `npm ci` → `npm run lint` → `npm run build` → `npm test` → `npm run check-release -- --tag $TAG --with-build`, then creates the GitHub Release atomically with `main.js`, `manifest.json`, `styles.css` attached. **A single lint Error aborts the pipeline — no release is created.** The dev never types `gh release create` by hand.

0. **Run `npm run check-release -- --with-build` locally first.** Same gate the workflow uses; faster feedback. Must report `0 failed` AND the embedded Obsidian-parity lint step must report `0 errors`. WARN-level findings (yellow `!`) are non-blocking but worth a look. The lint step matches the cloud auto-review's rule set (`eslint-plugin-obsidianmd` + the relevant `@typescript-eslint` type-aware rules); see `eslint.config.mjs`. **A release with even one local lint Error will fail the Obsidian community-plugin auto-review and risk delisting the plugin.**
1. Bump `version` in `manifest.json`, `package.json`, and add entry to `versions.json`.
2. `npm run build` → produces `main.js`.
3. `npm test` and `npm run test:cov` locally if you changed code, test config, or release artifacts.
4. Commit all changes, open the PR, merge after CI green.
5. **Push the SemVer tag** from `main`: `git tag 0.X.Y && git push origin 0.X.Y` (or `0.X.Y-rc.1` for a prerelease). The `Release` workflow takes it from there — watch the run on GitHub Actions. If lint / build / tests / check-release fail, the release is never created; delete the tag (`git push origin :0.X.Y`), fix, retag.
6. **No manual `gh release create` step.** The workflow runs `gh release create … --latest` for bare SemVer tags and `gh release create … --prerelease` for suffixed tags. Release notes are auto-generated from PRs / commits since the previous tag — edit them in the GitHub UI after the fact if you want richer text.
7. **Promotion to stable for already-prereleased tags** (legacy path, rare): `gh release edit 0.X.Y --prerelease=false --latest`.

BRAT requires the release assets: `main.js`, `styles.css`, `manifest.json`.

**Beta-first workflow.** Every release starts as a prerelease.  
- BRAT testers who added the plugin via **Add Beta Plugin** can install and test immediately.  
- Regular BRAT users do **not** auto-update to prereleases — their plugin stays on the last promoted stable release.  
- After you manually verify the release works, promote it to stable with `gh release edit` above.  
  Only then does it become the "latest" release that BRAT auto-update follows.

### Release Checklist

- Create a dedicated branch for the fix / feature / release prep
- `npm run check-release`
- `npm run lint` — must report `0 errors` (warnings non-blocking)
- Bump `manifest.json`, `package.json`, `versions.json`
- `npm run build`
- `npm test`
- `npm run test:cov`
- Confirm `main.js`, `manifest.json`, `styles.css` are present and updated
- Commit with `0.X.Y — short description`
- Open / update the PR and get it reviewed before merge
- Merge to `main`
- `git tag 0.X.Y` (stable) **or** `git tag 0.X.Y-rc.1` (prerelease)
- `git push origin 0.X.Y` — the `Release` workflow re-runs lint / build / test / check-release on a clean Ubuntu runner, then creates the GitHub Release with `main.js`, `manifest.json`, `styles.css` attached. Watch the run on the Actions tab.

If the workflow fails: delete the tag (`git push origin :0.X.Y && git tag -d 0.X.Y`), fix the issue on a branch, merge, retag, push. No partial release is left behind because the publish step runs last.

Commit convention: `0.X.Y — short description`.

## Reference

- Architecture & key file index → [`docs/architecture.md`](./docs/architecture.md)
- Release policies (CI expectations, branch/PR policy, check-release coverage) → [`docs/release-process.md`](./docs/release-process.md)
