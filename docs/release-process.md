# Release process

## CI expectations

- `.github/workflows/ci.yml` is the minimum repo gate. It runs `npm ci`, `npm run build`, `npm test`, `npm run test:cov`, and `npm run check-release`.
- Keep release publishing manual. CI validates that the branch is healthy; the actual BRAT release still needs an intentional version bump, tag, and `gh release create` with the three release assets attached.
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

### Heuristic guards (WARN — review but don't block)

- README.md mentions purpose / usage / settings / limitations.
- `console.log` count in `src/` ≤ 30 (over the threshold suggests ungated debug output).
- External network usage (`fetch` / `requestUrl`) is documented in README or `docs/`.
- Files that call `adapter.read/write/exists/mkdir/list/append/remove/rename` also use `normalizePath()` somewhere in the file.
- No stray distributable cruft at repo root (orphan `.ts`, `.bak`, `.DS_Store`, `main.js.map`). `*.config.{ts,js,mjs}` is allowlisted.
