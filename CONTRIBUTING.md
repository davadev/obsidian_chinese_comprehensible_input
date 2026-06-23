# Contributing

Thanks for your interest in **Chinese Comprehensible Input**. This is an
issues-first project: bug reports and feature ideas are very welcome, and pull
requests are too — but for anything non-trivial, **please open an issue first**
so we can agree on the approach before you spend time on a PR. The scope and
direction of the plugin are maintained by the author.

## Reporting a bug

Open a [GitHub issue](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues)
and include:

- **What happened vs. what you expected.**
- **Steps to reproduce** — ideally with a tiny sample note (a few lines of
  Chinese is enough). Reproductions are the single biggest factor in how fast a
  bug gets fixed.
- **Environment:** Obsidian version, platform (Windows / macOS / Linux / iOS /
  Android), and the plugin version (`Settings → Community plugins`, or the
  `manifest.json` version).
- **Console errors:** on desktop, `Ctrl/Cmd+Shift+I` → Console; copy anything red.
- A screenshot or short screen recording if it's a rendering issue — most of the
  Chinese-view bugs are visual and a picture saves a lot of back-and-forth.

Please search existing issues first; a 👍 on an existing report is more useful
than a duplicate.

## Suggesting a feature

Open an issue describing the problem you want solved (not only the solution you
have in mind). Comprehensible-input pedagogy and a clean reading experience drive
what gets built, so framing the *why* helps.

## Working on a change

Prerequisites: Node 20+ and npm.

```bash
npm install
npm run dev          # watch build into main.js
npm run build        # type-check (tsc) + production bundle
npm test             # vitest unit tests
npm run test:cov     # coverage report + thresholds
npm run lint         # Obsidian community-plugin parity lint
npm run check-release # release-readiness guard (run with --with-build before a tag)
```

To try a dev build in a vault, copy `manifest.json`, `main.js`, and `styles.css`
into `<vault>/.obsidian/plugins/chinese-comprehensible-input/` and enable the
plugin (or test a published prerelease through BRAT).

### Branch, PR, and release flow

- Branch off `main`. Preferred prefixes: `fix/`, `feat/`, `chore/`,
  `release/<version>`.
- Keep PRs focused; reference the issue they address.
- **Every PR must pass CI:** `npm run build`, `npm test`, coverage, `npm run lint`
  (0 errors), and the release guard. Add tests for any pure-logic change.
- Commit/PR title convention for release-bearing changes: `0.X.Y — short
  description`.
- The plugin ships through a **tag-driven** pipeline and an **iterative `-rc.N`
  prerelease loop** — the manifest stays pinned at the target `0.X.Y` while each
  round is tagged `0.X.Y-rc.1`, `-rc.2`, …; the bare `0.X.Y` tag is the stable
  release. The release workflow re-runs lint/build/test and the guard
  (`check-release --strict`, where **any warning blocks the release**) on a clean
  runner before publishing. Full details:
  [`docs/release-process.md`](./docs/release-process.md) and `AGENTS.md`.
- External PRs are merged only after maintainer review.

### Where things live

Start with [`docs/architecture.md`](./docs/architecture.md) for the file map and
the key invariants (the CodeMirror decoration pipeline, the tokenizer cache, the
view/editor boundary). The user-facing feature docs are under
[`docs/`](./docs/index.md). `AGENTS.md` documents the commands, constraints, and
the exact release process the maintainer follows.

## Code style

Match the surrounding code — the lint config (`eslint.config.mjs`) mirrors
Obsidian's community-plugin auto-review, so `npm run lint` is the source of truth.
Prefer the existing patterns (Obsidian API over Node APIs, `normalizePath` for
vault paths, no `console.log` left in shipped paths).
