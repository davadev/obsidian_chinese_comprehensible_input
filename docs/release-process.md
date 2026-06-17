# Release process

## CI expectations

Two workflows live in `.github/workflows/`:

- **`ci.yml`** — runs on every push to `main` and every PR. Executes `npm ci`, `npm run build`, `npm test`, `npm run test:cov`, `npm run lint`, and `npm run check-release -- --with-lint`. Gates merges.
- **`release.yml`** — triggers on push of a SemVer-shaped tag (`0.3.4` for stable, `0.3.4-rc.1` for prerelease). Re-runs the whole verification chain (lint → build → test → check-release with `--tag $TAG --with-build`) on a clean Ubuntu runner. **A single lint Error aborts the workflow, so a broken release can never reach the directory.** On success, it creates the GitHub Release atomically with `main.js`, `manifest.json`, `styles.css` attached — auto-generated release notes from PRs / commits since the previous tag. Bare SemVer → `--latest`; tag with a `-` → `--prerelease`.

Releases are tag-driven: the dev pushes the tag, the workflow handles the rest. No more typing `gh release create` from a laptop.
- If CI fails on coverage, either add tests or explicitly move a module out of unit-test coverage because it truly requires a heavier Obsidian/jsdom harness. Do not game the threshold with low-value assertions.
- The coverage artifact uploaded by CI should be enough to inspect regressions without reproducing every failure locally.

## Branch policy

- Do not do routine bugfix / feature / release-prep work directly on `main`.
- Start each change on a dedicated branch. Preferred prefixes: `fix/<slug>`, `feat/<slug>`, `release/<version>`.
- Merge into `main` through a PR after CI passes.
- Tag and publish releases only from reviewed, merged code.

## PR policy

- PRs from outside contributors must be approved by Daniel before merge.
- `CODEOWNERS` routes review requests to `@davadev`, but real enforcement still depends on GitHub branch protection.
- Recommended GitHub settings for `main`: require a pull request, require at least one approval, and require review from code owners.

## Lint parity with Obsidian's auto-review

The Obsidian community-plugin auto-review runs `eslint-plugin-obsidianmd` plus a slice of `@typescript-eslint`'s type-aware preset. `eslint.config.mjs` at the repo root mirrors that exact rule set, with severities tuned so the local output is line-for-line comparable to the cloud review:

- `@typescript-eslint/no-explicit-any` — **Error**. Bare `any` blocks the cloud review and must block locally too.
- `@typescript-eslint/no-unsafe-*` cluster, `no-floating-promises`, `no-misused-promises` — **Warning**. These are the long-standing notes about `loadData()` / LLM-response handling; they're tracked but don't block.
- `@typescript-eslint/no-deprecated` — **Warning**. Matches the cloud's Recommendation tier (`setWarning` deprecation, `display` deprecation).
- The obsidianmd `ui/sentence-case*` rules and a handful of `@typescript-eslint` Errors that the cloud lint doesn't emit are turned off so the local report doesn't add noise the auto-review wouldn't.

**Running it locally is mandatory before tagging a release.** `npm run check-release -- --with-build` invokes lint as the last gate; a release with even one Error there will fail the cloud auto-review and risk delisting the plugin. The `release.yml` workflow re-runs the same gate on the runner after you push the tag, so a broken release is caught even if the local pass was skipped.

## What `check-release` covers

### Mechanical guards (FAIL blocks release)

- All five required artifacts exist: `manifest.json`, `main.js`, `versions.json`, `README.md`, `LICENSE`.
- `styles.css` present iff source declares any `cci-` class (catches the 0.1.56–0.1.59 iPad regression).
- Every JSON file parses; `manifest.json` has `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly`.
- `manifest.version` equals `package.json.version` AND is listed in `versions.json`.
- When `--tag` (or `GITHUB_REF_NAME`) is given, it equals `manifest.version`.
- `manifest.fundingUrl`, when set, points to a known financial-support service (GitHub Sponsors, Ko-fi, Buy Me a Coffee, Patreon, OpenCollective, Liberapay, PayPal, Stripe).
- No hardcoded user paths in source (`/Users/foo/...`, `/home/foo/...`, `C:\Users\foo\...`).
- If `isDesktopOnly !== true`, source must not import Node-only modules (`fs`, `path`, `child_process`, `os`, `electron`).
- `package.json` defines `build` and `test` scripts; with `--with-build`, they actually run and pass.
- With `--with-build` (or `--with-lint`), the Obsidian-parity lint step runs `npm run lint --format json` and counts Errors vs Warnings — Errors fail the release guard, Warnings are reported as non-blocking.

### Heuristic guards (WARN — review but don't block)

- README.md mentions purpose / usage / settings / limitations.
- `console.log` count in `src/` ≤ 30 (over the threshold suggests ungated debug output).
- External network usage (`fetch` / `requestUrl`) is documented in README or `docs/`.
- Files that call `adapter.read/write/exists/mkdir/list/append/remove/rename` also use `normalizePath()` somewhere in the file.
- No stray distributable cruft at repo root (orphan `.ts`, `.bak`, `.DS_Store`, `main.js.map`). `*.config.{ts,js,mjs}` is allowlisted.
