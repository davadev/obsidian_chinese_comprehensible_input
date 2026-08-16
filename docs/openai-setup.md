# OpenAI mode — setup, privacy, and cost

The OpenAI provider in Chinese Comprehensible Input is the "just works" path
to daily story generation: paste an API key and the plugin does the rest,
using **GPT-5.4 mini** under the hood. This page explains what that means
for your data, what it costs, and how to get an API key.

If you'd rather keep everything local, use the **Ollama** provider instead
— it runs on your own machine, no third party involved. The rest of this
document is only relevant if you've picked OpenAI.

---

## 1. What this mode does

When you generate a story (manually via Flashcards → Smart story, or
automatically once per day if you enable that), the plugin sends a prompt
to OpenAI's `chat/completions` endpoint and writes the returned Chinese
text to a note in your vault. The model is pinned to **GPT-5.4 mini** —
the cheapest current OpenAI model strong enough for graded Chinese
generation. You don't get to pick a different model from the OpenAI side
of the UI; if you want full control over model and prompts, run Ollama.

A configured provider also unlocks **Enhance** on the word popup card: tap it
to enrich a sparse dictionary entry with fuller senses and grammar info.

<p>
<img src="../resources/screenshots/mobile-enhance-before.png" alt="Sparse entry before Enhance" height="430">
&nbsp;
<img src="../resources/screenshots/mobile-enhance-annotated.png" alt="Annotated enriched entry after Enhance" height="430">
</p>

Before → after tapping **Enhance**: 1. a "Dictionary entry enhanced"
confirmation, 2. enriched definitions + grammar replacing the bare
"variant of…", and 3. a **Revert** button to undo it.

---

## 2. Privacy — your text leaves Obsidian

Every story generation sends the following to OpenAI's servers:

- The system prompt (a fixed instruction set in English).
- The list of **target words** the story should include (Chinese surface
  forms + pinyin + English glosses).
- Optionally, a sample of words you already know (only if
  `Send known words` is on in Story settings — off by default).
- On repair passes, the previous Chinese draft so the model can improve it.

The two per-word AI actions on the word popup send much less — one word
each, plus at most the sentence you tapped it in:

- **Enhance** — the word, its pinyin, its current dictionary definitions,
  and the sentence it appeared in.
- **Mnemonic ✨** — the word, pinyin, traditional form, HSK level,
  definitions, the sentence (when available), your existing mnemonic if
  any, and your own prompt template. See [Mnemonics](./mnemonics.md).

OpenAI's API terms (as of writing) state that API requests are **not used
to train OpenAI's models**, and data is retained briefly for abuse
monitoring before being deleted. Even so: this is a third-party service.
If your notes contain anything you don't want passing through OpenAI's
infrastructure, don't use this mode.

The plugin never sends your full vault, your vocabulary database, or any
note content you didn't explicitly target.

---

## 3. It costs money — but probably less than you think

OpenAI bills per token (roughly per word fragment). Pricing for
GPT-5.4 mini:

| What | Price per 1M tokens |
|------|---------------------|
| Input | $0.75 |
| Cached input | $0.075 |
| Output | $4.50 |

A typical story generation breaks down like this:

| Component | Tokens (typical) |
|-----------|------------------|
| System prompt | ~250 input |
| User prompt with 12 target words | ~350 input |
| First-attempt output (~400 Chinese chars + JSON envelope) | ~600 output |
| One repair pass (average across 0–4 reps) | ~1500 input + ~600 output |
| **Per story (average)** | **~2100 input + ~1200 output** |

Math: `(2100 × 0.75 + 1200 × 4.50) / 1,000,000 ≈ $0.0070` per story.

That works out to:

- **1 story per day → ~$0.21 / month, ~$2.55 / year.**
- Worst case (full 4 repairs every call, known-words sample on, longer
  stories) tops out around **$1 / month**.

You can verify in real time: Settings → AI provider → OpenAI shows a
**Your usage** widget with rolling 24h / 7d / 30d token counts and the
exact dollar cost. Every successful call updates it. No nasty surprises.

---

## 4. Get an OpenAI API key

You only do this once.

1. Go to <https://platform.openai.com/home>. Sign up if you don't have
   an account.
2. Open **Settings → Billing** and click **Add to credit balance**. Add a
   payment method and pre-pay an amount you're comfortable with — even
   **$5 will last roughly two years** at the rates above.
3. **Turn off auto-recharge** if you want a hard ceiling. It's in
   **Settings → Billing → Auto recharge** — useful if you'd rather decide
   manually when to top up than let OpenAI re-bill your card.
4. Go to <https://platform.openai.com/settings/organization/api-keys>
   and click **Create new secret key**. Give it a name like
   `obsidian-chinese-plugin`. **Copy the key right away** — OpenAI shows
   it exactly once and you can't view it again after closing the dialog.

---

## 5. Paste the key into the plugin

In Obsidian → Settings → **Chinese Comprehensible Input** → AI provider:

1. Make sure **Provider** is set to **OpenAI**.
2. Paste the key into **OpenAI API key**.
3. Click **Test connection**. You should see "AI provider reachable."

The key stays on this device only. It's written to Obsidian's per-vault
`localStorage` (via `app.saveLocalStorage`), **not** to `data.json` —
which means it's never copied into a vault sync (iCloud, Obsidian Sync,
remotely-save, etc.) and never lands in the settings-mirror or export
files. If you ever want to revoke it, delete the key on the OpenAI side
at the API-keys page above; the local copy becomes inert.

---

## 6. Verify end-to-end

Open the Stats view (left ribbon "中" icon → Flashcards tab) and click
**Generate story** under the Smart story panel. After a few seconds:

- A new note appears in your generated-stories folder.
- The **Your usage** widget ticks: input and output token counts go up,
  and the cost row shows a few cents.

If something fails, check the error notice and the developer console
(Cmd-Option-I on macOS). The most common cause is a typo in the key.

---

## See also

- [Documentation index](./index.md)
- [Frequently asked questions](./faq.md)
- [Ollama tips (the alternative provider)](./ollama-tips.md)
- [Story generation, end to end](./story-generation.md)
