# Roadmap

Where **Chinese Comprehensible Input** is going, and how the next release is chosen.
This is the maintainer's current intent, not a promise: dates are deliberately not
given, and anything here can change when a bug, a security problem or a user request
arrives.

The live backlog is the **[Planning project board](https://github.com/users/davadev/projects/3)**. Every
issue belongs on it. This file explains the rules the board follows.

## Direction

The aim is an **all-rounder for comprehensible input in Chinese**: reading, listening,
speaking practice and explanation, with as much as possible running **locally** on the
user's own devices:

- **Local-first.** Features should work offline and without an account. Cloud AI
  (OpenAI, Ollama on another machine) stays optional, never required.
- **Privacy by default.** Audio, vocabulary and notes stay on the device unless the user
  explicitly chooses a provider that sends them elsewhere, and the docs say so plainly.
- **Mobile matters.** iOS and Android are first-class; a feature that cannot run on a
  weak device must hide itself rather than offer a dead control.
- **Small and boring where possible.** The plugin ships with no runtime dependencies
  today. A heavy dependency (a model runtime, an extraction library) is added only after
  a timeboxed spike proves it is needed and works in Obsidian's real WebViews.

## How the next release is chosen

Work is picked in this order. A lower tier is only started when the tiers above it are
empty.

1. **Maintenance.** Bugs, security issues, dependency and toolchain updates, supply-chain
   and CI problems, data-safety risks, and anything else that is not a new feature. These
   ship as the next **fix release** of the current line (for example `0.9.x`), as soon as
   they are ready, without waiting for a feature release.
2. **User feature requests.** If there is no open maintenance work, a reasonable request
   from an actual user of the plugin that fits its scope is next. Requests are triaged
   quickly; scope, effort and fit are discussed on the issue.
3. **Planned features.** The features assigned to upcoming minor releases (below).
4. **Long-term direction.** When nothing above is waiting, work continues on the long-term
   goals, in the order given in the next section.

Every release, whatever its tier, goes through the normal prerelease loop described in
[`AGENTS.md`](AGENTS.md) and [`docs/release-process.md`](docs/release-process.md).

## Planned releases

| Release | Contents | Issues |
|---|---|---|
| **0.9.x** | Maintenance as it arises (fix releases). | whatever is tagged *maintenance* on the board |
| **0.9.1** (released) | **Simplify** in the lightbulb dropdown: the AI proposes several ways to say a sentence, the plugin ranks them by HSK level and the learner's own vocabulary and proposes the simplest, which can be applied. Also: What's new stacks per minor line and "Show what's new" opens the whole line. Follow-up not shipped: Save as note. | #238 |
| **0.10.0** | Import a web article by URL (or via the official Web Clipper) and read it in the reader, with a coverage preview. | #187 |

Issues assigned to a release can move; the board is the source of truth.

## Long-term goals, in order

1. **Text to speech** (#67): the smallest of the large features; an obvious complement to
   reading.
2. **A custom fine-tuned local language model** (#184): a small model trained on this
   plugin's own prompts so that stories, mnemonics, dictionary enhancement and Explain
   notes can run with no cloud account, in its own repository. It builds on the harness
   work in 0.9.0.
3. **Active Reading** (#183): reading aloud with feedback, running entirely on the device.
   The hardest of the three and the one with the most unproven technology, so it comes
   last and starts with a feasibility spike.

The first two share groundwork with the third (on-device model download and management),
so it is built once.

## Where the research lives

Large features start as a research-and-design issue: the problem, the proposed
experience, the options with **verified facts, hypotheses and open questions kept
separate**, a timeboxed spike, and explicit continue/stop criteria. Read #183 and #184
for the pattern.

## How to take part

- **Found a bug or a security problem?** Open an issue (see
  [`CONTRIBUTING.md`](CONTRIBUTING.md); for vulnerabilities, [`SECURITY.md`](SECURITY.md)).
- **Want a feature?** Open an issue describing the problem you want solved. If it fits the
  scope above it goes on the board as a user request.
- Issues the maintainer has not scheduled yet sit in the board's backlog, ordered by the
  tiers above.
