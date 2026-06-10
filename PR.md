# PR: Chinese Comprehensible Input — Obsidian Plugin (V1)

## Research-backed design choices

### 1. Obsidian architecture and mobile compatibility

The plugin should be built from the official Obsidian sample plugin template. It is a TypeScript starter that demonstrates plugin lifecycle, commands, settings, modals, ribbon icons, events, intervals, and release packaging with `manifest.json`, `main.js`, and `styles.css`. It is licensed under 0BSD.

For mobile support, the key rule is: **do not use Node.js or Electron APIs at runtime**. Obsidian's mobile documentation says Node and Electron APIs are unavailable on mobile and can crash plugins. The manifest's `isDesktopOnly` field indicates whether the plugin uses Node.js or Electron APIs, so this plugin must set `isDesktopOnly: false`. Obsidian also documents mobile testing helpers such as `this.app.emulateMobile(true)` and `this.app.isMobile`, plus platform checks like `Platform.isIosApp` and `Platform.isAndroidApp`.

The dedicated Chinese learning view should be a custom editable file view. Obsidian custom views are registered with `registerView`, and Obsidian's docs recommend managing them through workspace leaves rather than manually storing view references. For an editable note-backed view, the agent should evaluate `TextFileView`, because Obsidian documents it as a plaintext editable file view whose custom editor can call `requestSave()` when content changes.

For the annotation layer, use CodeMirror 6 decorations. Obsidian's editor-extension docs describe mark, widget, replace, and line decorations, and specifically recommend a view plugin when decorations are determined from the visible viewport. That matters here because Chinese tokenization and ruby/popup annotation should be limited to visible ranges for performance, especially on mobile.

For plugin data and settings, use Obsidian's plugin data APIs and Vault-safe APIs, not Node filesystem APIs. Obsidian's docs describe `loadData()` and `saveData()` for persisted plugin settings/data, and the Vault docs recommend `Vault.process()` when modifying files to avoid accidental data loss.

Good implementation examples for the coding agent to study are the official sample plugin, a sample `TextFileView` plugin, a CodeMirror 6 decoration/plugin example, the Obsidian Spaced Repetition plugin for scheduling concepts, and Ollama/API plugins for local-AI settings patterns.

### 2. Dictionary and HSK data

Use **CC-CEDICT** as the core Chinese-English dictionary source. The current MDBG CC-CEDICT download page describes it as a downloadable Chinese-English dictionary with pinyin, currently listing more than 125,000 entries, and says the data is under CC BY-SA 4.0 with commercial and non-commercial use allowed when attribution/share-alike obligations are followed. The older CC-CEDICT wiki still references CC BY-SA 3.0, so the plugin should pin the exact downloaded archive and include its exact license/attribution in a `NOTICE` file.

For HSK levels, use **Complete HSK Vocabulary** as the first V1 candidate. It includes HSK 2.0 and HSK 3.0 data in JSON, with simplified/traditional, pinyin, meanings, level, frequency, POS, radicals, and classifiers, and its repository declares an MIT license. Because it also incorporates CC-CEDICT-derived definitions, the safest path is to use CC-CEDICT directly for dictionary definitions and use the HSK dataset primarily as an HSK/frequency/POS overlay, while preserving notices for both sources.

A secondary HSK 3.0 candidate is `ivankra/hsk30`, which provides cleaned HSK 3.0 vocabulary with pinyin, parts of speech, traditional forms, variants, and CEDICT matching keys. However, its own README flags licensing uncertainty around the original PRC standard source, so it is useful for comparison and validation but should not be the only legal basis for redistributed production data without further review.

The Chinese proficiency standard behind new HSK-style levels was released as GF0025-2021 and officially implemented from July 1, 2021; it uses a "three stages and nine levels" structure. The plugin should therefore store HSK source/version metadata and not hardcode "HSK level" as a permanent truth.

### 3. Word segmentation

Do not rely blindly on jieba-style segmentation. For this product, segmentation must match dictionary entries and learner status, not just generic natural-language tokenization. The V1 tokenizer should use a **dictionary-aware maximum-matching/lattice tokenizer** backed by CC-CEDICT + HSK + user overrides.

`Intl.Segmenter` is now a browser-native API for locale-sensitive word segmentation and can be used as a fallback or helper, but dictionary-aligned tokenization is still needed because the plugin must know which exact dictionary/HSK entry a tapped word maps to.

Pure browser-compatible libraries such as `segmentit` or `jieba-wasm` may be evaluated, but native Node packages should be avoided because mobile plugins cannot depend on Node/Electron runtime APIs. `segmentit` advertises browser/Electron support and MIT licensing; `jieba-wasm` is a modern WASM option, also listed as MIT, but its bundle size and mobile startup cost must be tested.

