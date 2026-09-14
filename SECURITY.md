# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not as a public GitHub issue.

- Preferred: [open a private security advisory](https://github.com/davadev/obsidian_chinese_comprehensible_input/security/advisories/new) on this repository (GitHub private vulnerability reporting).
- If the plugin's behaviour in Obsidian itself concerns you, you can also use Obsidian's [Report a security issue](https://help.obsidian.md/resources#Report+a+security+issue) channel.

Please include the plugin version (Settings → Community plugins), your Obsidian version and platform, and the steps to reproduce.

**Response expectations.** This is a single-maintainer hobby project, so there is no paid on-call rotation. Expect an acknowledgement within about a week. Confirmed issues that can affect users are fixed and released as a prerelease first, then promoted to stable — see [`docs/release-process.md`](./docs/release-process.md).

## Supported versions

Only the **latest stable release** receives security fixes. Older versions are not patched; please update before reporting. Prereleases (`X.Y.Z-beta.N`) are for testing and are not separately supported.

## Security posture

Deliberate properties of this plugin, each verifiable from this repository:

- **Zero runtime dependencies.** `package.json` declares no `dependencies`, only `devDependencies`. Nothing from npm is bundled into the shipped `main.js` beyond this repository's own source, so the plugin's dependency attack surface is empty. `npm run check-release` fails the release if that ever stops being true.
- **Dependency install scripts are denied.** `package.json`'s `allowScripts` field records a deny-all policy, so a dependency cannot execute a `postinstall` during development. `check-release` fails if an approval is ever added without review.
- **Reproducible, attested builds.** Releases are built only by [`.github/workflows/release.yml`](./.github/workflows/release.yml) on a clean runner, and `main.js`, `manifest.json` and `styles.css` carry [GitHub artifact attestations](https://docs.github.com/en/actions/security-guides/using-artifact-attestations). Verify one yourself:

  ```bash
  gh attestation verify main.js --repo davadev/obsidian_chinese_comprehensible_input
  ```

- **Pinned CI actions.** Every GitHub Action is pinned to a full commit SHA rather than a mutable tag, so a repointed tag cannot inject code into the build that produces the released `main.js`.
- **No dynamic code execution.** No `eval`, no `new Function`, no `child_process`, no `innerHTML`-style HTML injection, and no auto-update mechanism.
- **No telemetry.** The plugin never phones home. Its only network calls are the user-triggered dictionary download and the opt-in AI provider — both documented under [Permissions & network](./README.md#permissions--network) in the README.

## Verify this release yourself

Neither claim below asks for trust — both are checkable in under a minute.

**Provenance — who built it, from which commit:**

```bash
gh attestation verify main.js --repo davadev/obsidian_chinese_comprehensible_input
```

Prints the workflow that produced the file (`.github/workflows/release.yml@refs/tags/<tag>`) and the source commit. A file built anywhere else fails this check.

**Reproducibility — the released bytes come from the released source:**

```bash
git clone https://github.com/davadev/obsidian_chinese_comprehensible_input
cd obsidian_chinese_comprehensible_input
git checkout <tag>
npm ci && npm run build
shasum -a 256 main.js
```

The digest must equal the `main.js` attached to that release. Obsidian's community-plugin scorecard runs the equivalent check and reports it as *"Build reproduced the release main.js byte-for-byte."*

## Scope

In scope: anything that lets a third party read or modify vault content without the user's action, exfiltrate API keys, or execute code through this plugin.

Out of scope: vulnerabilities in Obsidian itself (report those to Obsidian), in an AI provider you configure, or in the CC-CEDICT data source. Dev-dependency advisories that cannot reach a user — the test and lint toolchain is never shipped — are tracked but are not treated as vulnerabilities in this plugin.
