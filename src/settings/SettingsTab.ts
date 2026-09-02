import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  SettingDefinitionEmpty,
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingDefinitionRender,
  normalizePath,
} from "obsidian";
import type CciPlugin from "../main";
import { indexVaultWithNotice } from "../vocabulary/VaultIndexer";
import { renderStatusPriorityList } from "./StatusPriorityList";
import { renderFormatOptionsList } from "./FormatOptionsList";
import { orderedFormatOptions } from "../editor/formatOptions";
import {
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_SETTINGS,
  DEFAULT_STATUS_PRIORITY,
  DEFAULT_TEXT_COLORS,
} from "./defaults";
import { DEFAULT_MNEMONIC_USER_TEMPLATE } from "../ai/prompts";
import { deriveHskColorsFromAccent } from "../ui/colorTheme";
import { VOCAB_MIRROR_PATH_DEFAULT } from "../constants";
import { WordStatus } from "../vocabulary/VocabularyTypes";
import {
  exportSettings,
  importSettings,
  SETTINGS_EXPORT_DEFAULT_PATH,
} from "./SettingsIO";
import { getByPath, setByPath } from "./settingsPath";
import {
  OPENAI_MODEL_DESC,
  OPENAI_MODEL_DISPLAY,
  OPENAI_PRICE_PER_1M,
  computeOpenAiCostUsd,
} from "../ai/openaiProfile";
import { loadApiKey, saveApiKey } from "../ai/secrets";
import { confirmAsync } from "../ui/confirmInput";

const DOCS_BASE =
  "https://github.com/davadev/obsidian_chinese_comprehensible_input/blob/main/docs/";

/** Keys whose value is stored somewhere other than `plugin.settings`.
 *  `secret:` → Obsidian's device-local key store (never data.json).
 *  `ui:` → transient state of this tab (export / import paths). */
const SECRET_PREFIX = "secret:";
const UI_PREFIX = "ui:";

/**
 * Declarative settings tab (Obsidian 1.13+).
 *
 * `getSettingDefinitions()` describes every setting, which is what makes
 * them findable in Obsidian's settings search. `display()` is deliberately
 * NOT implemented: Obsidian skips it whenever definitions are returned, and
 * `manifest.minAppVersion` is 1.13.0 so there is no older host to fall back
 * for.
 *
 * Values are read and written through `getControlValue` / `setControlValue`
 * below, which map a flat `key` onto this plugin's nested settings object.
 */
export class CciSettingsTab extends PluginSettingTab {
  /** Transient, not persisted: the paths typed into the backup/restore rows. */
  private exportPath = SETTINGS_EXPORT_DEFAULT_PATH;
  private importPath = SETTINGS_EXPORT_DEFAULT_PATH;

  constructor(app: App, private plugin: CciPlugin) {
    super(app, plugin);
  }

  // ─────────────────────────── value plumbing ───────────────────────────

  getControlValue(key: string): unknown {
    if (key.startsWith(SECRET_PREFIX)) {
      const provider = key.slice(SECRET_PREFIX.length);
      return loadApiKey(this.plugin.app, provider === "openai" ? "openai" : "ollama");
    }
    if (key === UI_PREFIX + "exportPath") return this.exportPath;
    if (key === UI_PREFIX + "importPath") return this.importPath;
    // The slider works in whole percent; the setting stores a 0..1 fraction.
    if (key === "topHskComfortThreshold") {
      return Math.round((this.plugin.settings.topHskComfortThreshold ?? 0.67) * 100);
    }
    return getByPath(this.plugin.settings, key);
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    if (key.startsWith(SECRET_PREFIX)) {
      const provider = key.slice(SECRET_PREFIX.length);
      saveApiKey(this.plugin.app, provider === "openai" ? "openai" : "ollama", String(value));
      return;
    }
    if (key === UI_PREFIX + "exportPath") {
      this.exportPath = String(value).trim() || SETTINGS_EXPORT_DEFAULT_PATH;
      return;
    }
    if (key === UI_PREFIX + "importPath") {
      this.importPath = String(value).trim();
      return;
    }
    if (key === "topHskComfortThreshold") {
      this.plugin.settings.topHskComfortThreshold = Number(value) / 100;
    } else {
      setByPath(this.plugin.settings as unknown as Record<string, unknown>, key, value);
    }
    return this.persist(key);
  }

  /**
   * Save, then run the side effects the imperative handlers used to run
   * inline. Refreshing both view types on every change is cheap (they
   * redecorate in place) and removes a whole class of "changed a setting,
   * the reader didn't notice" bugs; only the sync keys need extra work.
   */
  /**
   * A vault index built under the other script tokenized every note in the
   * script it did not know about into single characters. Re-indexing adds
   * the correct multi-character records; it does not remove the old
   * single-character ones, which are real words in their own right.
   */
  private offerReindexAfterScriptChange(): void {
    const notice = new Notice("", 12000);
    notice.messageEl.createDiv({
      text: "Text script changed. Re-index the vault so word counts match the new script?",
    });
    const btn = notice.messageEl.createEl("button", { text: "Re-index vault" });
    btn.addEventListener("click", () => {
      notice.hide();
      void indexVaultWithNotice(this.plugin);
    });
  }

  private async persist(key: string): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.refreshChineseViews();
    this.plugin.refreshStatsViews();

