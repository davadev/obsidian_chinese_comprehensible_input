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
node scripts/stamp-prerelease.mjs 0.X.Y-beta.N   # CI-only: stamps a prerelease version into the
                                                 # working tree. Never commit its output.
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
- **NEVER let `main`'s `manifest.json` advertise a version that has no published release.** Obsidian reads the default-branch `manifest.json` to decide which version to offer Community Plugin users, then downloads assets from the release **tagged identically to it** — so a `main` that says `0.7.0` while only `0.7.0-beta.1` exists breaks every install and update. Two rules follow, both enforced by `check-release`: (a) never commit a `X.Y.Z-beta.N` version to `main` (the no-tag run fails on any prerelease suffix); (b) don't bump `main` to the next stable version until that stable release is actually published.
- **Iterate with `X.Y.Z-beta.N` prereleases; the manifest on `main` does NOT move.** While building a feature, `main` keeps advertising the **current stable** version. Each round: branch → PR → CI green → merge to `main` → `git tag X.Y.Z-beta.N && git push`. The `Release` workflow stamps the prerelease version into the working tree (`scripts/stamp-prerelease.mjs`, never committed), builds, validates, and publishes a **prerelease** whose assets carry `X.Y.Z-beta.N`. BRAT reads `manifest.json` from the **release assets** and picks the highest semver including prereleases, so testers get the beta; Obsidian keeps serving the old stable to everyone else. GitHub's `--prerelease` flag alone is *not* the protection — Obsidian never reads it; the default-branch manifest is. Promote to stable only on explicit go-ahead, and **publish the stable release before `main` starts advertising it** (tag the release branch, verify the release, then merge). Full procedure with commands: [`docs/release-process.md`](./docs/release-process.md#prerelease--stable-workflow).

## Release Process

The release pipeline is now **tag-driven** via `.github/workflows/release.yml`. Pushing a SemVer-shaped tag (`0.X.Y` for stable, `0.X.Y-rc.1` / `0.X.Y-beta.2` for prerelease) triggers an Ubuntu runner that re-runs `npm ci` → `npm run lint` → `npm run build` → `npm test` → `npm run check-release -- --tag $TAG --with-build`, then creates the GitHub Release atomically with `main.js`, `manifest.json`, `styles.css` attached. **A single lint Error aborts the pipeline — no release is created.** The dev never types `gh release create` by hand.

0. **Run `npm run check-release -- --with-build` locally first.** Same gate the workflow uses; faster feedback. Must report `0 failed` AND the embedded Obsidian-parity lint step must report `0 errors`. WARN-level findings (yellow `!`) are non-blocking but worth a look. The lint step matches the cloud auto-review's rule set (`eslint-plugin-obsidianmd` + the relevant `@typescript-eslint` type-aware rules); see `eslint.config.mjs`. **A release with even one local lint Error will fail the Obsidian community-plugin auto-review and risk delisting the plugin.**
1. **Version files.** For a **prerelease**, change nothing — `manifest.json` / `package.json` / `versions.json` stay on the current stable version, and CI stamps the beta version into the working tree only. For the **stable promotion**, bump `manifest.json`, `package.json` and `versions.json` to `X.Y.Z` on a `release/X.Y.Z` branch and refresh `package-lock.json` (`npm install --package-lock-only`) or CI's version-skew check fails.
2. `npm run build` → produces `main.js`.
3. `npm test` and `npm run test:cov` locally if you changed code, test config, or release artifacts.
4. Commit all changes, open the PR, merge after CI green.
5. **Push the tag.** Prerelease: merge to `main`, then `git tag X.Y.Z-beta.N && git push origin X.Y.Z-beta.N`. Stable: tag the **release branch head** (`git tag X.Y.Z && git push origin X.Y.Z`), let the workflow publish, verify the release and its three assets, and only then merge the PR with `--merge` so `main` starts advertising a version that already exists. If lint / build / tests / check-release fail, the release is never created; delete the tag (`git push origin :<tag> && git tag -d <tag>`), fix, retag — `main` was never touched.
6. **No manual `gh release create` step.** The workflow runs `gh release create … --latest` for bare SemVer tags and `gh release create … --prerelease` for suffixed tags. Release notes are auto-generated from PRs / commits since the previous tag — edit them in the GitHub UI after the fact if you want richer text.
7. **Never** create the bare `X.Y.Z` tag early and merely flag it as a GitHub prerelease. Obsidian matches on the tag and ignores that flag, so the half-baked build becomes the advertised release.

BRAT requires the release assets: `main.js`, `styles.css`, `manifest.json`.

**Beta-first workflow.** Every release starts as a prerelease.
- BRAT testers who added the plugin via **Add Beta Plugin** install it immediately: BRAT reads `manifest.json` from the **release assets** and picks the highest semver *including* prereleases. It is explicitly independent of the version in the repository root.
- Community Plugin users are unaffected, because `main`'s `manifest.json` still advertises the previous stable version and its release still exists.
- Promotion to stable is a **new bare tag**, not a flag flip on the prerelease.

### Release Checklist

**Prerelease `X.Y.Z-beta.N`** — nothing on `main` changes:
- Create a dedicated branch for the fix / feature; PR; CI green; merge to `main`
- `npm run check-release -- --with-build` locally (no `--tag`) — `0 failed`, lint `0 errors`
- **Do not touch** `manifest.json` / `package.json` / `versions.json`
- `git tag X.Y.Z-beta.N && git push origin X.Y.Z-beta.N`
- The workflow stamps the beta version into the working tree, re-runs lint / build / test / check-release, validates the three artifacts, and publishes a **prerelease**
- Verify `main`'s manifest still shows the old stable version and its release still resolves

**Stable promotion `X.Y.Z`** — only on explicit go-ahead, and the release is published *before* `main` advertises it:
- `git checkout -b release/X.Y.Z main`
- Bump `manifest.json`, `package.json`, `versions.json`; `npm install --package-lock-only`
- `npm run check-release -- --tag X.Y.Z --with-build --strict`
- Commit `X.Y.Z — short description`, push, open the PR, CI green
- `git tag X.Y.Z && git push origin X.Y.Z` — tagging the **release branch head**, so the release is published first
- Verify: `gh release view X.Y.Z --json tagName,isLatest,assets`
- `gh pr merge --merge --admin` — use `--merge`, not `--squash`, so the tagged commit stays reachable from `main`

If the workflow fails: delete the tag (`git push origin :<tag> && git tag -d <tag>`), fix on the branch, retag. `main` was never touched, so no partial release is left behind.

Commit convention: `0.X.Y — short description`.

## Reference

- Architecture & key file index → [`docs/architecture.md`](./docs/architecture.md)
- Release policies (CI expectations, branch/PR policy, check-release coverage) → [`docs/release-process.md`](./docs/release-process.md)
