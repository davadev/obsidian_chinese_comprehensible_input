---
name: release-stable
description: Promote a tested beta to stable X.Y.Z. ONLY on the user's explicit go-ahead. Use when the user says "promote", "go stable", "publish stable", "release 0.X.Y for everyone". Covers release branch, version bump, tagging the branch head before merge, board/issue/ROADMAP cleanup.
---

# Promote to stable

Only run after the user explicitly says so. The stable release must be **published before `main` advertises it** (Obsidian reads `main`'s manifest, then downloads from the release with the same tag).

## Steps
1. `git checkout -b release/X.Y.Z main`.
2. Bump `manifest.json`, `package.json`, `versions.json` to `X.Y.Z`; `npm install --package-lock-only` (else CI version-skew check fails).
3. Public notes for a minor release: `docs/release-notes-X.Y.0.md` finished (new / changed / fixed / how to upgrade / issues closed). Confirm `RELEASE_NOTES` has the `X.Y.Z` entry in `src/ui/whatsNew/releaseNotes.ts`.
4. `npm run check-release -- --tag X.Y.Z --with-build --strict` → 0 failed, lint 0 errors.
5. Commit `X.Y.Z — short description`, push, open PR, wait for CI green.
6. Tag the **release branch head**: `git tag X.Y.Z && git push origin X.Y.Z`. Let `release.yml` publish.
7. Verify: `gh release view X.Y.Z --json tagName,isLatest,assets` → latest, three assets (`main.js`, `manifest.json`, `styles.css`). Paste the notes into the release.
8. Only now merge: `gh pr merge <n> --merge --admin --delete-branch`. Use `--merge`, **not** `--squash`, so the tagged commit stays reachable from `main`.
9. Cleanup: close the issues the release resolves; board items → **Done**; re-check Release column of remaining issues; update `ROADMAP.md`; `git checkout main && git pull`.
10. If the workflow fails: delete the tag (`git push origin :X.Y.Z && git tag -d X.Y.Z`), fix on the branch, retag. `main` was never touched.

## Never
- Create the bare tag early and flag it prerelease.
- Bump `main` to a version with no published release.