### 4. AI integration

For AI, design the provider layer around OpenAI-compatible HTTP APIs. Ollama explicitly provides OpenAI-compatible endpoints, including `/v1/chat/completions`, `/v1/responses`, `/v1/models`, and `/v1/embeddings`; its examples use `http://localhost:11434/v1/`, and the API key is ignored for local Ollama.

Use structured JSON output for generation and repair loops where the provider supports it. Ollama documents structured outputs via JSON schema and recommends using schemas, lower temperature, and OpenAI-compatible `response_format` to improve output reliability. OpenAI also documents structured outputs as schema-constrained responses, distinct from loose JSON mode.

---

## Coding agent brief

You are building an Obsidian plugin named "Chinese Comprehensible Input" for Chinese learners.

The plugin must work well on both Obsidian desktop and Obsidian mobile. Treat mobile compatibility as a hard requirement, not an afterthought.

### Primary product goal
Create an editable Chinese reading view inside Obsidian that turns any Chinese note into a learner-friendly, comprehensible-input environment. The plugin tracks which words the user knows, how often and when the user has seen each word, and uses spaced repetition plus optional AI generation to create personalized Chinese reading material instead of boring flashcards.

### Core user story
A learner opens a Chinese note in a special Chinese Learning View. The view keeps the note editable, but Chinese words behave differently from normal Obsidian editing. Unknown or partially known words can show pinyin, short definitions, colors, and popups. The user can quickly mark words as known or unknown. The plugin logs word exposure over time. Later, the plugin can generate daily Chinese stories/articles using words that are due for review, while keeping the rest of the language near the learner's approximate HSK level.

### Hard technical requirements
- TypeScript.
- Build from the official Obsidian sample plugin structure.
- `manifest.json` must include `isDesktopOnly: false`.
- Do not import or call Node.js APIs such as `fs`, `path`, `crypto` Node APIs, Electron APIs, native Node packages, or desktop-only APIs in runtime code.
- Avoid desktop-only assumptions such as hover-only UI, right-pane-only workflows, local filesystem paths, or tiny buttons.
- Must run on Obsidian desktop, iOS, and Android.
- Use browser-safe APIs and Obsidian APIs.
- Use lazy loading for dictionary/tokenizer data.
- Do not do heavy processing in plugin `onload`.
- Tokenize and annotate only visible editor ranges where possible.
- Do not corrupt user notes. Saving must be safe and debounced.
- Include migrations for persisted plugin data.

### Plugin commands
1. "Open current note in Chinese Learning View"
2. "Generate Chinese Review Story"
3. "Open Chinese Vocabulary Stats"
4. "Toggle Chinese mark-known mode"
5. "Toggle Chinese mark-unknown mode"
6. "Clear Chinese marking mode"

### Dedicated editable view
- Prefer `ChineseTextFileView extends TextFileView` if feasible.
- If `TextFileView` cannot support the required CodeMirror integration cleanly, implement a custom `ItemView` that owns a CodeMirror 6 editor and safely reads/saves the current `TFile`.
- The view must edit the underlying Markdown note.
- User text changes must save safely with debounce and must not overwrite external edits silently.
- Do not annotate YAML frontmatter, code blocks, inline code, math blocks, Markdown links' URLs, image embeds, or HTML tags.
- Annotate only Chinese text spans.

### Toolbar
Mode selector: Read / Edit text / Mark known / Mark unknown (mutually exclusive).
Display selector: Inline two-line, Inline three-line, Popup-only, Minimal color-only.
Toggles: known-word colors, partial-known colors, unknown-word colors.
Quick access: stats, AI story generation.

### Interaction design
Read mode: tap unknown/partial → popup; long-press on mobile; optional known-word popup.
Popup shows: word, simplified/traditional, pinyin, short + full definitions, HSK, seen count, last seen, sparkline, status, buttons (Mark known, Mark unknown, Know meaning but not pinyin, Know pinyin but not meaning, Ignore/proper noun, Add/edit mnemonic). Bottom sheet on small screens.

Edit mode: cursor editing; popups via long-press only.

Mark known/unknown modes: short tap marks; banner visible; don't move cursor; obvious exit.

### Word statuses
`new`, `known`, `unknown`, `meaningKnownPinyinUnknown`, `pinyinKnownMeaningUnknown`, `ignored`.

### Inline annotation
Word-level. Ruby-style. Two-line: pinyin. Three-line: pinyin + short gloss. Truncate gloss; full in popup. Auto-degrade to popup-only when annotation density too high. CSS variables theme-compatible. Underline/dotted shapes beyond color. Big tap targets.

