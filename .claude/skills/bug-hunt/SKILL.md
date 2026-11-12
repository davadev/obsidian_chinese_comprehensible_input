---
name: bug-hunt
description: Systematic bug hunt for this plugin's diff or release line. Use before promoting a beta to stable, after a feature lands, or when asked to "find bugs", "audit", "look for races" or "review since last stable". Covers races, event ordering, stale caches, data safety on load/save, host and mobile differences, keyboard focus, layout overflow, batch poisoning, date/time zone boundaries and test blind spots, each with a grep recipe and a test pattern.
---

# Bug hunt

Imported from the playbook (`obsidian-plugin-playbook/templates/skills/bug-hunt/`, `BUG-HUNT.md`, `INCIDENTS.md`; cloned next to this repo; read INCIDENTS first, every row is a class that already bit once) and cut down to what applies here. A green suite at 100 % coverage only proves the code runs under the harness. Each class below lives in what the harness does not model: ordering, caches, lifecycle gaps, host differences. Hunt those gaps on purpose.

## Scope first
`L=$(git tag --sort=-creatordate | grep -v -- -beta | head -1); git diff --stat $L..HEAD -- src ':!src/tests'`. Read changed files top-down by churn. For every changed function ask the classes below; write a failing scratch test before claiming a bug (a claim without a repro is a guess).

### Full sweep (empty diff, or the line was already hunted by diff)
Sweep by module, not churn: (1) persistence and parsing (`src/settings/` load/migrate/import, `src/vocabulary/` store, `src/data/BackupService.ts`, sync/mirror, note-file writers in `src/ai/noteFiles.ts`), because a wrong write there loses data; (2) host event handlers in `src/main.ts`; (3) service pipelines (`src/ai/*Service.ts`, tokenizer, dictionary download); (4) views and dialogs last (`src/view/`, `src/ui/`, `src/editor/`). Then run the whole suite under a time zone matrix (class 9).

## The classes
1. **Async ordering and races.** Read-modify-write on settings, vocabulary, backups or a note across an `await`; two saves racing; a second event before the first finishes.
   - Grep: `await` between a read and a write of the same store; `saveData`/`saveSettings`; `vault.create|modify|process|adapter.write`; `setTimeout`/debounce; "exists then create".
   - Test: fake timers plus a promise resolved late; fire the second event first; run the operation twice concurrently and assert idempotence (no lost edit, no duplicate).
