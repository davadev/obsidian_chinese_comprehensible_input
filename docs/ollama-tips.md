# Ollama: model choice and getting good output

The plugin's Ollama mode is the power-user path: you point it at your
own model, tune every knob, and pay nothing per request. The trade-off
is that **output quality depends almost entirely on the model**. This
page covers what we've observed in real use and the dial settings that
help.

## Model choice matters a lot

The biggest single lever is the model. Smaller models are faster and
free to run locally, but they have weaker Chinese and weaker instruction
following — they will **drop required target words**, ignore the HSK
ceiling, or generate noticeably more complicated Chinese than asked.

Rough guide:

| Model | Hardware | Behaviour |
|-------|----------|-----------|
| `gemma4:e4b` (~4B class) | Modest GPU / Apple Silicon with 8 GB+ | **Practical minimum.** Moderate output: instruction following is okay, occasionally drops a target word. Fine for daily practice when you don't have heavy hardware. |
| `gemma4:12b` | Decent GPU / Apple Silicon M-series with 16 GB+ | **Recommended when your machine can handle it** — what the developer runs daily. Output is consistently graded, target words reliably included. |
| `qwen2.5:14b`, `qwen2.5-coder:14b` | Same as above | Good Chinese-first alternative if Gemma doesn't fit your stack. |
| `qwen2.5:32b`, `llama3.1:70b` | Strong workstation / multi-GPU | Near-OpenAI quality on instruction following. Slow on consumer hardware. |
| Cloud (OpenAI GPT-5.4 mini) | n/a | See [OpenAI setup](./openai-setup.md) — best output, ~$0.21/month at one story/day. |

Below `gemma4:e4b`-class (e.g. 1–3B models) the output gets noticeably
worse — frequent missing target words, higher-HSK vocabulary than
asked, occasional non-Chinese filler. Usable for casual reading
practice but disappointing for graded stories.

The **Chat model** field in advanced AI settings is where you set this
(e.g. `gemma4:e4b` or `gemma4:12b`).

## Repair iterations rescue weaker models

Even a strong model occasionally drops a target word. The plugin
mitigates this with an automatic **repair loop**: after the first draft,
the validator checks every target word is present; if any are missing,
it sends a follow-up prompt with the prior draft and the missing list,
asking for a fix. This repeats up to **Max repair iterations** times.

For small models, raise this. Defaults to 4; bumping to 6 or 8 gives
weak models more attempts before giving up. The cost is generation time,
not money (Ollama is free).

For strong models (`gemma4:12b` and up, or OpenAI), 2 or 3 is usually
enough — repair rarely fires.

## "Send known words" helps beginners enormously

By default, the plugin sends the prompt + target words. The model has to
choose filler vocabulary on its own, and weaker models reach for
whatever Chinese they were trained on — often advanced.

Turn on **Send known words** in Story settings. The plugin includes a
sample of words you already know, and the model anchors its filler
vocabulary to that list. For beginners, set **Known-words sample %** to
**100** so the model sees your entire known-word inventory. The story
will read noticeably easier.

Trade-offs:

- Cost: on OpenAI, this adds input tokens (still pennies — see
  [openai-setup](./openai-setup.md) for the math).
- On Ollama, more input tokens make the first byte slower but cost
  nothing.

For HSK 5–6 learners, sending 30 % is usually enough — you have so many
known words that a sample suffices.

## Temperature

Default **Temperature** is 0.6. Lowering to 0.2–0.3 makes the model
stick more closely to the prompt and target-word list; raising to 0.8+
makes more creative but less reliable stories. For graded comprehensible
input, lower is usually better.

OpenAI mode uses 0.2 internally; that's why its grading feels tighter
than Ollama at default settings.

## Suppress thinking trace (qwen3 family)

Qwen3 models emit a long internal reasoning trace before they generate
output. The trace eats your **Max output tokens** budget and can leave
the answer empty when the budget runs out.

**Suppress thinking trace** is on by default. Leave it on unless you're
deliberately experimenting with the trace.

## Endpoint mode

`/v1/chat/completions` (OpenAI-compat) works for most setups. Pick
`Ollama native /api/chat` if you reach Ollama directly — some Ollama
builds expose CORS on `/api/*` but not `/v1/*`, which makes the
OpenAI-compat path fail with "Load failed" especially on iOS.

`/v1/responses` is OpenAI-only and doesn't apply to Ollama.

## Streaming

**Stream responses (SSE)** keeps the HTTP connection alive byte-by-byte
while the model generates. Required when the model is slow (a 32B
model on CPU can take a minute for the first token) or when the
connection passes through Tailscale, a corporate VPN, or a load balancer
that kills idle HTTP connections after 30–60 seconds.

Leave it on by default. Only turn it off if your reverse proxy chokes on
SSE.

## Structured output format

`json_object` (the default) is the broadest-compatibility choice. Use
`json_schema` for stricter validation on OpenAI or Ollama 0.5.7+. Use
`none` if both flags cause your provider to return empty.

Most users never touch this.

## Mobile / Tailscale tips

- `localhost` on the phone points to the phone. Use the LAN IP or
  Tailscale hostname of the Ollama machine.
- Streaming **must** be on for VPN/Tailscale to survive iOS's
  `timeoutIntervalForRequest`.
- If you hit "Load failed" on iOS even though desktop works, try the
  **Ollama native** endpoint mode — it bypasses some CORS preflight
  edge cases.

## See also

- [Story generation](./story-generation.md) — what Smart Story actually
  does end-to-end.
- [OpenAI setup](./openai-setup.md) — the "just works" alternative.
- [FAQ](./faq.md) — the top user issues in summary form.