    if (key === "sync.mirrorEnabled" || key === "sync.mirrorPath") {
      if (this.plugin.settings.sync.mirrorEnabled) await this.plugin.refreshSyncMirror();
    } else if (key === "sync.mirrorPollIntervalMinutes") {
      this.plugin.startSyncMirrorPoller();
    } else if (key === "sync.settingsMirrorEnabled") {
      if (this.plugin.settings.sync.settingsMirrorEnabled) {
        await this.plugin.settingsMirror.bootstrap();
      }
    } else if (key === "scriptVariant") {
      // saveSettings() above already routed through applyScriptSideEffects(),
      // which rebuilt the trie. All that is left is to offer a re-index: a
      // vault indexed under the old script recorded single-character
      // exposures for every note in the other one.
      this.offerReindexAfterScriptChange();
    } else if (key === "pronunciationRegion") {
      this.plugin.applyRegionSideEffects();
    } else if (key === "ai.provider") {
      // Swaps which provider block is visible — a structural change, so the
      // definitions have to be re-evaluated rather than just re-read.
      this.update();
    }
  }

  // ───────────────────────────── item helpers ─────────────────────────────

  /** A "Read the guide →" row linking into the repo's docs/ folder. */
  private docLink(name: string, blurb: string, docFile: string): SettingDefinitionEmpty {
    const desc = createFragment((f) => {
      f.createSpan({ text: blurb + " " });
      f.createEl("a", {
        text: "Read the guide on GitHub →",
        href: DOCS_BASE + docFile,
        attr: { target: "_blank", rel: "noopener" },
      });
    });
    return { name, desc };
  }

  /** A paragraph of section prose. Not a setting, so kept out of search. */
  private prose(text: string): SettingDefinitionRender {
    return {
      name: "",
      searchable: false,
      render: (setting: Setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("cci-settings-prose");
        setting.settingEl.createEl("p", { cls: "cci-settings-section-desc", text });
      },
    };
  }

  /** Wrap an imperative block that has no declarative equivalent. */
  private custom(
    name: string,
    render: (el: HTMLElement) => void,
    searchable = false
  ): SettingDefinitionRender {
    return {
      name,
      searchable,
      render: (setting: Setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("cci-settings-custom");
        render(setting.settingEl);
      },
    };
  }

  // ─────────────────────────────── the tab ───────────────────────────────

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.dataManagementGroup(),
      this.displayGroup(),
      this.scriptGroup(),
      this.tokenizerGroup(),
      this.exposureGroup(),
      this.srsGroup(),
      this.aiGroup(),
      this.storyGroup(),
      this.dictionaryGroup(),
      this.dataGroup(),
      this.syncGroup(),
      this.aboutGroup(),
    ];
  }

  private dataManagementGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Data management",
      items: [
        {
          name: "Open dashboard",
          desc: "Dashboard, per-note breakdown, flashcards, and the full word list.",
          action: () => void this.plugin.openStatsView(),
        },
      ],
    };
  }

  /**
   * Script & region. Deliberately a top-level group placed right after
   * Display rather than an item inside "Advanced display": a Traditional
   * reader has to find this before anything else in the plugin works for
   * them, so it must not be buried behind a sub-page.
   */
  private scriptGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Script & region",
      items: [
        this.docLink(
          "Traditional Chinese",
          "How Traditional support works, what the Taiwan readings cover, and why the plugin never converts between scripts.",
          "traditional-chinese.md"
        ),
        {
          name: "Text script",
          desc:
            "Which script your notes are written in. Traditional keeps Simplified words indexed as well, " +
            "so a vault with both kinds of note keeps working. Your notes are never rewritten.",
          control: {
            type: "dropdown",
            key: "scriptVariant",
            options: {
              simplified: "Simplified (Mainland / Singapore)",
              traditional: "Traditional (Taiwan / Hong Kong)",
            },
          },
        },
        {
          name: "Pronunciation",
          desc:
            "Taiwan uses the Taiwan reading wherever the dictionary records one — 垃圾 is lè sè rather than " +
            "lā jī. About 500 words are covered; everything else is unchanged.",
          control: {
            type: "dropdown",
            key: "pronunciationRegion",
            options: {
              mainland: "Mainland (pǔtōnghuà)",
              taiwan: "Taiwan (guóyǔ)",
            },
          },
        },
      ],
    };
  }

  private displayGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Display",
      items: [
        this.docLink(
          "Display modes & colors guide",
          "Two-line vs three-line, pinyin styles, what each color toggle controls.",
          "display-modes.md"
        ),
        {
          name: "Default display mode",
          desc: "Controls the inline annotation layout. Color and popup behavior are independent — see the color-mode toggle below.",
          control: {
            type: "dropdown",
            key: "defaultDisplayMode",
            options: {
              "two-line": "Two-line (pinyin)",
              "three-line": "Three-line (pinyin + gloss)",
              none: "None (no inline annotation)",
            },
          },
        },
        {
          name: "Color mode",
          desc: "Status colors highlight your known / partial / unknown words. HSK level colors highlight words by HSK 1–7.",
          control: {
            type: "dropdown",
            key: "colorMode",
            options: {
              status: "By status (known/partial/unknown)",
              hsk: "By HSK level (1–7)",
            },
          },
        },
        {
          name: "Known-word popups",
          control: { type: "toggle", key: "knownWordPopups" },
        },
        {
          type: "page",
          name: "Advanced display",
          desc: "Pinyin style, reader sizing, per-status and HSK colors, reader text colors, and the formatting picker.",
          items: [
            {
              name: "Pinyin style",
              control: {
                type: "dropdown",
                key: "pinyinStyle",
                options: {
                  marks: "Tone marks",
                  numbers: "Tone numbers",
                  none: "None",
                },
              },
            },
            {
              name: "Reader font size (px)",
              desc: "Base font size used inside the Chinese Learning View.",
              control: { type: "slider", key: "readerFontPx", min: 14, max: 40, step: 1 },
            },
            {
              name: "Top HSK comfort threshold (%)",
              desc: "Status-bar 'Top HSK X' shows the highest level where you already know at least this % of the note's HSK 1..X vocabulary. Lower = looser (label climbs higher); higher = stricter.",
              control: {
                type: "slider",
                key: "topHskComfortThreshold",
                min: 50,
                max: 90,
                step: 5,
              },
            },
            {
              name: "Annotation density cap (%)",
              desc: "If more than this % of visible words are densely annotated, auto-degrade to popup-only.",
              control: { type: "number", key: "densityCapPercent", min: 0, max: 100 },
            },
            {
              name: "Show mnemonic before full definition",
              control: { type: "toggle", key: "mnemonicsFirst" },
            },
            ...this.statusColorItems(),
            ...this.textColorItems(),
            ...this.hskColorItems(),
            ...this.formatPickerItems(),
          ],
        },
      ],
    };
  }

  private statusColorItems(): SettingDefinitionItem[] {
    const buckets: Array<["known" | "partial" | "unknown" | "new", string]> = [
      ["known", "Known color"],
      ["partial", "Partial color"],
      ["unknown", "Unknown color"],
      ["new", "New (untracked) color"],
    ];
    return [
      { type: "group", heading: "Status colors", items: [] },
      ...buckets.map(
        ([bucket, label]): SettingDefinitionItem => ({
          name: label,
          control: { type: "color", key: `customColors.${bucket}` },
        })
      ),
      {
        name: "Color known words",
        control: { type: "toggle", key: "showKnownColor" },
      },
      {
        name: "Color partial words",
        control: { type: "toggle", key: "showPartialColor" },
      },
      {
        name: "Color unknown words",
        control: { type: "toggle", key: "showUnknownColor" },
      },
      {
        name: "Color new (untracked) words",
        control: { type: "toggle", key: "showNewColor" },
      },
    ];
  }

  private textColorItems(): SettingDefinitionItem[] {
    return [
      { type: "group", heading: "Reader text colors", items: [] },
      this.prose(
        "Font color for each row of the reader — Chinese characters, pinyin, and the English gloss. " +
          "This is the text color, not the known/unknown/HSK background tint, so the two can be combined. " +
          "The three pickers below only take effect while the toggle is on; with it off your theme " +
          "decides all three (so dark themes keep working)."
      ),
      {
        name: "Use custom text colors",
        desc: "Off: follow the theme. On: use the three colors below.",
        control: { type: "toggle", key: "textColors.enabled" },
      },
      { name: "Characters color", control: { type: "color", key: "textColors.chars" } },
      { name: "Pinyin color", control: { type: "color", key: "textColors.pinyin" } },
      {
        name: "English translation color",
        control: { type: "color", key: "textColors.gloss" },
      },
      {
        name: "Reset text colors",
        desc: "Back to black characters with grey pinyin and translation.",
        action: () => {
          void (async () => {
            this.plugin.settings.textColors = { ...DEFAULT_TEXT_COLORS, enabled: true };
            await this.persist("textColors");
            this.update();
          })();
        },
      },
    ];
  }

  private hskColorItems(): SettingDefinitionItem[] {
    const levels = ["1", "2", "3", "4", "5", "6", "7"] as const;
    return [
      { type: "group", heading: "HSK level colors", items: [] },
      this.prose(
        "Used when Color mode is set to HSK. Defaults are derived from your Obsidian accent color " +
          "(HSK 1 lightest, HSK 7 darkest). Each level has a color picker AND a visibility toggle."
      ),
      ...levels.flatMap((level): SettingDefinitionItem[] => [
        {
          name: `HSK ${level} color`,
          control: { type: "color", key: `customColors.hsk.${level}` },
        },
        {
          name: `Show HSK ${level} color`,
          control: { type: "toggle", key: `showHskColors.${level}` },
        },
      ]),
      {
        name: "Reset HSK colors to accent gradient",
        desc: "Re-derive HSK 1–7 from your current Obsidian accent color (light → dark).",
        action: () => {
          void (async () => {
            this.plugin.settings.customColors.hsk = deriveHskColorsFromAccent();
            this.plugin.settings.hskColorsDerivedFromAccent = true;
            await this.persist("customColors.hsk");
            this.update();
          })();
        },
      },
      {
        name: "Reset all colors to defaults",
        desc: "Reset status colors AND HSK colors. HSK re-derives from the accent.",
        action: () => {
          void (async () => {
            this.plugin.settings.customColors = {
              ...DEFAULT_CUSTOM_COLORS,
              hsk: deriveHskColorsFromAccent(),
            };
            this.plugin.settings.hskColorsDerivedFromAccent = true;
            await this.persist("customColors");
            this.update();
          })();
        },
      },
    ];
  }

  private formatPickerItems(): SettingDefinitionItem[] {
    const renderList = (host: HTMLElement) => {
      const options = orderedFormatOptions(this.plugin.app, this.plugin.settings, true);
      const hidden = this.plugin.settings.formatHidden;
      renderFormatOptionsList(host, {
        rows: options.map((o) => ({
          id: o.id,
          label: o.label,
          color: o.color,
          visible: !hidden.includes(o.id),
        })),
        onChange: async (rows) => {
          this.plugin.settings.formatOrder = rows.map((r) => r.id);
          this.plugin.settings.formatHidden = rows.filter((r) => !r.visible).map((r) => r.id);
          await this.persist("formatOrder");
        },
      });
    };

    return [
      { type: "group", heading: "Formatting picker", items: [] },
      this.docLink(
        "Formatting & highlighting",
        "Tap-to-format mode: the add/remove highlighter, colored highlights, and how they render.",
        "formatting.md"
      ),
      this.docLink(
        "Themes & plugin compatibility",
        "Things-style checkboxes, Highlightr, sync tools, and what other plugins can and cannot do inside the Chinese view.",
        "compatibility.md"
      ),
      {
        name: "Show highlight colors without Highlightr",
        desc:
          "Expose highlight color options even when the Highlightr plugin is not installed. " +
          "Colors render inside the Chinese view; install Highlightr to render them elsewhere and to customize the palette.",
        control: { type: "toggle", key: "showHighlightColorsWithoutPlugin" },
      },
      {
        name: "Highlight overrides status / HSK colors",
        desc:
          "When a word has both a highlight and a status/HSK color, show the highlight and hide " +
          "the status color. Turn off to keep the status color and hide the highlight.",
        control: { type: "toggle", key: "highlightOverridesStatus" },
      },
      this.custom("Formatting picker order", (el) => {
        el.createEl("p", {
          cls: "cci-settings-section-desc",
          text: "Drag to reorder the formatting picker, and untick to hide an option from it.",
        });
        renderList(el.createDiv());
      }),
      {
        name: "Reset formatting order & visibility",
        action: () => {
          void (async () => {
            this.plugin.settings.formatOrder = [...DEFAULT_SETTINGS.formatOrder];
            this.plugin.settings.formatHidden = [];
            await this.persist("formatOrder");
            this.update();
          })();
        },
      },
    ];
  }

  private tokenizerGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Tokenizer",
      items: [
        this.docLink(
          "Word states & marking guide",
          "What new / partial / known / unknown / ignored mean and how to mark words from the reading view.",
          "word-states.md"
        ),
        {
          type: "page",
          name: "Advanced tokenizer",
          desc: "Segmentation engine and which HSK word lists to overlay.",
          items: [
            {
              name: "Engine",
              control: {
                type: "dropdown",
                key: "tokenizerEngine",
                options: {
                  lattice: "Dictionary lattice (recommended)",
                  "intl-segmenter": "Intl.Segmenter (helper/fallback)",
                  experimental: "Experimental WASM (not bundled)",
                },
              },
            },
            {
              name: "HSK source",
              control: {
                type: "dropdown",
                key: "hskSource",
                options: {
                  "2.0": "HSK 2.0",
                  "3.0": "HSK 3.0 / new HSK",
                  both: "Both",
                },
              },
            },
          ],
        },
      ],
    };
  }

  private exposureGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Exposure tracking",
      items: [
        this.docLink(
          "Exposure tracking guide",
          "What counts as 'seeing' a word, the dedup rules, and how exposure pushes status changes.",
          "exposure.md"
        ),
        {
          type: "page",
          name: "Advanced exposure",
          desc: "Dedup rules and how much exposure history is kept per word.",
          items: [
            {
              name: "Minimum visible time (ms)",
              desc: "How long a word must be visible before it counts as seen.",
              control: { type: "number", key: "exposure.minVisibleMs", min: 0 },
            },
            {
              name: "Limit: one exposure per word per note per session",
              control: { type: "toggle", key: "exposure.maxOncePerNotePerSession" },
            },
            {
              name: "Limit: one exposure per word per day",
              control: { type: "toggle", key: "exposure.maxOncePerDay" },
            },
            {
              name: "Popup counts as exposure",
              control: { type: "toggle", key: "exposure.popupCountsAsExposure" },
            },
            {
              name: "Generated stories count as exposure",
              control: { type: "toggle", key: "exposure.generatedReadingCountsAsExposure" },
            },
            {
              name: "Exact timestamp retention limit (per word)",
              control: { type: "number", key: "exactTimestampRetentionLimit", min: 0 },
            },
            {
              name: "Store ALL exact timestamps (storage-heavy)",
              desc: "Warning: enabling this disables retention pruning and can grow storage large over time.",
              control: { type: "toggle", key: "storeAllExactTimestamps" },
            },
          ],
        },
      ],
    };
  }

  private srsGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Spaced repetition",
      items: [
        this.docLink(
          "Spaced repetition guide",
          "How reviews get scheduled in this plugin and which knobs to touch first.",
          "srs.md"
        ),
        {
          type: "page",
          name: "Advanced SRS",
          desc: "Scheduling of known words and the starting interval / ease.",
          items: [
            {
              name: "Review known words occasionally",
              control: { type: "toggle", key: "srs.scheduleKnownOccasionally" },
            },
            {
              name: "Popup on a due word counts as a failed recall",
              control: { type: "toggle", key: "srs.popupOnDueIsFailedRecall" },
            },
            {
              name: "Initial interval (days)",
              control: { type: "number", key: "srs.initialIntervalDays", min: 1 },
            },
            {
              name: "Initial ease",
              control: { type: "number", key: "srs.initialEase", min: 1.3, step: "any" },
            },
          ],
        },
      ],
    };
  }

  private aiGroup(): SettingDefinitionItem {
    const isOpenAi = () => this.plugin.settings.ai.provider === "openai";
    const isOllama = () => !isOpenAi();

    return {
      type: "group",
      heading: "AI provider",
      items: [
        this.prose(
          "Plugin works fully without AI. Pick a provider below: OpenAI is the 'just works' path " +
            "(paste an API key, done); Ollama exposes all the knobs for self-hosting power-users. " +
            "Switching providers preserves the inactive provider's settings."
        ),
        { name: "Enabled", control: { type: "toggle", key: "ai.enabled" } },
        {
          name: "Provider",
          desc: "OpenAI: cloud, pay-per-token, hardcoded to GPT-5.4 mini. Ollama: self-hosted, free, your choice of model.",
          control: {
            type: "dropdown",
            key: "ai.provider",
            options: {
              ollama: "Ollama (local / self-hosted)",
              openai: "OpenAI",
            },
          },
        },

        // ── OpenAI ──
        { ...this.docLink(
            "OpenAI setup & cost guide",
            "What gets sent, what it costs, how to create an API key, and how to keep the bill under $1/month.",
            "openai-setup.md"
          ), visible: isOpenAi },
        {
          name: "OpenAI API key",
          desc:
            "Paste your sk-… key. Stored in Obsidian's device-local key store (app.saveLocalStorage), " +
            "never written to data.json or the settings-mirror file.",
          visible: isOpenAi,
          control: { type: "text", key: SECRET_PREFIX + "openai", placeholder: "sk-…" },
        },
        {
          ...this.custom("OpenAI usage & pricing", (el) => this.renderOpenAiUsage(el)),
          visible: isOpenAi,
        },

        // ── Ollama ──
        { ...this.docLink(
            "Ollama tips & model choice",
            "Picking a model (7B vs 14B vs 32B), bumping repair iterations for weaker models, and when to send known words.",
            "ollama-tips.md"
          ), visible: isOllama },
        {
          name: "Base URL",
          visible: isOllama,
          control: { type: "text", key: "ai.ollama.baseUrl" },
        },
        {
          name: "Ollama API key (optional)",
          desc: "Only needed for protected Ollama proxies. Stored in Obsidian's device-local key store, never in data.json.",
          visible: isOllama,
          control: { type: "text", key: SECRET_PREFIX + "ollama" },
        },
        {
          name: "Chat model",
          visible: isOllama,
          control: { type: "text", key: "ai.ollama.chatModel" },
        },
        {
          type: "page",
          name: "Advanced AI",
          desc: "Endpoint mode, sampling, timeouts, structured-output format, streaming.",
          visible: isOllama,
          items: [
            {
              name: "Endpoint mode",
              desc:
                "Pick 'Ollama native' if you reach Ollama directly (especially over Tailscale from iPhone). " +
                "Some Ollama builds expose CORS on /api/* but not /v1/*, which makes the OpenAI-compat path fail with 'Load failed'. " +
                "/v1/responses is OpenAI-only.",
              control: {
                type: "dropdown",
                key: "ai.ollama.endpointMode",
                options: {
                  chat: "OpenAI-compat /v1/chat/completions",
                  ollama: "Ollama native /api/chat (recommended for Ollama)",
                  responses: "OpenAI /v1/responses",
                },
              },
            },
            {
              name: "Temperature",
              control: { type: "number", key: "ai.ollama.temperature", min: 0, max: 2, step: "any" },
            },
            {
              name: "Max output tokens",
              control: { type: "number", key: "ai.ollama.maxOutputTokens", min: 1 },
            },
            {
              name: "Timeout (ms)",
              control: { type: "number", key: "ai.ollama.timeoutMs", min: 1000 },
            },
            {
              name: "Max repair iterations",
              control: { type: "number", key: "ai.ollama.maxRepairIterations", min: 0 },
            },
            {
              name: "Structured-output format",
              desc:
                "json_object works on the widest range of providers (Ollama, OpenAI, vLLM). " +
                "json_schema is stricter but only OpenAI + Ollama >= 0.5.7 honour it. " +
                "none sends no response_format flag — the prompt alone steers the model.",
              control: {
                type: "dropdown",
                key: "ai.ollama.responseFormat",
                options: {
                  json_object: "json_object (recommended)",
                  json_schema: "json_schema (strict)",
                  none: "none",
                },
              },
            },
            {
              name: "Stream responses (SSE)",
              desc:
                "Stream tokens as the model generates instead of waiting for the full reply. " +
                "Required when the connection goes through Tailscale / a VPN / a load balancer that kills idle HTTP connections, " +
                "because streaming keeps bytes flowing so the connection never goes idle.",
              control: { type: "toggle", key: "ai.ollama.stream" },
            },
            {
              name: "Suppress thinking trace",
              desc:
                "Append /no_think to the system prompt so qwen3-style reasoning models skip the long thought trace " +
                "that otherwise eats the completion-token budget. Harmless to non-thinking models.",
              control: { type: "toggle", key: "ai.ollama.suppressThinking" },
            },
          ],
        },

        // ── shared ──
        {
          name: "Allow AI to rewrite pinyin when enhancing entries",
          desc:
            "Off (default): the 'Enhance' button on the word popup only rewrites English definitions and the optional grammar note. " +
            "On: the model may also propose a new pinyin reading when the sentence disambiguates a polyphone (e.g. 行 xíng vs háng). " +
            "Pinyin in this plugin is canonical from CC-CEDICT, so leave this off unless you know what you're trading.",
          control: { type: "toggle", key: "ai.enhanceCanRewritePinyin" },
        },
        this.mnemonicPromptPage(),
        {
          name: "Test connection",
          desc: "Check that the active provider answers.",
          action: () => {
            void (async () => {
              try {
                const ok = await this.plugin.ai.testConnection();
                new Notice(ok ? "AI provider reachable." : "AI provider unreachable.");
              } catch (e) {
                new Notice("AI test error: " + (e as Error).message);
              }
            })();
          },
        },
        {
          type: "page",
          name: "Diagnostics",
          desc: "Verbose request tracing while debugging a stuck AI request.",
          items: [
            {
              name: "Verbose AI debug notifications",
              desc:
                "When on, a persistent Notice tracks each AI request: fetch issued → HTTP status → first byte → streaming chunks → finish_reason. " +
                "Console logs the same milestones with elapsed seconds. Use while diagnosing a stuck request; turn off in normal use.",
              control: { type: "toggle", key: "ai.debug" },
            },
          ],
        },
      ],
    };
  }

  /** User half of the mnemonic prompt (#49); the system prompt is fixed. */
  private mnemonicPromptPage(): SettingDefinitionPage {
    return {
      type: "page",
      name: "Mnemonic prompt",
      desc: "Personalise what the AI is asked for when you generate a mnemonic.",
      items: [
        this.docLink(
          "Mnemonics",
          "How the generated mnemonic is built (emoji line, components, tone, meaning) and how to make it yours.",
          "mnemonics.md"
        ),
        this.prose(
          "Sent to the model when you press \"Generate with AI\" in a word's Mnemonic editor. " +
            "Personalise it — name the imagery you remember best, the language you want it in, how rude or silly it may be. " +
            "Placeholders: {word}, {pinyin}, {traditional}, {definitions}, {sentence}, {hsk}, {existing}, {existingStory}. " +
            "The emoji-line rules live in the fixed system prompt, so your edits here keep them. " +
            "Leave it empty to fall back to the built-in prompt."
        ),
        {
          name: "Prompt template",
          control: { type: "textarea", key: "ai.mnemonicPrompt", rows: 10 },
        },
        {
          name: "Reset to default prompt",
          action: () => {
            void (async () => {
              this.plugin.settings.ai.mnemonicPrompt = DEFAULT_MNEMONIC_USER_TEMPLATE;
              await this.persist("ai.mnemonicPrompt");
              this.update();
            })();
          },
        },
      ],
    };
  }

  /** GPT-5.4 mini info card + rolling token / cost totals. Mimics the
   *  OpenAI pricing page layout. */
  private renderOpenAiUsage(c: HTMLElement) {
    const wrap = c.createDiv({ cls: "cci-openai-usage" });
    wrap.createDiv({ cls: "cci-openai-usage-name", text: OPENAI_MODEL_DISPLAY });
    wrap.createEl("p", { cls: "cci-openai-usage-desc", text: OPENAI_MODEL_DESC });

    const priceBlock = wrap.createDiv({ cls: "cci-openai-usage-pricing" });
    priceBlock.createDiv({ cls: "cci-openai-usage-section", text: "Price" });
    const priceRow = (label: string, value: string) => {
      const row = priceBlock.createDiv({ cls: "cci-openai-usage-row" });
      row.createSpan({ cls: "cci-openai-usage-label", text: label });
      row.createSpan({ cls: "cci-openai-usage-value", text: value });
    };
    priceRow("Input:", `$${OPENAI_PRICE_PER_1M.input.toFixed(2)} / 1M tokens`);
    priceRow("Cached input:", `$${OPENAI_PRICE_PER_1M.cachedInput.toFixed(3)} / 1M tokens`);
    priceRow("Output:", `$${OPENAI_PRICE_PER_1M.output.toFixed(2)} / 1M tokens`);

    const usageBlock = wrap.createDiv({ cls: "cci-openai-usage-spent" });
    usageBlock.createDiv({ cls: "cci-openai-usage-section", text: "Your usage" });

    const now = Date.now();
    const windows = [
      { label: "24h", ms: 24 * 60 * 60 * 1000 },
      { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
      { label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
    ];
    const entries = (this.plugin.settings.ai.usageLog ?? []).filter(
      (e) => e.provider === "openai"
    );
    const fmtTok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const fmtUsd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

    const grid = usageBlock.createDiv({ cls: "cci-openai-usage-grid" });
    grid.createSpan({ cls: "cci-openai-usage-gridhead", text: "" });
    for (const w of windows) {
      grid.createSpan({ cls: "cci-openai-usage-gridhead", text: w.label });
    }
    for (const metric of ["Input", "Cached", "Output", "Cost"] as const) {
      grid.createSpan({ cls: "cci-openai-usage-gridlabel", text: metric });
      for (const w of windows) {
        const cutoff = now - w.ms;
        const slice = entries.filter((e) => e.ts >= cutoff);
        const totals = slice.reduce(
          (acc, e) => ({
            inputTokens: acc.inputTokens + e.inputTokens,
            cachedInputTokens: acc.cachedInputTokens + e.cachedInputTokens,
            outputTokens: acc.outputTokens + e.outputTokens,
          }),
          { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
        );
        let text: string;
        if (metric === "Input") text = fmtTok(totals.inputTokens);
        else if (metric === "Cached") text = fmtTok(totals.cachedInputTokens);
        else if (metric === "Output") text = fmtTok(totals.outputTokens);
        else text = fmtUsd(computeOpenAiCostUsd(totals));
        grid.createSpan({ cls: "cci-openai-usage-gridval", text });
      }
    }
  }

  private storyGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Generated stories",
      items: [
        this.docLink(
          "Story generation guide",
          "What Smart Story does end-to-end, the repair loop, and which knobs help when results disappoint.",
          "story-generation.md"
        ),
        {
          name: "Auto-generate a daily story",
          desc: "When the AI provider is reachable, generate one story per day at the time below. Saves to the folder. Retries every 30 min on failure; failed days are dropped at midnight — no carry-over.",
          control: { type: "toggle", key: "story.autoGenerateEnabled" },
        },
        {
          name: "Daily generation time",
          desc: "Local 24-hour HH:MM. Default 08:00.",
          control: {
            type: "text",
            key: "story.autoGenerateTime",
            placeholder: "08:00",
            validate: (v: string) =>
              /^\d{1,2}:\d{2}$/.test(v.trim()) ? undefined : "Use HH:MM, e.g. 08:00.",
          },
        },
        {
          name: "Folder",
          desc: "Where generated story notes are saved.",
          control: { type: "folder", key: "story.folder" },
        },
        {
          name: "Default due word count",
          control: { type: "number", key: "story.defaultDueCount", min: 1 },
        },
        {
          name: "Default length (chars)",
          control: { type: "number", key: "story.defaultLengthChars", min: 50 },
        },
        {
          name: "Default style",
          control: {
            type: "dropdown",
            key: "story.defaultStyle",
            options: { story: "Story", article: "Article", dialogue: "Dialogue" },
          },
        },
        {
          type: "page",
          name: "Advanced story options",
          desc: "Coverage threshold, glossary, and whether known words are sent to the model.",
          items: [
            {
              name: "Known coverage threshold (0..1)",
              control: {
                type: "number",
                key: "story.knownCoverageThreshold",
                min: 0,
                max: 1,
                step: "any",
              },
            },
            {
              name: "Include glossary in note",
              control: { type: "toggle", key: "story.includeGlossary" },
            },
            {
              name: "Send known words to AI",
              desc: "Opt in to include a sample of your known vocabulary in story prompts, so the model sees examples of your current Chinese level.",
              control: { type: "toggle", key: "story.sendKnownWords" },
            },
            {
              name: "Known words sample percent",
              desc: "When sending known words, randomly include this percent of all known words. Lower values keep prompts smaller.",
              control: {
                type: "number",
                key: "story.knownWordsSamplePercent",
                min: 1,
                max: 100,
              },
            },
          ],
        },
      ],
    };
  }

  private dictionaryGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Dictionary",
      items: [
        this.prose(
          "Plugin ships with a tiny seed dictionary. For real use, download CC-CEDICT (~8 MB, CC BY-SA 4.0). " +
            "Data is written to a vault-side file and loaded lazily at runtime."
        ),
        this.custom("Dictionary status", (el) => this.renderDictionaryStatus(el)),
        {
          name: "Download CC-CEDICT",
          desc: "Fetches the latest CC-CEDICT archive and installs it into the vault.",
          action: () => void this.downloadDictionary(),
        },
        {
          name: "Remove downloaded dictionary",
          desc: "Deletes the CC-CEDICT file from the vault; the seed dictionary takes over again.",
          action: () => void this.removeDictionary(),
        },
      ],
    };
  }

  /** Live status line, refreshed by the downloader's own status events. */
  private renderDictionaryStatus(el: HTMLElement): void {
    const statusEl = el.createDiv({ cls: "setting-item-description" });
    const paint = () => {
      const meta = this.plugin.settings.dictionarySource;
      const live = this.plugin.dictDownloader.getStatus();
      if (live.state === "downloading" || live.state === "parsing" || live.state === "writing") {
        statusEl.setText(`${live.message} (parsed ${live.entriesParsed})`);
        return;
      }
      if (meta) {
        statusEl.setText(
          `Active: ${meta.source} · ${meta.versionLine || "version unknown"} · ` +
            `${meta.entryCount} entries · downloaded ${meta.downloadedAt.slice(0, 10)} · file ${meta.outputPath}`
        );
      } else {
        statusEl.setText("No external dictionary downloaded yet (seed dictionary in use).");
      }
    };
    paint();
    const unsub = this.plugin.dictDownloader.onStatus(() => paint());
    this.plugin.register(() => unsub());
  }

  private async downloadDictionary(): Promise<void> {
    try {
      const count = await this.plugin.dictDownloader.run();
      const status = this.plugin.dictDownloader.getStatus();
      this.plugin.settings.dictionarySource = {
        source: "CC-CEDICT",
        versionLine: status.versionLine ?? "",
        downloadedAt: status.downloadedAt ?? new Date().toISOString(),
        entryCount: count,
        outputPath: ".cci-dictionary.json",
      };
      await this.plugin.saveSettings();
      await this.plugin.dictionary.reload();
      this.plugin.tokenizer.invalidate();
      new Notice(`Dictionary installed: ${count} entries.`);
    } catch (e) {
      new Notice("Download failed: " + (e as Error).message);
    }
    this.update();
  }

  private async removeDictionary(): Promise<void> {
    if (!(await confirmAsync(this.app, "Delete the downloaded CC-CEDICT file from the vault?"))) {
      return;
    }
    const path = normalizePath(
      this.plugin.settings.dictionarySource?.outputPath ?? ".cci-dictionary.json"
    );
    try {
      if (await this.app.vault.adapter.exists(path)) {
        await this.app.vault.adapter.remove(path);
      }
      this.plugin.settings.dictionarySource = undefined;
      await this.plugin.saveSettings();
      await this.plugin.dictionary.reload();
      this.plugin.tokenizer.invalidate();
      new Notice("Dictionary removed; seed dictionary back in use.");
    } catch (e) {
      new Notice("Remove failed: " + (e as Error).message);
    }
    this.update();
  }

  private dataGroup(): SettingDefinitionItem {
    const doImport = async (text: string) => {
      const result = await this.plugin.vocab.importJson(text);
      new Notice(`Imported ${result.added} new, ${result.updated} updated.`);
      this.plugin.refreshChineseViews();
      this.plugin.refreshStatsViews();
    };

    return {
      type: "group",
      heading: "Data",
      items: [
        {
          name: "Index vault",
          desc:
            "Scan every Markdown file for Chinese words and record exposures. " +
            "Runs automatically once on first plugin load; use this to scan again after large vault edits. " +
            "Scanning again records additional exposures for matching words.",
          action: () => {
            void (async () => {
              this.plugin.settings.vaultIndexed = false;
              await this.plugin.saveSettings();
              await indexVaultWithNotice(this.plugin);
            })();
          },
        },
        {
          name: "Export vocabulary JSON",
          desc: "Copies the full vocabulary store to the clipboard.",
          action: () => {
            void (async () => {
              const json = await this.plugin.vocab.exportJson();
              await navigator.clipboard.writeText(json);
              new Notice("Vocabulary JSON copied to clipboard.");
            })();
          },
        },
        {
          name: "Export vocabulary CSV",
          desc: "Copies the vocabulary store to the clipboard as CSV.",
          action: () => {
            void (async () => {
              const csv = await this.plugin.vocab.exportCsv();
              await navigator.clipboard.writeText(csv);
              new Notice("Vocabulary CSV copied to clipboard.");
            })();
          },
        },
        {
          name: "Import vocabulary from clipboard",
          desc: "Merges records by key. Existing entries are updated; new keys are added.",
          action: () => {
            void (async () => {
              try {
                await doImport(await navigator.clipboard.readText());
              } catch (err) {
                new Notice("Import failed: " + (err as Error).message);
              }
            })();
          },
        },
        {
          name: "Import vocabulary from file",
          desc: "Pick a JSON export from disk.",
          action: () => {
            const input = createEl("input");
            input.type = "file";
            input.accept = ".json,application/json";
            input.addEventListener("change", () => {
              void (async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  await doImport(await file.text());
                } catch (err) {
                  new Notice("Import failed: " + (err as Error).message);
                }
              })();
            });
            input.click();
          },
        },
        {
          type: "page",
          name: "Advanced data",
          items: [
            {
              name: "Auto-download dictionary on first load",
              desc: "Silently fetch CC-CEDICT from MDBG when the vault doesn't have a dictionary yet.",
              control: { type: "toggle", key: "autoDownloadDictionary" },
            },
          ],
        },
        {
          name: "Reset plugin data",
          desc: "Permanently deletes all word records and resets settings. Cannot be undone.",
          action: () => {
            void (async () => {
              if (await confirmAsync(this.app, "Really reset all plugin data?", "Reset")) {
                await this.plugin.vocab.resetAll();
                new Notice("Plugin data reset.");
              }
            })();
          },
        },
      ],
    };
  }

  private syncGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "Sync (remotely-save)",
      items: [
        this.docLink(
          "Vault-mirror sync guide",
          `Why this exists for users who don't sync ${this.app.vault.configDir}/, vocab vs settings mirror, and what's filtered out.`,
          "sync-mirror.md"
        ),
        this.docLink(
          "Conflict resolution guide",
          "How the priority list resolves two-device disagreements on word status.",
          "conflicts.md"
        ),
        this.prose(
          "Write a vault-side JSON mirror of your vocabulary so the remotely-save plugin syncs it " +
            "between devices without enabling its \"sync config dir\" toggle. Each device merges " +
            "incoming changes idempotently — no double-counted exposures, and \"new\" never overrides " +
            "a classified status."
        ),
        {
          name: "Mirror vocabulary to a vault file",
          desc: "When on, the plugin writes a copy of your vocabulary to the path below on every save and merges the file back in when remotely-save pulls a remote update.",
          control: { type: "toggle", key: "sync.mirrorEnabled" },
        },
        {
          name: "Mirror file path",
          desc: `Default: ${VOCAB_MIRROR_PATH_DEFAULT}. Must be a regular vault path (not under ${this.app.vault.configDir}/) so remotely-save picks it up.`,
          control: {
            type: "file",
            key: "sync.mirrorPath",
            placeholder: VOCAB_MIRROR_PATH_DEFAULT,
          },
        },
        {
          name: "Auto re-sync interval (minutes)",
          desc:
            "How often to re-check the mirror file on disk for changes pulled in by remotely-save. " +
            "0 disables auto-poll (manual \"Force re-sync now\" still works). Minimum effective interval is 30 seconds.",
          control: { type: "number", key: "sync.mirrorPollIntervalMinutes", min: 0 },
        },
        {
          name: "Force re-sync now",
          desc: "Re-read the mirror file, merge any pending changes (including remotely-save conflict files), and write the result back.",
          action: () => {
            void (async () => {
              if (!this.plugin.settings.sync.mirrorEnabled) {
                new Notice("Mirror is off — enable it first.");
                return;
              }
              await this.plugin.vocab.reloadMirror();
              this.plugin.refreshChineseViews();
              this.plugin.refreshStatsViews();
              new Notice("Vocabulary mirror re-synced.");
            })();
          },
        },
        {
          type: "page",
          name: "Advanced sync",
          desc: "Conflict priority, settings mirror, and settings backup / restore.",
          items: [
            { type: "group", heading: "Conflict resolution priority", items: [] },
            this.prose(
              "When two devices set different statuses on the same word, the status higher in this list wins — " +
                "overriding the timestamp. \"New\" always loses to any classified status (hardcoded). " +
                "Drag rows or use the arrow buttons to reorder."
            ),
            this.custom("Status priority list", (el) => {
              renderStatusPriorityList(el.createDiv(), {
                values: this.plugin.settings.sync.statusPriority,
                onChange: async (next: WordStatus[]) => {
                  this.plugin.settings.sync.statusPriority = next;
                  await this.plugin.saveSettings();
                },
              });
            }),
            {
              name: "Reset priority list to default",
              action: () => {
                void (async () => {
                  this.plugin.settings.sync.statusPriority = [...DEFAULT_STATUS_PRIORITY];
                  await this.plugin.saveSettings();
                  this.update();
                })();
              },
            },

            { type: "group", heading: "Sync between devices", items: [] },
            this.prose(
              "Optional: mirror your display + behavioral settings to a vault-side JSON file so other " +
                "devices can pick them up via remotely-save / Nextcloud. Excluded from the mirror: " +
                "AI credentials, mirror paths, per-device dictionary state."
            ),
            {
              name: "Mirror settings to a vault file",
              control: { type: "toggle", key: "sync.settingsMirrorEnabled" },
            },
            {
              name: "Settings mirror file path",
              control: {
                type: "file",
                key: "sync.settingsMirrorPath",
                placeholder: "Chinese Learning/cci-settings.json",
              },
            },
            {
              name: "Push current settings to mirror now",
              desc: "Force-write this device's settings to the mirror file, bypassing the fresh-install touched check. Use when the other device's changes haven't propagated and you want to seed the file from here.",
              action: () => {
                void (async () => {
                  if (!this.plugin.settings.sync.settingsMirrorEnabled) {
                    new Notice("Settings mirror is off — enable it first.");
                    return;
                  }
                  try {
                    await this.plugin.settingsMirror.forcePushNow();
                    new Notice("Settings pushed to mirror.");
                  } catch (e) {
                    new Notice("Push failed: " + (e as Error).message);
                  }
                })();
              },
            },

            { type: "group", heading: "Backup / restore", items: [] },
            this.prose(
              "Export your settings to a JSON file inside the vault, or restore from one. " +
                "Sensitive fields (AI key, sync paths) are excluded from both directions."
            ),
            {
              name: "Export path",
              control: {
                type: "text",
                key: UI_PREFIX + "exportPath",
                placeholder: SETTINGS_EXPORT_DEFAULT_PATH,
              },
            },
            {
              name: "Export settings",
              action: () => {
                void (async () => {
                  try {
                    await exportSettings(this.plugin, this.exportPath);
                    new Notice(`Settings exported to ${this.exportPath}`);
                  } catch (e) {
                    new Notice("Export failed: " + (e as Error).message);
                  }
                })();
              },
            },
            {
              name: "Import path",
              control: {
                type: "file",
                key: UI_PREFIX + "importPath",
                placeholder: SETTINGS_EXPORT_DEFAULT_PATH,
              },
            },
            {
              name: "Import settings",
              desc: "Overwrites your current settings where the file has values.",
              action: () => void this.importSettingsFromPath(),
            },
          ],
        },
      ],
    };
  }

  private async importSettingsFromPath(): Promise<void> {
    if (!this.importPath) {
      new Notice("Pick an import path first.");
      return;
    }
    const ok = await confirmAsync(
      this.app,
      "Import settings from " +
        this.importPath +
        "? Your current settings will be overwritten where the file has values.",
      "Import"
    );
    if (!ok) return;
    try {
      const { applied, skipped } = await importSettings(this.plugin, this.importPath);
      const skip = skipped.length ? ` (skipped sensitive: ${skipped.join(", ")})` : "";
      new Notice(`Imported ${applied} top-level keys${skip}.`);
      this.update();
    } catch (e) {
      new Notice("Import failed: " + (e as Error).message);
    }
  }

  private aboutGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: "About / licenses",
      items: [
        this.docLink(
          "Documentation index",
          "Browse the full set of user guides on GitHub: FAQ, AI tips, SRS, sync, word states, and more.",
          "index.md"
        ),
        this.docLink(
          "Frequently asked questions",
          "Quick answers to the top issues users hit.",
          "faq.md"
        ),
        this.custom("Licenses", (el) => {
          const ul = el.createEl("ul");
          ul.createEl("li", { text: "Dictionary: CC-CEDICT (CC BY-SA 4.0)" });
          ul.createEl("li", { text: "HSK overlay: Complete HSK Vocabulary (MIT)" });
          ul.createEl("li", { text: "Plugin code: MIT" });
          el.createEl("p", {
            text: "See NOTICE.md in the plugin folder for attribution details.",
          });
        }),
      ],
    };
  }
}
