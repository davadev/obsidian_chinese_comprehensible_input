# Install via BRAT

Chinese Comprehensible Input is not yet in the official Obsidian
community-plugin store. For now, the cleanest install path is **BRAT**
(Beta Reviewers Auto-update Tool) — it pulls the plugin straight from
this repository's GitHub releases and keeps it up to date for you.

Works on both desktop and mobile.

## 1. Install BRAT

BRAT is itself a community plugin.

1. Open Obsidian → **Settings** → **Community plugins**.
2. If you've never used community plugins before, click **Turn on
   community plugins** first.
3. Click **Browse**, search for **BRAT**, and install it.
4. Back in Community plugins, enable **BRAT**.

## 2. Add this plugin as a BRAT beta

1. Open **Settings** → **BRAT** (it shows up as its own section once
   enabled).
2. Click **Add Beta plugin**.
3. Paste the GitHub repository URL:
   ```
   https://github.com/davadev/obsidian_chinese_comprehensible_input
   ```
4. Leave **Enable after install** checked.
5. Click **Add Plugin**.

BRAT downloads the latest release (`main.js`, `manifest.json`,
`styles.css`) into your vault's
`.obsidian/plugins/chinese-comprehensible-input/` folder and asks
Obsidian to load it.

## 3. Confirm it's running

- Open Settings → Community plugins. **Chinese Comprehensible Input**
  should appear in the list with its toggle on.
- Open Settings → **Chinese Comprehensible Input**. You should see the
  plugin's own settings tab — Display, Tokenizer, Exposure, SRS, AI
  provider, etc.

If you don't see the settings tab, try disabling and re-enabling the
plugin from Community plugins; on mobile, fully quitting and reopening
Obsidian once helps.

## 4. Update to new versions

BRAT checks once at Obsidian launch and re-pulls if there's a newer
release. You can also force a check:

- Settings → BRAT → **Check for updates to all beta plugins**.

If you don't want auto-updates, BRAT lets you freeze a specific
version: Settings → BRAT → click your plugin entry → **Don't auto-update**.

## 5. First-run setup inside the plugin

After install, take a minute to:

1. Open the plugin's settings tab.
2. Optionally download CC-CEDICT (Dictionary section → **Download
   CC-CEDICT**) so the tokenizer has a real dictionary to chew on. The
   tiny seed dictionary that ships in `main.js` is for first-paint only.
3. If you want AI story generation, configure your provider — see
   [OpenAI setup](./openai-setup.md) or [Ollama tips](./ollama-tips.md).
4. Open a Chinese-language note and switch its view to **Chinese
   Learning** (the 中 icon in the right of the note header on desktop,
   or the ribbon button on mobile). See [display modes](./display-modes.md)
   for what the different view options do.

## Troubleshooting

**BRAT says "release assets missing"** — that means the latest GitHub
release didn't ship `main.js` / `manifest.json` / `styles.css`. File an
issue; until it's fixed, BRAT can pin to an earlier release that does
have them.

**Plugin loads but no Chinese view button appears** — close + reopen
the note. The injected button sometimes misses if the file opened
before the plugin finished loading.

**Mobile install hangs** — make sure BRAT itself is up to date; older
BRAT versions had iOS download issues that the maintainers fixed in
late 2025.

## Manual install (alternative to BRAT)

If you can't use BRAT, you can install the plugin by hand:

1. Download the three release assets from the
   [latest release](https://github.com/davadev/obsidian_chinese_comprehensible_input/releases/latest):
   `main.js`, `manifest.json`, `styles.css`.
2. Drop them into
   `<your-vault>/.obsidian/plugins/chinese-comprehensible-input/`
   (create the folder if it doesn't exist).
3. Restart Obsidian. Enable the plugin under Settings → Community
   plugins.

Manual install doesn't auto-update; you'd repeat the download whenever
a new release lands. BRAT is much less hassle.

## See also

- [Documentation index](./index.md)
- [Frequently asked questions](./faq.md)
- [OpenAI setup](./openai-setup.md)
- [Ollama tips](./ollama-tips.md)
