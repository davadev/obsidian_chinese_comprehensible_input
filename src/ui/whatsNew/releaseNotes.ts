/**
 * What the one-time "What's new" popup says after an upgrade.
 *
 * Add an entry here for every release that changes something a user can see or has to relearn, newest first. The popup
 * shows each entry once: `settings.lastSeenVersion` remembers the newest version the user has been told about (it is a
 * per-device value and never syncs), and `notesToShow` picks the entries newer than that and not newer than the version
 * that is running. Only the `X.Y.Z` part is compared, so beta builds of a version do not repeat what an earlier beta, or
 * the stable release, already showed.
 */

import type { FigureId } from "./figures";

export interface ReleaseNoteItem {
  title: string;
  text: string;
  /** An illustration drawn under the text (see `figures.ts`). Use sparingly: a popup of pictures reads as clutter. */
  figure?: FigureId;
}

export interface ReleaseNote {
  /** The release this note belongs to, `X.Y.Z` (no prerelease suffix). */
  version: string;
  title: string;
  intro: string;
  items: ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.9.0",
    title: "What's new in 0.9.0",
    intro: "Two AI helpers for learning words, and a tidier toolbar.",
    items: [
      {
        title: "Status / HSK is now one button",
        text:
          "The two Status and HSK buttons in the toolbar became a single button. It shows how words are coloured right now; tap it to switch to the other colouring. Nothing was removed.",
        figure: "toolbar",
      },
      {
        title: "Mnemonics, redone",
        text:
          "Every character of a word now gets one picture of what it means, followed by its tone number, so the tone stays with the right character. Open the ⋯ menu and choose “Mnemonics for this note…” to fill in, regenerate or remove the mnemonics of a whole note at once. Needs an AI provider (Settings → AI provider).",
        figure: "mnemonic",
      },
      {
        title: "Explain a word",
        text:
          "Tap a word and choose Explain for a full usage note: meanings, grammar, examples in different contexts, common pitfalls, similar words and how each character is built. Read it in a preview, then save it as a note or copy it. Needs an AI provider.",
      },
    ],
  },
];

/** `[major, minor, patch]` from "0.9.0" or "0.9.0-beta.7"; null when it is not a version. */
export function baseVersion(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The entries to show: newer than `lastSeen`, not newer than `current`, oldest first, so someone who skipped a release is
 * told about both in the order they happened. An empty or unreadable `lastSeen` means "never told anything"; an
 * unreadable `current` shows nothing rather than guessing.
 */
export function notesToShow(lastSeen: string, current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const cur = baseVersion(current);
  if (!cur) return [];
  const seen = baseVersion(lastSeen) ?? [0, 0, 0];
  return notes
    .filter((n) => {
      const v = baseVersion(n.version);
      return v !== null && compare(v, seen) > 0 && compare(v, cur) <= 0;
    })
    .sort((a, b) => compare(baseVersion(a.version) as [number, number, number], baseVersion(b.version) as [number, number, number]));
}

/** The newest note that is not newer than `current`, for the "Show what's new" command. */
export function latestNote(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote | null {
  const all = notesToShow("", current, notes);
  return all.length > 0 ? all[all.length - 1] : null;
}
