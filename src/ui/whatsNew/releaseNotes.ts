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
    version: "0.9.3",
    title: "What's new in 0.9.3",
    intro: "AI dialogs now tell you what is really happening.",
    items: [
      {
        title: "No more guessed progress bar",
        text:
          "While the AI writes an explanation, the dialog shows only what is known: the request was sent, how many seconds you have waited, and, where the answer streams in, how much of it has arrived, then the check of the answer. On a phone the answer comes in one piece, so there it shows the waiting time.",
      },
    ],
  },
  {
    version: "0.9.2",
    title: "What's new in 0.9.2",
    intro: "Dark mode reads better, and your AI key now lives where Obsidian keeps secrets.",
    items: [
      {
        title: "Dark mode colors",
        text:
          "In a dark theme the Chinese characters now follow the theme instead of staying black, and the word colors you chose are lightened so they stand out on a dark page. Light themes look exactly as before.",
      },
      {
        title: "API keys in Obsidian's secret storage",
        text:
          "The OpenAI and Ollama keys are no longer kept in the plugin's own storage. In Settings, AI, choose a secret (or create one) in the API key row; Obsidian keeps the key, and the plugin only remembers its name. A key you saved before is moved over automatically the first time you start this version, so there is nothing to paste again. Restart Obsidian fully once so the settings page shows the new row.",
      },
    ],
  },
  {
    version: "0.9.1",
    title: "What's new in 0.9.1",
    intro: "A sentence too hard to read? The lightbulb can now find an easier way to say it.",
    items: [
      {
        title: "Simplify a sentence",
        text:
          "Tap the lightbulb, choose Simplify in its dropdown, then tap the first and the last word. The AI suggests several easier ways to say the same thing, and the app measures each one against the HSK lists and the words you already know, then shows the simplest with the numbers. One tap puts it into your note. Needs an AI provider.",
      },
    ],
  },
  {
    version: "0.9.0",
    title: "What's new in 0.9.0",
    intro: "Help while you read: understand a word, understand a sentence, check your own Chinese.",
    items: [
      {
        title: "One button for colouring",
        text: "Less clutter on a phone: Status / HSK is now a single button that shows how words are coloured. Tap it to flip.",
        figure: "toolbar",
      },
      {
        title: "Mnemonics you can trust",
        text:
          "Tones are the hard part of Chinese. Each character now gets a picture of its meaning with its tone number right after it, written by the app so the tone is never wrong. Fill a whole note at once from the ⋯ menu → “Mnemonics for this note…”. Needs an AI provider.",
        figure: "mnemonic",
      },
      {
        title: "Understand any word",
        text:
          "A dictionary says what a word means, not when to use it. Tap a word → Explain: meanings, grammar, examples, the mistakes learners make and similar words, ready to save as a note.",
      },
      {
        title: "Understand a whole sentence",
        text:
          "Stuck on a sentence? Tap the lightbulb, then the first and the last word. You get what it says, its structure, the job of every word and the grammar points.",
      },
      {
        title: "Check your own Chinese",
        text:
          "Writing practice with feedback: Proof read points out real mistakes only, with the simplest fix, and one tap puts it into your note.",
      },
      {
        title: "You are in control",
        text:
          "Every AI answer shows what it cost. The AI settings are tidier now: essentials up front, prompts and technical options on their own pages (Settings → AI provider). You can tell the AI how you like things explained, and switch these release notes off in Settings → About.",
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

/**
 * What the "Show what's new" command opens: every note of the running minor line (0.9.0 and 0.9.1 for a 0.9.1), oldest
 * first, so someone can look back at the whole line on demand. The popup after an update shows each release only once;
 * this is the way back. A version whose line has no note of its own falls back to the newest note there is.
 */
export function notesOfLine(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const cur = baseVersion(current);
  const line = notesToShow("", current, notes).filter((n) => {
    const v = baseVersion(n.version);
    return cur !== null && v !== null && v[0] === cur[0] && v[1] === cur[1];
  });
  const latest = latestNote(current, notes);
  return line.length > 0 ? line : latest ? [latest] : [];
}

/** The newest note that is not newer than `current`. */
export function latestNote(current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote | null {
  const all = notesToShow("", current, notes);
  return all.length > 0 ? all[all.length - 1] : null;
}
