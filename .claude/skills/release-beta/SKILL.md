---
name: release-beta
description: Cut a prerelease (X.Y.Z-beta.N) of the plugin for BRAT testing. Use whenever a fix or feature has merged to main and needs to be tagged/released, or the user says "release", "tag", "ship a beta", "publish". Every release starts as a prerelease; never create a bare X.Y.Z tag here (use release-stable, and only on explicit go-ahead).
---

# Release a beta

`main`'s `manifest.json` / `package.json` / `versions.json` **do not change**. CI stamps the beta version into the working tree only (`scripts/stamp-prerelease.mjs`, never commit its output). Full rationale: `docs/release-process.md` (Prerelease → stable workflow).

## Steps
1. Change is merged to `main` via PR with CI green (`feature-done` checklist passed). `git checkout main && git pull`.
2. If images, annotated screenshots, or AI prompts changed: **stop and show the user the before/after**, get approval before tagging. Docs/asset-only changes still go through this full pipeline.
3. `npm run check-release -- --with-build` → must report `0 failed`, `0 warned` and lint `0 errors, 0 warnings`. Never skip. Yellow `!` warnings: read them. A project hook (`.claude/hooks/pre-tag-check.mjs`) also runs `check-release --with-lint` before any `git tag <semver>` / `git push` of a tag and blocks the command on failure; it does not replace the full `--with-build` run.
4. Pick the next number: `git tag --list 'X.Y.Z-beta.*' --sort=-v:refname | head -1`. Tag suffix is mandatory (`-beta.N`); a bare `X.Y.Z` tag auto-promotes to latest stable.
5. `git tag X.Y.Z-beta.N && git push origin X.Y.Z-beta.N`. Never run `gh release create` by hand; `release.yml` does lint/build/test/check-release/attest and publishes the prerelease.
6. Verify: `gh run list --workflow release.yml --limit 1`, then `gh release view X.Y.Z-beta.N --json tagName,isPrerelease,assets` → assets are exactly `main.js`, `manifest.json`, `styles.css`, `isPrerelease: true`. Confirm `main`'s manifest still shows the old stable version.
7. If the workflow fails: `git push origin :<tag> && git tag -d <tag>`, fix on a branch, retag. `main` was never touched.
8. Board: move the issues in the release to Status **In beta**. Tell the user how to install (BRAT → Add Beta Plugin, `davadev/obsidian_chinese_comprehensible_input`) and that a new settings group needs a full Obsidian restart.

## Never
- Commit a `-beta.N` version to `main`.
- Hand-upload assets or hand-edit the manifest.
- Mark a bare-tag release as "prerelease" to hide it.
