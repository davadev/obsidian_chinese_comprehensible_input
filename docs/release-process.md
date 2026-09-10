# Release process

## CI expectations

Two workflows live in `.github/workflows/`:

- **`ci.yml`** — runs on every push to `main` and every PR. Executes `npm ci`, `npm run build`, `npm test`, `npm run test:cov`, `npm run lint`, and `npm run check-release -- --with-lint`. Gates merges.
- **`release.yml`** — triggers on push of a SemVer-shaped tag (`0.3.4` for stable, `0.3.4-beta.1` for prerelease). For a suffixed tag it first runs `scripts/stamp-prerelease.mjs` to write the prerelease version into the working tree only (see [Prerelease → stable workflow](#prerelease--stable-workflow)). It then re-runs the whole verification chain (lint → build → test → check-release with `--tag $TAG --with-build --strict`) on a clean Ubuntu runner, and validates the three release artifacts on disk before publishing. **A single lint Error aborts the workflow, so a broken release can never reach the directory.** On success it creates the GitHub Release with `main.js`, `manifest.json`, `styles.css` attached — auto-generated release notes from PRs / commits since the previous tag. Bare SemVer → `--latest`; tag with a `-` → `--prerelease`.

Releases are tag-driven: the dev pushes the tag, the workflow handles the rest. No more typing `gh release create` from a laptop.

## Prerelease → stable workflow

> [!WARNING]
> **Do not bump the Community-facing `manifest.json` on `main` to the next stable version until that stable release is actually published.**
> Obsidian reads `manifest.json` on the default branch to decide which version to advertise, then downloads the assets from the GitHub release **tagged identically to that version**. If `main` says `0.7.0` while only `0.7.0-beta.1` exists, every user's update check resolves to a release that does not exist — installs and updates fail, and the automated plugin checks can flag the repository.
> Never commit a `X.Y.Z-beta.N` version into `main`'s `manifest.json` either. `check-release` fails the build if you do.

### The two facts this design is built on

Both verified against upstream documentation, not assumed:

| system | what it reads | source |
|---|---|---|
| **Obsidian Community Plugins** | `manifest.json` **on the default branch** decides the advertised version; assets come from the release tagged identically to it | *"The manifest.json in your repo will only be used to figure out the latest version, while actual files are fetched from your GitHub releases"* — Obsidian developer docs |
| **BRAT** | `manifest.json`, `main.js`, `styles.css` **from the release assets**; picks the highest semver **including prereleases** | *"Download the manifest.json, main.js, and styles.css directly from the release assets"* … *"independent of the version numbering in the repository root"* — `BRAT-DEVELOPER-GUIDE.md` |

Those two pull in opposite directions, which is the whole problem: the committed manifest must stay on the old stable version, but the *published prerelease assets* must carry the new beta version or BRAT will not install it.

**Resolution:** CI stamps the prerelease version into the working tree only. `scripts/stamp-prerelease.mjs` rewrites `manifest.json`, `package.json`, `package-lock.json` and `versions.json` on the runner, after checkout and before lint/build/test. Nothing is committed. The uploaded assets carry `0.7.0-beta.1`; `main` still says `0.6.1`.

GitHub's `--prerelease` flag alone is **not** sufficient isolation — Obsidian never consults that flag. The protection comes from the default-branch manifest, not from the release flag.

### Stage 1 — normal development

Branch → PR → CI green → merge to `main`. **No version files change.** `main`'s `manifest.json` keeps advertising the current stable version for the entire feature.

### Stage 2 — cut a prerelease

Naming: `X.Y.Z-beta.N`, where `X.Y.Z` is the *next* stable version and `N` starts at 1. `rc` and `alpha` are also accepted by the tooling. Iterate with `-beta.2`, `-beta.3`, … — **only the counter moves**.

```bash
git checkout main && git pull
npm run check-release -- --with-build     # local pre-flight; no tag argument
git tag 0.7.0-beta.1
git push origin 0.7.0-beta.1
```

The `Release` workflow then: stamps the version → lint → build → test → `check-release --tag <tag> --with-build --strict` → validates the three artifacts on disk → attests provenance → publishes a **prerelease** with `main.js`, `manifest.json`, `styles.css`.

Nothing is committed to `main`. Files changed on the default branch: **none**.

### Stage 3 — install and test the prerelease

Use **BRAT** (Obsidian → Community Plugins → BRAT → *Add Beta Plugin*), pointing at this repository. BRAT resolves the highest semver across releases *and* prereleases, so it installs `0.7.0-beta.1`. To hold a tester on one exact build, use BRAT's frozen-version option and give it the tag.

Manual alternative: download `main.js`, `manifest.json`, `styles.css` from the prerelease and drop them into `<vault>/.obsidian/plugins/chinese-comprehensible-input/`.

**Verify ordinary users are unaffected** — all three should hold while a prerelease is live:

```bash
# 1. the default branch still advertises the old stable version
git show main:manifest.json | grep '"version"'          # -> 0.6.1

# 2. a release with that exact tag exists and carries the three assets
gh release view 0.6.1 --json tagName,assets \
  --jq '.tagName, [.assets[].name]'                     # -> 0.6.1, [main.js, manifest.json, styles.css]

# 3. the beta is flagged as a prerelease and is NOT marked latest
gh release view 0.7.0-beta.1 --json isPrerelease,isLatest
```

### Stage 4 — another prerelease iteration

Merge more work to `main`, then tag `0.7.0-beta.2` and push. Same workflow, same guarantees. Repeat as needed.

### Stage 5 — promote to stable

Only on explicit go-ahead. **Publish the release before `main` advertises it** — that ordering is what removes the dangerous window entirely:

```bash
git checkout -b release/0.7.0 main
# bump to the real stable version (no suffix):
#   manifest.json, package.json, versions.json  -> 0.7.0
npm install --package-lock-only                  # keep package-lock in sync
npm run check-release -- --tag 0.7.0 --with-build --strict
git commit -am "0.7.0 — release"
git push -u origin release/0.7.0
gh pr create --fill                              # CI runs on the PR

# 1. tag the RELEASE BRANCH head, so the stable release is published first
git tag 0.7.0 && git push origin 0.7.0
gh run watch                                     # workflow publishes --latest

# 2. confirm the release exists with all three assets
gh release view 0.7.0 --json tagName,isLatest,assets --jq '.tagName, .isLatest, [.assets[].name]'

# 3. only now let main advertise it
gh pr merge --merge --admin                      # --merge (not --squash): keeps the tagged commit reachable from main
```

Why this order: if you merged first, `main` would advertise `0.7.0` for the few minutes the workflow takes to build and publish, and every update check in that window would 404. Tagging from the release branch first means the release already exists at the instant `main` starts pointing at it — **the window is zero, not merely small.**

If the workflow fails, delete the tag (`git push origin :0.7.0 && git tag -d 0.7.0`), fix on the branch, retag. `main` was never touched, so nothing is left in a broken state.

### What changes at each stage

| stage | committed to `main` | inside the release assets | version Obsidian advertises |
|---|---|---|---|
| development | source only | — | current stable (`0.6.1`) |
| prerelease `0.7.0-beta.N` | **nothing** | `manifest.json` = `0.7.0-beta.N` (stamped in CI) | current stable (`0.6.1`) |
| stable `0.7.0` | `manifest.json`, `package.json`, `package-lock.json`, `versions.json` = `0.7.0` | `manifest.json` = `0.7.0` | `0.7.0` — after the release already exists |

### What NOT to do

- ❌ Commit `X.Y.Z-beta.N` into `main`'s `manifest.json`. `check-release` fails on it.
- ❌ Bump `main`'s manifest to the next stable version while only prereleases exist. That is the exact failure this workflow prevents.
- ❌ Create the bare `X.Y.Z` tag early and flag it as a GitHub prerelease. Obsidian ignores the prerelease flag and matches on the tag, so the half-baked build becomes the advertised release.
- ❌ Hand-edit `manifest.json` on the runner or hand-upload assets. Publishing goes through the tag-triggered workflow so the assets are always the validated, attested build.
- ❌ Squash-merge the release PR — the tagged commit would no longer be reachable from `main`. Use `--merge`.

### Other notes

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
- When `--tag` (or `GITHUB_REF_NAME`) is given, it equals `manifest.version` **exactly** — prerelease suffixes included. (This used to strip `-rc.N` so one manifest could serve a whole prerelease series; that allowed the default branch to advertise a version with no matching release, so it was removed. CI stamps the prerelease version instead.)
- When **no** tag is given — i.e. validating a committed state, which is what `ci.yml` does on `main` and every PR — `manifest.version` must **not** carry a prerelease suffix. This is the guard that stops a `X.Y.Z-beta.N` from ever reaching the default branch.
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
