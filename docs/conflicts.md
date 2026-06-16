# Conflict resolution between devices

When you sync vocabulary across devices through the vault mirror, both
devices may set conflicting statuses on the same word before the next
sync. This page explains how the plugin decides who wins.

## The single rule

When two devices disagree on a word's status, the plugin picks the
winner using your **Status priority** list in Sync settings. Whichever
status appears earlier in the list wins. That's it.

Default priority (top wins):

```
ignored
known
meaningKnownPinyinUnknown
pinyinKnownMeaningUnknown
charactersUnknown
unknown
new
```

So if device A says "known" and device B says "unknown" for `学习`, the
merge picks **known**.

## "New" always loses

Hardcoded rule that runs first: any side whose status is **new** loses
to any non-new status. This prevents the "I haven't really classified
this yet" pile from clobbering real signal on the other device.

If both sides are new, the priority list breaks the tie — but in
practice both-new means the plugin keeps its existing record.

## Why "ignored" is at the top

If you explicitly mark a word as ignored on one device — usually
because it's a name, junk, or content you don't care about — you almost
certainly don't want the other device to undo that. So ignored wins
over everything.

## Reordering the priority list

The Sync settings tab shows your priority list with up/down buttons.
Reorder to taste. Common tweaks:

- **Beginners**: put `partial` flavors above `known`. Conservative —
  the device that said "this is partial" wins, you reconfirm later.
- **Power users**: put `unknown` above `partial`. If one device says
  "no I don't know this," that beats a soft "partial" from elsewhere.

There's no wrong answer; pick the one that matches your gut for which
device to trust.

## Other fields in the merge

Status is the conflict-prone field. For other per-word data:

- **Surfaces** — union of both lists, deduped.
- **Seen count** — sum-of-deltas since last merge: the count never
  goes down.
- **Last-seen timestamp** — whichever is more recent wins.
- **Daily counts** — both devices' daily buckets merge per-date.

These don't need a priority list because they aren't subjective — they
either accumulate (seen count, surfaces) or follow time (last-seen).

## How to tell something was merged

The Stats view → **Words** tab is the easiest place to spot post-merge
state. A word that was just merged shows the most-recent status across
all devices that touched it.

If something looks wrong (you set "unknown" on phone, but desktop still
says "known" after sync), check:

1. Did the mirror file actually update? Settings → Sync → mirror path,
   look at the file's mtime.
2. Did the other device merge yet? Switch to another tab + back, or use
   **Force re-sync now**.
3. Is your priority list set the way you think? The default puts
   `known` above `unknown`, so if you wanted the more recent change to
   win regardless of status, you'd need a different priority order or
   to explicitly downrank `known`.

## See also

- [Vault-mirror sync](./sync-mirror.md) — what's being merged.
- [Word states](./word-states.md) — the status taxonomy.
- [FAQ](./faq.md)
