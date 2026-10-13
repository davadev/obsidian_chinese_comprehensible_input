# Community Plugin Submission

The plugin is already listed in Obsidian's community directory, so a normal update needs **no resubmission**: publish a new GitHub release (see [`release-process.md`](./release-process.md)) and the directory picks it up. Use this page to check the rules the directory enforces before any submission.

Sources: Obsidian's pages [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin), [Developer policies](https://docs.obsidian.md/community-directory/developer-policies) and [Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins). Read them again before submitting; they change.

## What the directory reads

- It reads `manifest.json` at the **head of the default branch** (`main`) and the assets of the GitHub release whose tag matches the version. So `main`'s manifest must never name a version that has no published release; the release pipeline protects this (never commit a `-beta.N` version to `main`).
- The repository needs a `README.md`, a `LICENSE` and a `manifest.json`.

## Pre-submit checklist

- `manifest.json` has valid `id`, `name`, `version`, `minAppVersion`, `description`, `author` and `isDesktopOnly`.
- `id` is unique, lowercase letters and hyphens, does not contain `obsidian` and does not end in `plugin`. `name` does not contain the word "Plugin" and uses Basic Latin characters.
- `manifest.json.version`, `package.json.version`, `package-lock.json` and `versions.json` agree, and the release tag equals the manifest version exactly.
- `npm run build`, `npm test`, `npm run lint` and `npm run check-release` pass with no warnings.
- Release assets include `main.js`, `manifest.json` and `styles.css` (this plugin ships a stylesheet).
- The README says plainly what the plugin sends over the network (the optional AI providers) and what is stored where, as the developer policies require. Check this against [`openai-setup.md`](./openai-setup.md).
- The licence and any bundled or derived material (CC-CEDICT, the HSK lists) are credited as their licences require.

## Submission flow

1. Publish the matching GitHub release first.
2. Sign in at [community.obsidian.md](https://community.obsidian.md), link the GitHub account and add the plugin.
3. If review feedback requires changes, fix them, publish a new matching release.
