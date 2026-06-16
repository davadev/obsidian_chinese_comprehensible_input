# Community Plugin Submission

Use this short checklist before submitting or resubmitting the plugin to the Obsidian Community Plugins directory.

## Pre-submit checklist

- `manifest.json` includes valid `id`, `name`, `version`, `minAppVersion`, `description`, `author`, and `isDesktopOnly` fields.
- `manifest.json.version`, `package.json.version`, `package-lock.json`, and `versions.json` are in sync.
- The release tag matches `manifest.json.version` exactly.
- `npm run build`, `npm test`, and `npm run check-release` all pass.
- Release assets include `main.js`, `manifest.json`, and `styles.css` because this plugin uses stylesheet classes.
- Confirm the latest GitHub release points at the same version you plan to submit.

## Submission flow

1. Publish the matching GitHub release first.
2. Submit the plugin through the Obsidian Community Plugins directory process.
3. If review feedback requires changes, bump the version, publish a new matching release, and resubmit with that new version.