### Dictionary
CC-CEDICT core + Complete HSK Vocabulary overlay. Include attribution/license. Preprocess into compact JSON at build. Trie lookup. Lazy load. Split by first char if memory tight.

### Tokenizer
`TokenizerService`. Dictionary trie, lattice scoring (exact > HSK > known > prior records > low ambiguity). User overrides persisted (split/merge/ignore). Optional engines: `Intl.Segmenter`, `segmentit`, WASM. No Node-native deps.

Edge cases: `研究生`/`研究`+`生`, `马上`/`马`+`上`, names, traditional/simplified, numbers/dates/measure words/punctuation, mixed CJK/English/emoji, repeated words, Markdown formatting, links, code/math/frontmatter exclusion.

### Vocabulary data model

```ts
type WordStatus =
  | "new"
  | "known"
  | "unknown"
  | "meaningKnownPinyinUnknown"
  | "pinyinKnownMeaningUnknown"
  | "ignored";

interface WordRecord {
  key: string;
  surfaces: string[];
  simplified?: string;
  traditional?: string;
  pinyin?: string;
  definitions?: string[];
  hsk?: { source: string; levels: string[] };
  status: WordStatus;
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount: number;
  recentSeenAt: string[];
  dailySeenCounts: Record<string, number>;
  mnemonic?: { text?: string; emoji?: string; imagePath?: string; story?: string; updatedAt?: string };
  srs?: { dueAt?: string; intervalDays?: number; ease?: number; stability?: number; difficulty?: number; lapses?: number; lastReviewedAt?: string };
  notes?: string;
  ignoredReason?: string;
  updatedAt: string;
}
```

Storage: `loadData`/`saveData`; `VocabularyStore` abstraction for later chunked-file migration; schema migrations; debounced writes; export/import (JSON + CSV with merge preview); exact recent timestamps + daily buckets indefinitely; settings for retention.

### Exposure tracking
Don't count merely from note open. Count when word visible ≥ configurable duration (800–1500 ms default), not in excluded zones, not repeated in same session. Settings for per-note/per-day caps. Popup lookups and generated-story reads count.

### Stats view
Search/filter/sort. Known/unknown/partial counts. Estimate learner HSK from coverage. Per-word details + daily exposure graph. SVG/Canvas, no heavy chart deps.

### SRS
`SrsScheduler` abstraction (SM-2-like or FSRS-lite). Schedule unknown/partial by default. Known optional. Ignored never. Natural reading exposures soft signal. Popup on due word = weak/failed recall. Mark-known on due = successful.

### AI provider
`AiProviderService` OpenAI-compatible. Settings: enabled, provider name, base URL (default `http://localhost:11434/v1`), API key, chat model, embedding model, endpoint mode (`/v1/chat/completions` or `/v1/responses`), temperature, max output tokens, timeout, max repair iterations, test connection, privacy warning, Ollama LAN-host note.

Plugin must fully work without AI configured.

### Story generation flow
1. Select due words.
2. User configures count (10–20 default), length, style, target HSK (auto/manual), known-coverage threshold, include glossary toggle.
3. Estimate learner level from known-coverage per HSK level.
4. Prompt LLM with due words, pinyin, definitions, target HSK, genre, "use every due word naturally", JSON schema output.
5. Validate output.
6. Repair loop on failure.
7. Save to configurable folder as Markdown.
8. Open in Chinese Learning View.

Output schema:
```json
{
  "title": "string",
  "targetLevel": "string",
  "textChinese": "string",
  "targetWordsUsed": [{ "word": "string", "used": true, "sentence": "string" }],
  "glossary": [{ "word": "string", "pinyin": "string", "definition": "string" }],
  "notesForLearner": "string"
}
```

Validate: segment textChinese, every due word present (allowing variants), is Chinese (not mostly English), unknown ratio under threshold, HSK distribution, length range, no pinyin/English inside Chinese unless requested, no unnatural overuse. Repair prompt: original text + missing words + too-difficult words + target HSK + revise instruction.

Save path: `Chinese Learning/Generated/YYYY-MM-DD - Review Story.md`.

Frontmatter:
```yaml
chinese_learning_generated: true
generated_at: ISO_TIMESTAMP
provider: PROVIDER_NAME
model: MODEL_NAME
target_hsk: HSK_LEVEL
target_words:
  - WORD1
  - WORD2
validation_score: NUMBER
```

Body: Chinese title, Chinese story, optional glossary, optional target word checklist, optional validation notes callout.

Prompt template:

