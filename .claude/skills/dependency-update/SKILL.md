---
name: dependency-update
description: Rules for bumping npm dependencies, GitHub Actions, or the bundler in this repo. Use when reviewing Dependabot PRs, running npm install/update, or touching package.json, package-lock.json, .npmrc, dependabot.yml or workflow action pins.
---

# Dependency updates

- **Age**: never adopt a version younger than 14 days (`.npmrc` `min-release-age=14`, Dependabot `cooldown:`; check-release fails if either disappears). Urgent non-security exception → `min-release-age-exclude[]` in the same PR. Security updates are not delayed.
- **Pinned EXACT, matching `obsidian`'s peers**: `@codemirror/state` (6.5.0) and `@codemirror/view` (6.38.6) (both still current while `obsidian` stays on 1.13). Move only when the `obsidian` devDependency moves; Dependabot-ignored.
- **Bundled into `main.js`**: 8 `@codemirror/*` / `@lezer/*` packages (only `lang-markdown` is direct; others pinned via `overrides`). After any `npm install`, confirm all eight still hold; the build hash is the real check. For a `lang-markdown` bump: does `@lezer/markdown` move, what is the *locked* delta, diff the published `dist/index.js`. Reachability can't be judged by grepping `src/` (`markdown()` binds Enter/Backspace itself).
- **`obsidian` minor/major is Dependabot-ignored** (scoped, security updates still fire): 1.14 needs CodeMirror 6.43, which breaks `posAtCoords` in `check:layout`. Do not take a grouped PR that carries it.
- **Dev advisories**: parent-scoped `overrides` (`minimatch` 11.0.1 under eslint, @eslint/config-array, typescript-estree, eslint-plugin-n, eslint-plugin-json-schema-validator; `moment` 2.31.0 under `obsidian`), never global. Prove with `rm -rf node_modules && npm ci && npm ls --all && npm audit`; delete a surviving stale nested lockfile entry; confirm the `--print-config` rule count (176) is unchanged.
- **esbuild** moves only on a release of its own; never entangled with other changes.
- **eslint** is NOT Dependabot-ignored. For a major: confirm rule counts do not shrink (`npx eslint --print-config`) and stderr is empty (0/0 also happens when a plugin fails to load).
- **`npm ls --all` must exit 0** (check-release fails otherwise); `npm ci` succeeds on inconsistent trees.
- **No runtime `dependencies`**; `npm audit --omit=dev` must stay clean. Dev advisories are informational and never block a release. `allowScripts` must approve no package; `npm install-scripts ls` to review.
- **GitHub Actions pinned to commit SHAs**, bump within the current major (`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`); majors come as separate Dependabot PRs.
- Chase version constraints transitively (engines of deps, npm shipped with each Node); defer high-risk, low-value bumps to Dependabot.
- Details: `docs/release-process.md`.

## Dependabot gate (before every beta, before every stable)

1. **Open PRs.** `gh pr list --state open --author "app/dependabot"`. Fold every one into the next beta: merge it, or supersede it with your own branch (a conflicting or failing grouped PR is redone on a fresh branch and closed with a pointer), and only then tag. Never tag a beta around an open Dependabot PR. A PR that opens after a beta was tested goes into the following beta, not into the stable that promotes the tested one.
2. **Alerts.** `gh api repos/<owner>/<repo>/dependabot/alerts --jq '[.[]|select(.state=="open")]|length'`. HTTP 403 "Dependabot alerts are disabled" means they are off: turn them on with `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts` (repo admin; a GET of the same path answering 204 means on), then re-read in a few minutes. Optionally `gh api -X PUT repos/<owner>/<repo>/automated-security-fixes`. Guide: playbook `SUPPLY-CHAIN.md`, "Turning on Dependabot alerts".
3. **Fix, do not dismiss.** Lockfile first (`npm update <pkg>`, exact bump for a direct dependency), then parent-scoped `overrides`, then a clean `rm -rf node_modules && npm ci && npm ls --all && npm audit`. Never dismiss an alert to get green.
4. **Stable needs 0 open alerts.** If one cannot be fixed (no patch yet, a parent breaks under the override), tell the user which and why before tagging stable; the user decides.
