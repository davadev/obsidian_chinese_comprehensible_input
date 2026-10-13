---
name: triage-issue
description: Create or triage a GitHub issue and put it on the Planning project board with Tier and Release. Use when opening an issue, picking what to work on next, or after a release to update board state.
---

# Issues and the Planning board

Board: https://github.com/users/davadev/projects/3. Rules and priority: `ROADMAP.md` and the Release Planning section of `AGENTS.md`.

## Every issue, always
1. Label: `maintenance` / `security` / `user-request` / `bug` / `enhancement`.
2. Add to the project: `gh project item-add 3 --owner davadev --url <issue-url>`.
3. Set **Tier** (1 Maintenance, 2 User request, 3 Planned feature, 4 Long-term, 5 Needs decision) and **Release** (Next fix release, a version such as `0.10.0`, or Unscheduled). Field/option ids: `gh project field-list 3 --owner davadev --format json`; set with `gh project item-edit`. Needs `gh auth refresh -s project`.
4. Large features start as a research-and-design issue: verified facts / hypotheses / open questions separated, timeboxed spike, explicit continue/stop criteria.

## Picking next work
Top-down by Tier. If any Maintenance item is open, the next release is a fix release (`0.9.x`) containing those items.

## Status lifecycle
Backlog → Ready → In progress → **In beta** (prerelease published) → **Done** (stable published, issue closed).

## After a stable release
Move released issues to Done, re-check the Release column of the rest, update `ROADMAP.md`.

## GitHub comments
Correct a posted comment by editing it in place with an italic dated edit note; never stack a correction comment.
