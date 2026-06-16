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

You can inspect what would be shared by opening the settings-mirror
file in your vault and looking at the JSON.

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

## See also

- [Conflict resolution](./conflicts.md)
- [Word states](./word-states.md) — what's being mirrored.
- [FAQ](./faq.md)
