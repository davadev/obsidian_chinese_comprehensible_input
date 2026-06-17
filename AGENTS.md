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

0. **Run `npm run check-release -- --with-build`. Must report `0 failed` AND the embedded Obsidian-parity lint step must report `0 errors` before you tag.** That single command builds, tests, and lints. Re-run after every version bump so the new `main.js` size is re-checked. If anything fails, fix it before tagging — never bypass. WARN-level findings (yellow `!`) are non-blocking but worth a look. The lint step matches the cloud auto-review's rule set (`eslint-plugin-obsidianmd` + the relevant `@typescript-eslint` type-aware rules); see `eslint.config.mjs`. **A release with even one local lint Error will fail the Obsidian community-plugin auto-review and risk delisting the plugin.**
1. Bump `version` in `manifest.json`, `package.json`, and add entry to `versions.json`.
2. `npm run build` → produces `main.js`.
3. `npm test` and `npm run test:cov` locally if you changed code, test config, or release artifacts. Do not assume CI will catch something you can catch before tagging.
4. Commit all changes, tag `0.X.Y`.
5. `npm run check-release -- --tag 0.X.Y --with-build` — final guard that the tag matches the manifest version and that build + tests still pass. Must report `0 failed`.
6. `gh release create 0.X.Y --title "0.X.Y — description" --notes "..." --prerelease main.js manifest.json styles.css`

7. **Promote to stable after manual testing.**  
   Once you have tested the release in BRAT and confirmed it works:  
   `gh release edit 0.X.Y --prerelease=false`  
   This makes it the latest release — BRAT auto-update for regular users now picks it up.

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
- Tag `0.X.Y`
- `npm run check-release -- --tag 0.X.Y --with-build`
- `gh release create 0.X.Y --title "0.X.Y — description" --notes "..." --prerelease main.js manifest.json styles.css`

- **Promote to stable after manual testing.**  
  Once you have tested the release in BRAT and confirmed it works:  
  `gh release edit 0.X.Y --prerelease=false`  
  This makes it the latest release — BRAT auto-update for regular users now picks it up.

Commit convention: `0.X.Y — short description`.

## Reference

- Architecture & key file index → [`docs/architecture.md`](./docs/architecture.md)
- Release policies (CI expectations, branch/PR policy, check-release coverage) → [`docs/release-process.md`](./docs/release-process.md)
