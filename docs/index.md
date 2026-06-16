# Documentation

Everything you might want to know about the **Chinese Comprehensible Input**
plugin, broken into short pages by topic. Most of these are linked from
the matching settings section inside Obsidian — but you can also browse
the whole tree from here.

## Start here

- [Install via BRAT (or manually)](./install.md) — how to get the
  plugin into your vault and keep it updated.
- [Frequently asked questions](./faq.md) — the top issues users run
  into and where to find the fix in the rest of these docs.
- [Community plugin submission](./community-plugin-submission.md) —
  final release and submission checklist.
- [README](../README.md) — what the plugin actually does, screenshots,
  install steps.

## AI and story generation

- [OpenAI setup, privacy, and cost](./openai-setup.md) — pasting an API
  key, what gets sent, what the monthly bill looks like.
- [Ollama tips: picking a model and getting good output](./ollama-tips.md)
  — practical minimum is `gemma4:e4b`, recommended is `gemma4:12b`;
  when to bump repair iterations, when to enable "Send known words."
- [Story generation, end to end](./story-generation.md) — what Smart
  Story actually does, how the repair loop validates, the YAML
  frontmatter on generated notes.

## Reading and vocabulary

- [Display modes and colors](./display-modes.md) — two-line, three-line,
  none; pinyin styles; which color toggles control what.
- [Word states (new / partial / known / unknown / ignored)](./word-states.md)
  — the full status taxonomy, what each color means, how to mark words
  from the Chinese view.
- [Exposure tracking](./exposure.md) — what counts as "seeing" a word,
  the dedup rules, how exposure pushes a word toward known.
- [Spaced repetition](./srs.md) — how reviews get scheduled and which
  knobs to touch first.

## Sync across devices

- [Vault-mirror sync (the workaround if you don't sync .obsidian/)](./sync-mirror.md)
  — why this exists, vocab mirror vs settings mirror, what's filtered
  out.
- [Conflict resolution between devices](./conflicts.md) — what happens
  when two devices set different statuses on the same word, how the
  priority list is used.

## See also

- [Source on GitHub](https://github.com/davadev/obsidian_chinese_comprehensible_input)
- File an issue: [GitHub issues](https://github.com/davadev/obsidian_chinese_comprehensible_input/issues)