System: "You are an expert writer of graded Chinese comprehensible input for adult Chinese learners. Write natural, engaging Chinese using simple grammar and vocabulary appropriate to the requested HSK level. Include all required target words naturally. Do not explain in English inside the story. Output valid JSON only matching the provided schema."

User: "Create a Chinese {story/article/dialogue} for a learner around {targetHskLevel}. Required target words: {word list with pinyin and definitions}. Use every required word at least once. For all other vocabulary, prefer words at or below {targetHskLevel}. Keep the story coherent, enjoyable, and not childish unless requested. Length: {length}. Return JSON only."

### Mnemonic
Word popup edit. Fields: short text, emoji, image path/link, mini story. Show before full definition if "mnemonics first" enabled. Export/import.

### Settings tab
Display mode, unknown/new behaviors, color toggles, pinyin style (tone marks/numbers/none), definition source, HSK source (2.0/3.0/both), tokenizer engine, exposure settings, SRS settings, AI settings, generated-story settings, data export/import, reset (with confirm), license/about.

### Mobile UX
No hover-only. Large tap targets. Bottom sheets. Toolbar above keyboard. No right-pane-only flows. Sparse default annotation on small screens. Test with emulation + real devices. Safe-area insets.

### Performance
Light `onload`. Lazy dictionary. Visible-range tokenization first. Cache per file/version/range. Invalidate on edits. Debounce. No full-file retokenize per keystroke. Test on 1k / 10k / 100k char notes.

### Source structure
```
src/
  main.ts
  constants.ts
  settings/{SettingsTab.ts,types.ts,defaults.ts}
  view/{ChineseTextFileView.ts,ViewToolbar.ts}
  editor/{chineseDecorations.ts,wordInteractionPlugin.ts,markdownExclusionRanges.ts}
  dictionary/{DictionaryService.ts,DictionaryTypes.ts,hskOverlay.ts,normalizeChinese.ts}
  tokenizer/{TokenizerService.ts,Trie.ts,latticeTokenizer.ts,tokenizerTypes.ts}
  vocabulary/{VocabularyStore.ts,VocabularyTypes.ts,migrations.ts,ExposureTracker.ts}
  srs/{SrsScheduler.ts,srsTypes.ts}
  ai/{AiProviderService.ts,StoryGenerator.ts,StoryValidator.ts,prompts.ts,aiTypes.ts}
  ui/{WordPopup.ts,MobileBottomSheet.ts,StatsView.ts,StatsGraph.ts,GenerateStoryModal.ts}
  data/{dictionary-manifest.json,hsk-manifest.json}
  tests/{tokenizer.test.ts,dictionary.test.ts,srs.test.ts,storyValidator.test.ts}
```

### Build/preprocessing
Scripts to compile raw dictionary/HSK to compact JSON. Don't bundle raw third-party data when licensing/size doesn't fit. `NOTICE.md` + attribution. Reproducible build instructions. Pin data versions and download dates.

### Testing
Unit: tokenizer ambiguity, dictionary lookup, simplified/traditional, HSK overlay, Markdown exclusion, exposure dedup, SRS due, AI validation.
Manual: open note in view, edit/save, mark modes, 100 quick marks, display modes, stats/graph, story w/ mock + Ollama, repair loop trigger, desktop/Android/iOS, no AI, no dictionary, very long note, dark/light themes.

### V1 Acceptance criteria
1. Installs and enables on desktop and mobile.
2. `manifest.json` has `isDesktopOnly: false`.
3. No Node/Electron APIs at runtime.
4. Open Markdown note in Chinese Learning View.
5. View edits and saves safely.
6. Dictionary-backed segmentation.
7. Pinyin/definition inline or popup for unknown/partial words.
8. Mark known/unknown via mutually exclusive modes.
9. Word status persists.
10. Exposure timestamps + daily counts persist.
11. Stats view + per-word exposure graph.
12. HSK metadata shown when available.
13. AI settings support OpenAI-compatible base URL including Ollama.
14. AI fully optional.
15. Story generation: select due → generate → validate → repair → save → open.
16. Dictionary/HSK licenses documented.
17. Mobile UI: bottom sheets, tap-friendly, no hover/side-pane reliance.

### Product judgment
Not mainly a flashcard plugin. Every choice should serve pleasurable reading and comprehensible input. Inline annotations help reading, never clutter. AI content feels like something the learner *wants* to read, quietly reintroducing due words.

### Release blocker
CC-CEDICT is usable under CC BY-SA terms, but final bundled data + attribution strategy must be verified before public release, especially since plugin code itself is MIT/0BSD and dictionary database is redistributed under CC BY-SA.
