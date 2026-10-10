# Vault-mirror sync

If you use the plugin on more than one device — desktop + phone, or
work desktop + home desktop — you probably want your vocabulary and
settings to follow you. There's a built-in way to do that. This page
explains why it works the way it does and how to set it up.

## The problem

Obsidian plugins store their data inside `.obsidian/plugins/<plugin-id>/`.
That folder contains the plugin's data blob, the compiled JavaScript,
hot-reload markers, and per-device caches.

Many people deliberately don't sync `.obsidian/` across devices because:

- It carries platform-specific files (e.g. Workspace state) you don't
  want clobbering each other.
- Plugin binaries vary by device.
- Some sync tools (iCloud, OneDrive) struggle with hidden folders.
- BRAT writes builds there.

So the plugin's data blob never reaches the other device, and your
vocabulary lives one place and your reading lives another.

## The solution: vault-mirror sync

When enabled, the plugin writes a JSON file **inside your vault** (i.e.
*outside* `.obsidian/`) that contains the vocabulary store. Any sync
tool that already moves your notes around — Obsidian Sync, remotely-save,
Nextcloud, iCloud Drive, Syncthing, Dropbox — handles this JSON file
like any other note. The other device's plugin notices the file change,
merges it into the local store, and you're back in sync.

There's a separate switch for settings, since some people want to sync
vocabulary but keep settings device-local (e.g. different display
preferences on phone vs desktop).

## Settings under Sync

### Mirror enabled

Default **off**. Turn on to start writing the vocabulary mirror at
**Mirror path** (default `Chinese Learning/vocabulary.json`).

### Mirror path

Default `Chinese Learning/vocabulary.json`. Pick somewhere your sync
tool already covers. Putting it next to your generated stories works
well — they're synced anyway.

### Mirror poll interval (minutes)

Default **5**. The plugin re-hashes the mirror file every N minutes and
merges if it changed. This is a backup; the Obsidian vault's
file-modify watcher usually catches changes immediately. Bump to 15+ if
you want fewer disk reads.

### Settings mirror enabled

Separate from vocabulary mirror. When on, writes a sanitized copy of
your settings to **Settings mirror path** so two devices can share
display + behavioral preferences.

### Settings mirror path

Default `Chinese Learning/cci-settings.json`.

## What gets filtered out

The mirror is **not** a full settings dump. The plugin strips:

- **API keys** (OpenAI, Ollama bearer) — these live in your device's
  per-vault localStorage, never in any vault file. Pasted on each
  device separately.
- **Sync configuration itself** — mirror enabled / path. Otherwise one
  device would clobber another's "I don't want sync" choice.
- **Per-device install flags** — dictionary download manifest, vault
  index marker, crash counters.
- **Bootstrap helpers** — `hskColorsDerivedFromAccent` (which is a
  first-launch derivation that should be per-device).
- **Per-device screen and safety choices** — E-ink mode and its size,
  and the backup settings (automatic backups on/off, how many to keep).
  See [Backups](./backups.md) for how a restore interacts with the mirror.

You can inspect what would be shared by opening the settings-mirror
file in your vault and looking at the JSON.

## If your sync tool reports errors on the mirror file

The mirror file can be several megabytes, and it is rewritten a few seconds after the data it holds changes. To be
gentle with sync tools the plugin:

- **does not rewrite the file when its content has not changed** (reading a note changes counts often, but the file only
  moves when what it holds has changed);
- by default writes a temporary file (`vocabulary.json.tmp`) and renames it into place, so a sync tool never sees a
  half-written file;
- tells you once, in a notice, if the path you chose is a **folder** instead of a file.

Some tools cope better with the file simply being rewritten. Remotely Save pushing to Nextcloud over WebDAV has been seen
answering `405 Method Not Allowed` for the mirror file. If that happens, turn on **Settings → Sync → Write the mirror file
in place**: the plugin then writes the file directly, with no temporary file and no delete-then-rename. It is a per-device
choice, never shared between devices. If the error continues, check that nothing on the server is a *folder* with the
same name as the file.

## Devices with different dictionaries

A word is stored under a key made of the word and its pinyin (`差不多|chà bu duō`), and the pinyin comes from the
dictionary the device had when it first met the word. A device that has downloaded CC-CEDICT and one that only has the
small built-in seed dictionary can therefore hold the same word under two keys, the second one without pinyin. Until
0.8.0-beta.5 the two were never combined, and a word marked known on one device could keep showing as new on the other.

Now, whenever data is loaded or merged from the mirror, a record without pinyin is folded into the single pinyin record
for the same word (its status, counts and notes are merged by the same rules as any sync, and the pinyin key is the one
that survives, so every device agrees). Words with several readings (差 chā / chà / chāi) are left as they are, because
which reading a bare record belongs to would be a guess. If you see one of those split, download the dictionary on every
device (Settings → Dictionary) so all of them key the word the same way.

## Setup walkthrough

1. Ensure your sync tool already covers your vault and reaches both
   devices.
2. On device A: Settings → Sync → turn on **Mirror enabled**. Optionally
   turn on **Settings mirror enabled**.
3. Wait for the sync tool to push the file. Verify on device B that the
   JSON file appears in the vault.
4. On device B: turn on the same toggles. The plugin reads the mirror
   on next launch (or active-leaf change) and merges.

Going forward, every change on one device flows to the other through
the mirror file.

## Force re-sync

If a device gets out of step, the **Force re-sync now** button rebuilds
the mirror from the local vocabulary store and pushes immediately. Use
sparingly — it skips conflict detection.

## What if two devices change the same word at the same time?

That's covered by [conflict resolution](./conflicts.md).

Whatever the rule, both devices reach the **same answer**: the merge gives the same result whichever device is
doing the merging, so a disagreement is settled once and then both sides go quiet instead of rewriting the file at
each other. For the descriptive fields (`definitions`, `pinyin`, `hsk`, `notes`, …) the record edited later wins; if
the timestamps are equal, the value that sorts first wins. `surfaces[0]` (the form you first met the word in) comes
from the device that saw the word first; the other surfaces are kept sorted.

## See also

- [Conflict resolution](./conflicts.md)
- [Word states](./word-states.md) — what's being mirrored.
- [FAQ](./faq.md)