2. **Event ordering and host lifecycle.** `workspace.on`/`registerEvent`, `onLayoutReady`, view `onOpen`/`onClose`, fields named `pending*`/`current*`/`last*`. Who sets and clears each; what if the clearing event never fires, fires twice, or fires after the view closed? Every late `onLayoutReady` block needs the same `loaded`/`unloaded` guard (plugin disabled during startup must not leak timers or writes).
3. **Stale derived state and caches.** The shared tokenizer cache, dictionary/trie, vocabulary-derived colours, `displaySurface` results. What invalidates each (script variant, region, dictionary reload, word-state change, rename/delete/sync-in)? Is the cache key complete? Test: change the source without changing the key; change it from another code path.
4. **New persisted fields.** Every new settings key or stored field is a column: default, load (old data without it), save, import/export, backup, sync merge, reset, `settingsCoverage.test.ts`. Grep the key across `src/`; a pipeline that never mentions it either handles it implicitly or forgot it.
5. **Host and platform differences.** `Platform.is*`, `isMobile`, touch vs pointer, `mousedown`+`click` on one element, `blur`/`focus`, `requestUrl` buffering on mobile, desktop-only Node modules. Which event fires after the one I handle (release after long press)? Test with the platform set both ways.
6. **Keyboard and focus.** Every control reachable with Tab/Shift+Tab/Enter/Escape; modals take focus and return it on close; a handler that `preventDefault`s must move focus. Test: dispatch real `KeyboardEvent`s and assert `document.activeElement`.
7. **Layout overflow.** Longest realistic text (60-char unbroken word, 200-char title, emoji), flex children without `min-width: 0`, dialogs wider than a phone. Test: `npm run check:layout` and `check:webkit` with a long-content fixture.
8. **Batch poisoning and partial failure.** `for ... of` / `Promise.all` / `map(async` that writes or throws per item (batch mnemonics, backups, imports). If item 3 of 10 throws, do 4..10 still run, is the user told which failed, is state consistent? Test: make one item fail and assert the rest succeed and a notice names it.
9. **Dates, clocks and zones.** `new Date(`, `Date.now`, `toISOString().slice(0, 10)`, `Date.parse` on date-only strings, SRS due dates, streaks, daily limits, `mtime` gates, `86400000` as "one day" across DST. Ask what runs at 23:59:59 vs 00:00:01 and after sleep/wake. Run the WHOLE suite: `for tz in UTC Pacific/Auckland America/Los_Angeles Europe/Prague Asia/Kolkata; do TZ=$tz npx vitest run; done`. A failure is a fragile test or a real bug; decide by reading the code.
10. **Data safety on load/save.** Anything written without a user action; a parser that throws on a half-written, hand-edited, foreign or older-version file; a failed or partial read that looks like "empty" (then saved over the real data); sync conflict copies; merge commutative and idempotent. Test: corrupt, truncated and old-schema fixtures; make the read fail and assert nothing is overwritten.
11. **Doc and asset drift.** `releaseNotes.ts`, README, `docs/`, `architecture.md`, screenshots all mention each user-visible change since the last stable; `npm run check:screenshots` passes.
12. **Test blind spots (meta).** List what the harness fakes (constant `stat`, immediate events, no host CSS, one device, no real clock, mocked `obsidian`, happy-dom not a browser) and say which claimed behaviour depends on exactly that. Do not call it verified.
13. **Hidden or stale views.** A panel drawn while hidden and stale on reveal; a refresh that rebuilds a focused element (search box losing the keyboard); leaf reuse saving an empty buffer over a note. Test: change data while hidden then reveal; focus an input, refresh, assert element and caret survive.
14. **Shared mutable defaults and sticky state.** `{ ...DEFAULT_SETTINGS }` with nested arrays/objects shared between loaded settings and defaults; module-level `let`/`Map`/`Set` that survives plugin disable/enable. Test: load settings twice and mutate one; disable then re-enable and assert no old listener, timer or cache remains.
15. **Transient states in the editor.** Between two keystrokes or two awaits the document, token list or decoration is wrong for a moment (tokenize before `ensureEditor`; `redecorate()` after a mode switch). Test the intermediate document, not only the final one.
16. **Input dropped instead of queued.** Early `return` in an event handler because "something else is going on" (a busy flag) loses the user's action for good. Test: start a slow action, send the event, finish, assert it took effect.
17. **Units and extremes.** `Math.round`, `toFixed`, `parseFloat`/`Number` on user text, `MAX_*`/`MIN_*`: zero, smallest, largest, one past it at dialog, parser, writer and display; a value is kept exactly or rejected with a message, never silently turned into "none".
18. **Upgrade residue.** What the last stable wrote, opened by the new code with no migration run and with it half run: no write on load, repaired by the documented action, a second run changes nothing; and what an older version on a second device does to what the new one wrote.
19. **Tests that bake in the author's environment.** In tests grep `toISOString().slice`, `T..:..:..Z`, `startsWith('20`, `getUTC`, `Date.UTC`, `new Date("2026-` without a time, `process.platform`, hard-coded zones.

## Method
1. Pick the scope: diff since the last stable, or the full sweep.
2. List changed behaviours; walk every class; write the question down only if it could apply.
3. Repro with a scratch test (patterns in `src/tests/*.dom.test.ts`, `makeSettingsTab()`, `explainFixture.ts`); keep it only as a real regression test with 100 % coverage.
4. Rank by user damage: data loss or duplication > wrong data shown > stuck UI > cosmetics.
5. Report: file:line, trigger, effect, repro status (reproduced / reasoned only), suggested fix and the regression test that will guard it. Separate "reproduced" from "suspected".

## Rules
- **No fix without a regression test**: write the repro first, watch it fail for the right reason, fix, watch it pass, and say so in the PR.
- A suspected bug gets a reproducing test first or is dropped.
- Fixes follow `feature-done` and ship via `release-beta`. Stay at medium effort and read directly; do not spawn verifier agents.
- When a bug is fixed, add its class and repro pattern here if it was not covered.
- State what you could not verify (real device, real sync, real Obsidian).
