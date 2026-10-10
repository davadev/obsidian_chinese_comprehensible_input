# Backups, and going back to an older version

The plugin keeps your vocabulary, settings and dictionary edits in one data file. Updating the plugin, especially to a
beta, can change that file, and **going back to an older release through BRAT does not undo what the newer one did to
it**. An older version reading data written by a newer one can also misread it. So the plugin saves a copy of its data
by itself before the version changes, and if you later go back, it offers to put that copy back.

## What happens, step by step

1. **The first time a new version runs**, it first saves a copy of the data as the *previous* version left it. Nothing
   else is touched before that copy is safe. If the copy cannot be made (disk full, say), you get a notice, your data is
   left alone, and it tries again at the next start.
2. **If you go back to an older version** that has this feature (through BRAT or by hand), it notices that the data was
   last written by a newer one and asks:
   *"You went back from X to Y. Restore your data from before X (date)? Anything you did in X, such as words you marked,
   will be lost."*
   - **Restore** queues the restore. It takes effect when you **restart Obsidian** (or turn the plugin off and on). It
     is done at the very start of the next launch, before anything is loaded, so nothing can overwrite it.
   - **Keep current data** leaves everything as it is and stops asking.
   - **Decide later** changes nothing and asks again at the next start.
3. **Every restore can be undone.** Before a restore is applied, the data as it is at that moment is saved as its own
   backup, in the list under *Settings → Data → Backups*.

## What is in a backup

- The plugin's whole data file: settings, vocabulary, SRS state, exposure history, your dictionary edits and custom
  words. API keys are not in it (they never are; they live in your device's local storage).
- If you use the **sync mirror**, this device's mirror files as well (see the limit below).
- **Not** the CC-CEDICT dictionary file (it is re-downloadable), **not** your notes, and **not** sync-conflict files.

## Where the copies are

In the plugin's own folder, under `backups/` (`.obsidian/plugins/chinese-comprehensible-input/backups/`), compressed
with gzip where your device supports it. They are **never** written into your vault, so they do not show up as notes and
sync tools do not upload them as notes. They are meant to stay on this device. If you sync your whole `.obsidian`
folder, they travel with it like any other plugin file.

## Settings → Data → Backups

Backups are a page of their own inside the **Data** group, next to export, import and reset, so the list does not make the main settings page longer. Open it with the *Backups* entry.

- **Automatic backups** (on by default) and **Backups to keep** (5 by default).
  The newest copies are kept, **plus always the newest one written by a stable release**. That is deliberate: ten betas
  in a day would otherwise push out the one copy that leads back to the stable version.
- **Back up now** (also the command *Back up plugin data now*) saves a copy straight away. If nothing has changed since
  the last copy it says so instead of storing a duplicate.
- **The list**: when each copy was taken, which version's data it holds, its size, a **Restore** button and a **Delete** button.
  Delete asks first and cannot be undone. It removes the copy from the list and its file from the plugin folder, and withdraws a restore that was queued for it. The newest copy written by a stable release is marked *your way back to the stable release*, and deleting it gets a stronger warning: without it you cannot return to that release's data. Automatic clean-up will then keep the next-newest stable one instead.

These two settings belong to this device. They are not shared through the settings mirror and not included in the
settings export.

## The limits, plainly

- **Only versions that have this feature can restore.** Going back to a release from before it (0.7.9 or earlier) cannot
  be undone this way. The protected range starts at the first stable release that includes backups.
- **Sync can undo a restore.** The vault-mirror merge only ever takes the larger value or the union, so if the mirror
  file, or another device, still holds what the newer version produced, the next merge can bring some of it back.
  Restoring a backup that includes the mirror files rewrites this device's mirror files too, which removes the main
  source on this device. For a full revert, pause sync, restore the same copy on every device, then resume.
- **It protects this device's copy of the plugin data.** It does not protect your notes, and it cannot help if a bad
  version corrupted the data and that corruption has already synced to every device.
- **Restoring takes a restart.** Restoring inside a running plugin is not safe (the old data is held in memory in
  several places and would be written back over the restored file), so the restore is applied at the next start.
- A copy is skipped when the data is byte-for-byte the same as the newest copy.

## Troubleshooting

- *"Could not back up your data before this update"*: the notice says why (usually disk space or permissions). Your data
  is untouched, and the plugin tries again at the next start.
- *No restore was offered after I went back a version*: the older version must itself contain this feature, and a backup
  written by that version or older must exist (see the list).
- *I restored and want to undo it*: Settings → Data → Backups → pick the newest entry labelled "before a restore" → Restore →
  restart.
- *The Backups page is missing after an update through BRAT*: a new settings page appears only after a full
  restart of Obsidian (on iPad, swipe the app away).
