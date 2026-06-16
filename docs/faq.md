# Frequently asked questions

Quick answers to the top questions. Each one links into a deeper guide
when there's more to say.

## The generated story skipped some of my review words

Two common causes:

1. **The model is too small for the task.** Sub-4B Ollama models often
   miss one or two of the required target words even when the prompt
   explicitly lists them. The plugin has a built-in **repair loop** that
   asks the model to fix its draft; bumping **Max repair iterations** to
   4 or 5 gives it more attempts. If even then the model can't include
   every word, switch to a stronger model — `gemma4:e4b` is a practical
   minimum, `gemma4:12b` is the recommended sweet spot if your hardware
   can handle it, or use OpenAI. See
   [Ollama tips](./ollama-tips.md#model-choice-matters-a-lot) for the
   full model table.
2. **Too many target words at once.** The default is 12. With 20+ target
   words in one ~400-character story, even strong models struggle to
   thread every one of them naturally. Lower the **Default due count**
   in Story settings or accept that some passes will need a repair.

More: [Ollama tips](./ollama-tips.md) ·
[Story generation](./story-generation.md).

## The generated Chinese is too hard for me

Three knobs to try, in order:

1. Set **Target HSK level** lower when generating. For beginners, HSK 2
   or 3 is gentler than the default "auto."
2. Turn on **Send known words** in Story settings. The model gets a
   sample of words you already know and tends to lean on them as filler
   vocabulary. Boost **Known-words sample %** to 60–100 for stronger
   anchoring (costs more tokens on OpenAI, but worth it for new
   learners).
3. Pick a stronger model. Small Ollama models pad with high-HSK words
   because they don't have a great sense of frequency. OpenAI GPT-5.4
   mini handles graded Chinese well at a low cost.

More: [Ollama tips](./ollama-tips.md).

## Story generation hangs or times out

Most often this is a slow or unreachable AI endpoint, not the plugin.

- **Test connection** in AI settings — if that fails, your URL or API
  key is wrong.
- For Ollama over Tailscale / VPN, make sure **Stream responses (SSE)** is
  on. Streaming keeps bytes flowing so corporate / VPN timeouts don't
  fire while the model is still thinking.
- For very long stories on small Ollama models, bump **Timeout (ms)** in
  the advanced AI settings.
- If you suspect something is hanging silently, flip on **Verbose AI
  debug notifications**. It shows you each milestone (HTTP status, first
  byte, streaming chunks).

## Why is this word colored yellow / partial when I already know it?

Yellow / "partial" means *something* about the word isn't fully known yet
— either the pinyin, the meaning, or just one character. Long-press the
word and bump it to **Known** if you actually own it; the next reading
will show it in its full-known color (or no color at all, if you have
**Show known color** off).

More: [Word states](./word-states.md).

## Sync isn't picking up changes from my other device

You probably need the **vault-mirror sync** workaround. Many users don't
sync `.obsidian/` across devices (it carries cache, hot-reload state,
binary builds), which means the plugin's data blob doesn't travel.

Turn on **Mirror enabled** in Sync settings. The plugin writes a JSON
file inside your vault that any sync mechanism (Obsidian Sync,
remotely-save, iCloud, Dropbox, Nextcloud) handles like any other note.

More: [Vault-mirror sync](./sync-mirror.md) · [Conflicts](./conflicts.md).

## Auto daily story doesn't fire

Check, in order:

1. **AI provider → Enabled** is on.
2. Story → **Auto-generate a daily story** is on.
3. The configured **Auto-generate time** has actually passed today.
4. You haven't already generated today (the plugin keeps one per day).
5. The AI endpoint is reachable (try **Test connection**).

The plugin retries every 30 minutes if the AI is briefly unreachable;
failures don't carry across midnight.

## My HSK colors look the same as my Obsidian accent

That's on purpose — first install derives the HSK palette from your
active accent color so it doesn't look like a random rainbow. You can
override every level under **Custom colors** in display settings.

More: [Display modes](./display-modes.md).

## I'm on mobile and Ollama / localhost doesn't work

`localhost` on the phone points at the phone, not your desktop. Use the
LAN IP of the Ollama machine (e.g. `http://192.168.1.10:11434/v1`) or
expose it over Tailscale and use the tailnet hostname. **Stream
responses (SSE)** must be on for VPN/Tailscale to work without timing
out.

## I want to fund this project

Funding is not currently wired up. If you'd like to support development,
star the repo and file good bug reports — they're more useful than
money.

## See also

- [Documentation index](./index.md)
- [Ollama tips](./ollama-tips.md)
- [OpenAI setup](./openai-setup.md)
- [Vault-mirror sync](./sync-mirror.md)
