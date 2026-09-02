# Traditional Chinese and regional pronunciation

The plugin can read Traditional Chinese (Taiwan / Hong Kong) as well as
Simplified. Turn it on under **Settings → Script & region → Text script**, or
tick **Traditional characters** in the reading view's ⋯ menu.

If you open a note that is plainly Traditional while the plugin is set to
Simplified, it offers to switch. It never switches on its own.

## What changes

**Words are recognised.** With Simplified selected, the tokenizer only knows
Simplified headwords, so 台灣的天氣很熱 falls apart into single characters:

```
台 | 灣 | 的 | 天 | 氣 | 很 | 熱
```

With Traditional selected it indexes both scripts, so you get real words with
pinyin, definitions and colours:

```
台灣 | 的 | 天氣 | 很 | 熱
```

Both scripts stay indexed — it is a union, not a swap — so a vault holding
notes of both kinds keeps working without a per-note switch.

**Your vocabulary is shared.** 學習 and 学习 are one word. Mark either as
known and both are known, everywhere. This was already true before this
release; what changed is that multi-character Traditional words are now
actually recognised, so the records get used.

**Generated stories follow.** With Traditional selected the AI is asked for
Traditional characters *and* Taiwanese Mandarin usage — 網路 rather than
網絡, 影片 rather than 視頻. Asking only for the characters gives you Mainland
vocabulary in Traditional clothing, which reads wrong.

## Regional pronunciation

**Settings → Script & region → Pronunciation** switches to the Taiwan reading
wherever the dictionary records one:

| Word | Mainland | Taiwan |
|------|----------|--------|
| 垃圾 | lā jī | lè sè |
| 質 | zhì | zhí |
| 蝸牛 | wō niú | guā niú |

About 500 words are covered — every one CC-CEDICT records. Everything else
keeps its Mainland reading.

**This does not cover the neutral-tone difference**, which is the difference
you actually hear most. Taiwan Mandarin keeps a full tone where the Mainland
neutralises it — 謝謝 xièxiè, 東西 dōngxī, 先生 xiānshēng, 朋友 péngyǒu,
休息 xiūxí — and CC-CEDICT records no Taiwan reading for any of them. There is
no data to drive it from, so the plugin does not guess.

Zhuyin / Bopomofo (ㄅㄆㄇㄈ) is not supported yet.

## Your notes are never rewritten

Switching script changes how the plugin *reads* your notes and what the AI
*writes*. It never edits a note. A note written in Simplified stays Simplified
on screen.

For the same reason, the plugin does not convert words between scripts for
display. A word you have only ever met in Simplified keeps showing in
Simplified on its flashcard, even in Traditional mode.

That is deliberate, not a shortcut. 1,078 Simplified headwords map to more
than one Traditional form, and the dictionary has no frequency data to choose
between them:

| Simplified | Really is | Naive conversion gives |
|-----------|-----------|------------------------|
| 发 | 發 (emit) or 髮 (hair) | 發 — wrong for 头发 |
| 干 | 乾 (dry) or 幹 (to do) | 乹, an obsolete variant |
| 历 | 歷 | 厤, an obsolete variant |
| 里 | 裡 in Taiwan | 裏, the Hong Kong form |
| 钟 | 鐘 (clock) or 鍾 (surname) | 鍾 |

Showing you what you actually read is the honest answer. When the mapping *is*
unambiguous, the other form appears in the word popup.

## Known limits

- **HSK is a Mainland standard.** The HSK colours, the "Top HSK" label and the
  story difficulty level are all calibrated to a syllabus a Taiwan learner does
  not use. TOCFL levels are not supported.
- A word absent from the dictionary — a proper noun, or one you added yourself
  — is tracked per written form, so a Traditional-only entry and its Simplified
  twin stay separate records.
- A mnemonic is stored once per word, so one written for 學習 also shows when
  you read 学习.
- Traditional mode holds a larger index in memory (roughly 24 MB more), which
  is worth knowing on an older iPad.
- Hong Kong material mostly works — 裏, 麪 and the other HK-preferred variants
  are all indexed — but Cantonese vocabulary and readings are not covered.
