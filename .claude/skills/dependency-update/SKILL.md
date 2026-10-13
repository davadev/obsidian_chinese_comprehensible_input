---
name: dependency-update
description: Rules for bumping npm dependencies, GitHub Actions, or the bundler in this repo. Use when reviewing Dependabot PRs, running npm install/update, or touching package.json, package-lock.json, .npmrc, dependabot.yml or workflow action pins.
---

# Dependency updates

- **Age**: never adopt a version younger than 14 days (`.npmrc` `min-release-age=14`, Dependabot `cooldown:`; check-release fails if either disappears). Urgent non-security exception → `min-release-age-exclude[]` in the same PR. Security updates are not delayed.
- **Pinned EXACT, matching `obsidian`'s peers**: `@codemirror/state` (6.5.0) and `@codemirror/view` (6.38.6). Move only when the `obsidian` devDependency moves; Dependabot-ignored.
- **Bundled into `main.js`**: 8 `@codemirror/*` / `@lezer/*` packages (only `lang-markdown` is direct; others pinned via `overrides`). After any `npm install`, confirm all eight still hold; the build hash is the real check. For a `lang-markdown` bump: does `@lezer/markdown` move, what is the *locked* delta, diff the published `dist/index.js`. Reachability can't be judged by grepping `src/` (`markdown()` binds Enter/Backspace itself).
- **esbuild** moves only on a release of its own; never entangled with other changes.
- **eslint** is NOT Dependabot-ignored. For a major: confirm rule counts do not shrink (`npx eslint --print-config`) and stderr is empty (0/0 also happens when a plugin fails to load).
- **`npm ls --all` must exit 0** (check-release fails otherwise); `npm ci` succeeds on inconsistent trees.
- **No runtime `dependencies`**; `npm audit --omit=dev` must stay clean. Dev advisories are informational and never block a release. `allowScripts` must approve no package; `npm install-scripts ls` to review.
- **GitHub Actions pinned to commit SHAs**, bump within the current major (`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`); majors come as separate Dependabot PRs.
- Chase version constraints transitively (engines of deps, npm shipped with each Node); defer high-risk, low-value bumps to Dependabot.
- Details: `docs/release-process.md`.
