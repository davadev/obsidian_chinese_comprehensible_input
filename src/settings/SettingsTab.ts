import { App, PluginSettingTab, Setting, Notice, normalizePath } from "obsidian";
import type CciPlugin from "../main";
import { indexVaultWithNotice } from "../vocabulary/VaultIndexer";
import { renderStatusPriorityList } from "./StatusPriorityList";
import { renderFormatOptionsList } from "./FormatOptionsList";
import { orderedFormatOptions } from "../editor/formatOptions";
import { DEFAULT_CUSTOM_COLORS, DEFAULT_SETTINGS, DEFAULT_STATUS_PRIORITY } from "./defaults";
import { deriveHskColorsFromAccent } from "../ui/colorTheme";
import { VOCAB_MIRROR_PATH_DEFAULT } from "../constants";
import { WordStatus } from "../vocabulary/VocabularyTypes";
import { openVaultFilePicker, openVaultFolderPicker } from "../ui/PathPickers";
import {
  exportSettings,
  importSettings,
  SETTINGS_EXPORT_DEFAULT_PATH,
} from "./SettingsIO";
import type {
  AiProviderKind,
  ColorMode,
  DisplayMode,
  HskSource,
  PinyinStyle,
  TokenizerEngine,
} from "./types";
import type { TextComponent } from "obsidian";
import {
  OPENAI_MODEL_DESC,
  OPENAI_MODEL_DISPLAY,
  OPENAI_PRICE_PER_1M,
  computeOpenAiCostUsd,
} from "../ai/openaiProfile";
import { loadApiKey, saveApiKey } from "../ai/secrets";
import { confirmAsync } from "../ui/confirmInput";

export class CciSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: CciPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.rerender();
  }

  /** Internal re-render entry point. Identical to `display()`'s body, but
   *  callable from event handlers without tripping the
   *  `@typescript-eslint/no-deprecated` rule on `PluginSettingTab.display`.
   *  Obsidian still calls `display()` from outside; we route the four
   *  in-tab refresh sites through `rerender()` instead. */
  private rerender(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderDataManagement(containerEl);
    this.renderDisplay(containerEl);
    this.renderTokenizer(containerEl);
    this.renderExposure(containerEl);
    this.renderSrs(containerEl);
    this.renderAi(containerEl);
    this.renderStory(containerEl);
    this.renderDictionary(containerEl);
    this.renderData(containerEl);
    this.renderSync(containerEl);
    this.renderAbout(containerEl);
  }

  /** Wrap a block of settings in a collapsible `<details>` so power-user
   *  knobs don't crowd the page. Common items stay rendered above. */
  private renderCollapsible(c: HTMLElement, label: string, fn: (host: HTMLElement) => void): void {
    const details = c.createEl("details", { cls: "cci-settings-advanced" });
    details.createEl("summary", { text: label });
    fn(details);
  }

  /** Insert a "Read the guide →" row that links to a markdown file in
   *  the repo's docs/ folder. Pattern reused across most sections so
   *  users can dive deeper without bloating the in-app help text. */
  private renderDocLink(c: HTMLElement, name: string, blurb: string, docFile: string): void {
    const help = new Setting(c).setName(name);
    help.descEl.createSpan({ text: blurb + " " });
    help.descEl.createEl("a", {
      text: "Read the guide on GitHub →",
      href: `https://github.com/davadev/obsidian_chinese_comprehensible_input/blob/main/docs/${docFile}`,
      attr: { target: "_blank", rel: "noopener" },
    });
  }

  private renderDataManagement(c: HTMLElement) {
    new Setting(c).setName("Data Management").setHeading();
    new Setting(c)
      .setDesc("Dashboard, per-note breakdown, flashcards, and the full word list.")
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => this.plugin.openStatsView())
      );
  }

  private renderDictionary(c: HTMLElement) {
    new Setting(c).setName("Dictionary").setHeading();
    c.createEl("p", {
      cls: "setting-item-description",
      text:
        "Plugin ships with a tiny seed dictionary. For real use, download CC-CEDICT (~8 MB, CC BY-SA 4.0). " +
        "Data is written to a vault-side file and loaded lazily at runtime.",
    });

    const statusEl = c.createDiv({ cls: "setting-item-description" });
    const updateStatusEl = () => {
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
    updateStatusEl();
    const unsub = this.plugin.dictDownloader.onStatus(() => updateStatusEl());

    new Setting(c)
      .setName("Download CC-CEDICT")
      .setDesc("Fetches the latest CC-CEDICT archive and installs it into the vault.")
      .addButton((b) =>
        b
          .setButtonText("Download dictionary")
          .setCta()
          .onClick(async () => {
            b.setDisabled(true);
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
            } finally {
              b.setDisabled(false);
              updateStatusEl();
            }
          })
      )
      .addButton((b) => {
        b.setButtonText("Remove").onClick(async () => {
          if (!(await confirmAsync(this.app, "Delete the downloaded CC-CEDICT file from the vault?"))) return;
          const path = normalizePath(this.plugin.settings.dictionarySource?.outputPath ?? ".cci-dictionary.json");
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
          updateStatusEl();
        });
        b.buttonEl.addClass("mod-warning");
      });

    // Detach status listener when the settings tab rebuilds.
    this.plugin.register(() => unsub());
  }

  private renderDisplay(c: HTMLElement) {
    new Setting(c).setName("Display").setHeading();
    this.renderDocLink(
      c,
      "Display modes & colors guide",
      "Two-line vs three-line, pinyin styles, what each color toggle controls.",
      "display-modes.md"
    );
    new Setting(c)
      .setName("Default display mode")
      .setDesc(
        "Controls the inline annotation layout. Color and popup behavior are independent — see the color-mode toggle below."
      )
      .addDropdown((d) => {
        d.addOption("two-line", "Two-line (pinyin)");
        d.addOption("three-line", "Three-line (pinyin + gloss)");
        d.addOption("none", "None (no inline annotation)");
        d.setValue(this.plugin.settings.defaultDisplayMode);
        d.onChange(async (v) => {
          this.plugin.settings.defaultDisplayMode = v as DisplayMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(c)
      .setName("Color mode")
      .setDesc(
        "Status colors highlight your known / partial / unknown words. HSK level colors highlight words by HSK 1–7."
      )
      .addDropdown((d) => {
        d.addOption("status", "By status (known/partial/unknown)");
        d.addOption("hsk", "By HSK level (1–7)");
        d.setValue(this.plugin.settings.colorMode);
        d.onChange(async (v) => {
          this.plugin.settings.colorMode = v as ColorMode;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
          this.plugin.refreshStatsViews();
        });
      });

    new Setting(c)
      .setName("Known-word popups")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.knownWordPopups).onChange(async (v) => {
          this.plugin.settings.knownWordPopups = v;
          await this.plugin.saveSettings();
        })
      );

    this.renderCollapsible(c, "Advanced display ▾", (a) => {
      new Setting(a)
        .setName("Pinyin style")
        .addDropdown((d) => {
          d.addOption("marks", "Tone marks");
          d.addOption("numbers", "Tone numbers");
          d.addOption("none", "None");
          d.setValue(this.plugin.settings.pinyinStyle);
          d.onChange(async (v) => {
            this.plugin.settings.pinyinStyle = v as PinyinStyle;
            await this.plugin.saveSettings();
          });
        });
      new Setting(a)
        .setName("Reader font size (px)")
        .setDesc("Base font size used inside the Chinese Learning View.")
        .addSlider((s) =>
          s
            .setLimits(14, 40, 1)
            .setValue(this.plugin.settings.readerFontPx ?? 22)
            .onChange(async (v) => {
              this.plugin.settings.readerFontPx = v;
              await this.plugin.saveSettings();
            })
        );
      new Setting(a)
        .setName("Top HSK comfort threshold (%)")
        .setDesc(
          "Status-bar 'Top HSK X' shows the highest level where you already know at least this % of the note's HSK 1..X vocabulary. Lower = looser (label climbs higher); higher = stricter."
        )
        .addSlider((s) =>
          s
            .setLimits(50, 90, 5)
            .setValue(
              Math.round((this.plugin.settings.topHskComfortThreshold ?? 0.67) * 100)
            )
            .onChange(async (v) => {
              this.plugin.settings.topHskComfortThreshold = v / 100;
              await this.plugin.saveSettings();
            })
        );
      new Setting(a)
        .setName("Annotation density cap (%)")
        .setDesc("If more than this % of visible words are densely annotated, auto-degrade to popup-only.")
        .addText((t) => {
          t.setValue(String(this.plugin.settings.densityCapPercent));
          t.onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!Number.isNaN(n)) {
              this.plugin.settings.densityCapPercent = n;
              await this.plugin.saveSettings();
            }
          });
        });
      new Setting(a)
        .setName("Show mnemonic before full definition")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.mnemonicsFirst).onChange(async (v) => {
            this.plugin.settings.mnemonicsFirst = v;
            await this.plugin.saveSettings();
          })
        );
      this.renderColorPickers(a);
      new Setting(a).setName("Color known words").addToggle((t) =>
        t.setValue(this.plugin.settings.showKnownColor).onChange(async (v) => {
          this.plugin.settings.showKnownColor = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        })
      );
      new Setting(a).setName("Color partial words").addToggle((t) =>
        t.setValue(this.plugin.settings.showPartialColor).onChange(async (v) => {
          this.plugin.settings.showPartialColor = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        })
      );
      new Setting(a).setName("Color unknown words").addToggle((t) =>
        t.setValue(this.plugin.settings.showUnknownColor).onChange(async (v) => {
          this.plugin.settings.showUnknownColor = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        })
      );
      new Setting(a).setName("Color new (untracked) words").addToggle((t) =>
        t.setValue(this.plugin.settings.showNewColor).onChange(async (v) => {
          this.plugin.settings.showNewColor = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        })
      );
      this.renderFormatOptions(a);
    });
  }

  private renderFormatOptions(a: HTMLElement) {
    new Setting(a).setName("Formatting picker").setHeading();

    new Setting(a)
      .setName("Show highlight colors without Highlightr")
      .setDesc(
        "Expose highlight color options even when the Highlightr plugin is not installed. " +
          "Colors render inside the Chinese view; install Highlightr to render them elsewhere " +
          "and to customize the palette."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showHighlightColorsWithoutPlugin).onChange(async (v) => {
          this.plugin.settings.showHighlightColorsWithoutPlugin = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
          this.rerender();
        })
      );

    new Setting(a)
      .setName("Highlight overrides status / HSK colors")
      .setDesc(
        "When a word has both a highlight and a status/HSK color, show the highlight and hide " +
          "the status color. Turn off to keep the status color and hide the highlight."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.highlightOverridesStatus).onChange(async (v) => {
          this.plugin.settings.highlightOverridesStatus = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        })
      );

    new Setting(a).setDesc(
      "Drag to reorder the formatting picker, and untick to hide an option from it."
    );

    const listHost = a.createDiv();
    const renderList = () => {
      const options = orderedFormatOptions(this.plugin.app, this.plugin.settings, true);
      const hidden = this.plugin.settings.formatHidden;
      renderFormatOptionsList(listHost, {
        rows: options.map((o) => ({
          id: o.id,
          label: o.label,
          color: o.color,
          visible: !hidden.includes(o.id),
        })),
        onChange: async (rows) => {
          this.plugin.settings.formatOrder = rows.map((r) => r.id);
          this.plugin.settings.formatHidden = rows.filter((r) => !r.visible).map((r) => r.id);
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        },
      });
    };
    renderList();

    new Setting(a).addButton((b) =>
      b.setButtonText("Reset order & visibility").onClick(async () => {
        this.plugin.settings.formatOrder = [...DEFAULT_SETTINGS.formatOrder];
        this.plugin.settings.formatHidden = [];
        await this.plugin.saveSettings();
        this.plugin.refreshChineseViews();
        renderList();
      })
    );
  }

  private renderColorPickers(c: HTMLElement) {
    const bucketLabels: Array<["known" | "partial" | "unknown" | "new", string]> = [
      ["known", "Known color"],
      ["partial", "Partial color"],
      ["unknown", "Unknown color"],
      ["new", "New (untracked) color"],
    ];
    for (const [key, label] of bucketLabels) {
      new Setting(c)
        .setName(label)
        .addColorPicker((p) =>
          p
            .setValue(this.plugin.settings.customColors[key])
            .onChange(async (hex) => {
              this.plugin.settings.customColors[key] = hex;
              await this.plugin.saveSettings();
              this.plugin.refreshChineseViews();
              this.plugin.refreshStatsViews();
            })
        );
    }

    new Setting(c).setName("HSK level colors").setHeading();
    c.createEl("p", {
      cls: "cci-settings-section-desc",
      text:
        "Used when Color mode is set to HSK. Defaults are derived from your Obsidian accent color (HSK 1 lightest, HSK 7 darkest). " +
        "Each level has a color picker AND a visibility toggle.",
    });
    for (const level of ["1", "2", "3", "4", "5", "6", "7"] as const) {
      new Setting(c)
        .setName(`HSK ${level}`)
        .addToggle((t) =>
          t
            .setValue(this.plugin.settings.showHskColors[level])
            .onChange(async (v) => {
              this.plugin.settings.showHskColors[level] = v;
              await this.plugin.saveSettings();
              this.plugin.refreshChineseViews();
              this.plugin.refreshStatsViews();
            })
        )
        .addColorPicker((p) =>
          p
            .setValue(this.plugin.settings.customColors.hsk[level])
            .onChange(async (hex) => {
              this.plugin.settings.customColors.hsk[level] = hex;
              await this.plugin.saveSettings();
              this.plugin.refreshChineseViews();
              this.plugin.refreshStatsViews();
            })
        );
    }

    new Setting(c)
      .setName("Reset HSK colors to accent gradient")
      .setDesc(
        "Re-derive HSK 1–7 from your current Obsidian accent color (light → dark)."
      )
      .addButton((b) =>
        b.setButtonText("Reset HSK").onClick(async () => {
          this.plugin.settings.customColors.hsk = deriveHskColorsFromAccent();
          this.plugin.settings.hskColorsDerivedFromAccent = true;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
          this.plugin.refreshStatsViews();
          this.rerender();
        })
      );

    new Setting(c)
      .setName("Reset all colors to defaults")
      .setDesc("Reset status colors AND HSK colors. HSK re-derives from the accent.")
      .addButton((b) =>
        b.setButtonText("Reset all").onClick(async () => {
          this.plugin.settings.customColors = {
            ...DEFAULT_CUSTOM_COLORS,
            hsk: deriveHskColorsFromAccent(),
          };
          this.plugin.settings.hskColorsDerivedFromAccent = true;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
          this.plugin.refreshStatsViews();
          this.rerender();
        })
      );
  }

  private renderTokenizer(c: HTMLElement) {
    new Setting(c).setName("Tokenizer").setHeading();
    this.renderDocLink(
      c,
      "Word states & marking guide",
      "What new / partial / known / unknown / ignored mean and how to mark words from the reading view.",
      "word-states.md"
    );
    this.renderCollapsible(c, "Advanced tokenizer ▾", (a) => {
      new Setting(a).setName("Engine").addDropdown((d) => {
        d.addOption("lattice", "Dictionary lattice (recommended)");
        d.addOption("intl-segmenter", "Intl.Segmenter (helper/fallback)");
        d.addOption("experimental", "Experimental WASM (not bundled)");
        d.setValue(this.plugin.settings.tokenizerEngine);
        d.onChange(async (v) => {
          this.plugin.settings.tokenizerEngine = v as TokenizerEngine;
          await this.plugin.saveSettings();
        });
      });
      new Setting(a).setName("HSK source").addDropdown((d) => {
        d.addOption("2.0", "HSK 2.0");
        d.addOption("3.0", "HSK 3.0 / new HSK");
        d.addOption("both", "Both");
        d.setValue(this.plugin.settings.hskSource);
        d.onChange(async (v) => {
          this.plugin.settings.hskSource = v as HskSource;
          await this.plugin.saveSettings();
        });
      });
    });
  }

  private renderExposure(c: HTMLElement) {
    new Setting(c).setName("Exposure tracking").setHeading();
    this.renderDocLink(
      c,
      "Exposure tracking guide",
      "What counts as 'seeing' a word, the dedup rules, and how exposure pushes status changes.",
      "exposure.md"
    );
    this.renderCollapsible(c, "Advanced exposure ▾", (a) => {
      new Setting(a)
        .setName("Minimum visible time (ms)")
        .setDesc("How long a word must be visible before it counts as seen.")
        .addText((t) => {
          t.setValue(String(this.plugin.settings.exposure.minVisibleMs));
          t.onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!Number.isNaN(n)) {
              this.plugin.settings.exposure.minVisibleMs = n;
              await this.plugin.saveSettings();
            }
          });
        });
      new Setting(a)
        .setName("Limit: one exposure per word per note per session")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.exposure.maxOncePerNotePerSession).onChange(async (v) => {
            this.plugin.settings.exposure.maxOncePerNotePerSession = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(a)
        .setName("Limit: one exposure per word per day")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.exposure.maxOncePerDay).onChange(async (v) => {
            this.plugin.settings.exposure.maxOncePerDay = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(a).setName("Popup counts as exposure").addToggle((t) =>
        t.setValue(this.plugin.settings.exposure.popupCountsAsExposure).onChange(async (v) => {
          this.plugin.settings.exposure.popupCountsAsExposure = v;
          await this.plugin.saveSettings();
        })
      );
      new Setting(a).setName("Generated stories count as exposure").addToggle((t) =>
        t.setValue(this.plugin.settings.exposure.generatedReadingCountsAsExposure).onChange(async (v) => {
          this.plugin.settings.exposure.generatedReadingCountsAsExposure = v;
          await this.plugin.saveSettings();
        })
      );
      new Setting(a)
        .setName("Exact timestamp retention limit (per word)")
        .addText((t) => {
          t.setValue(String(this.plugin.settings.exactTimestampRetentionLimit));
          t.onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!Number.isNaN(n)) {
              this.plugin.settings.exactTimestampRetentionLimit = n;
              await this.plugin.saveSettings();
            }
          });
        });
      new Setting(a)
        .setName("Store ALL exact timestamps (storage-heavy)")
        .setDesc("Warning: enabling this disables retention pruning and can grow storage large over time.")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.storeAllExactTimestamps).onChange(async (v) => {
            this.plugin.settings.storeAllExactTimestamps = v;
            await this.plugin.saveSettings();
          })
        );
    });
  }

  private renderSrs(c: HTMLElement) {
    new Setting(c).setName("Spaced repetition").setHeading();
    this.renderDocLink(
      c,
      "Spaced repetition guide",
      "How reviews get scheduled in this plugin and which knobs to touch first.",
      "srs.md"
    );
    this.renderCollapsible(c, "Advanced SRS ▾", (a) => {
      new Setting(a).setName("Review known words occasionally").addToggle((t) =>
        t.setValue(this.plugin.settings.srs.scheduleKnownOccasionally).onChange(async (v) => {
          this.plugin.settings.srs.scheduleKnownOccasionally = v;
          await this.plugin.saveSettings();
        })
      );
      new Setting(a)
        .setName("Popup on a due word counts as a failed recall")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.srs.popupOnDueIsFailedRecall).onChange(async (v) => {
            this.plugin.settings.srs.popupOnDueIsFailedRecall = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(a).setName("Initial interval (days)").addText((t) => {
        t.setValue(String(this.plugin.settings.srs.initialIntervalDays));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n)) {
            this.plugin.settings.srs.initialIntervalDays = n;
            await this.plugin.saveSettings();
          }
        });
      });
      new Setting(a).setName("Initial ease").addText((t) => {
        t.setValue(String(this.plugin.settings.srs.initialEase));
        t.onChange(async (v) => {
          const n = parseFloat(v);
          if (!Number.isNaN(n)) {
            this.plugin.settings.srs.initialEase = n;
            await this.plugin.saveSettings();
          }
        });
      });
    });
  }

  private renderAi(c: HTMLElement) {
    new Setting(c).setName("AI provider").setHeading();
    c.createEl("p", {
      cls: "setting-item-description",
      text:
        "Plugin works fully without AI. Pick a provider below: OpenAI is the 'just works' path (paste an API key, done); " +
        "Ollama exposes all the knobs for self-hosting power-users. Switching providers preserves the inactive provider's settings.",
    });

    new Setting(c).setName("Enabled").addToggle((t) =>
      t.setValue(this.plugin.settings.ai.enabled).onChange(async (v) => {
        this.plugin.settings.ai.enabled = v;
        await this.plugin.saveSettings();
      })
    );

    new Setting(c)
      .setName("Provider")
      .setDesc("OpenAI: cloud, pay-per-token, hardcoded to GPT-5.4 mini. Ollama: self-hosted, free, your choice of model.")
      .addDropdown((d) =>
        d
          .addOption("ollama", "Ollama (local / self-hosted)")
          .addOption("openai", "OpenAI")
          .setValue(this.plugin.settings.ai.provider)
          .onChange(async (v) => {
            this.plugin.settings.ai.provider = v as AiProviderKind;
            await this.plugin.saveSettings();
            this.rerender();
          })
      );

    if (this.plugin.settings.ai.provider === "openai") {
      this.renderOpenAi(c);
    } else {
      this.renderOllama(c);
    }

    new Setting(c)
      .setName("Allow AI to rewrite pinyin when enhancing entries")
      .setDesc(
        "Off (default): the 'Enhance' button on the word popup only rewrites English definitions and the optional grammar note. " +
          "On: the model may also propose a new pinyin reading when the sentence disambiguates a polyphone (e.g. 行 xíng vs háng). " +
          "Pinyin in this plugin is canonical from CC-CEDICT, so leave this off unless you know what you're trading."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ai.enhanceCanRewritePinyin).onChange(async (v) => {
          this.plugin.settings.ai.enhanceCanRewritePinyin = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(c).setName("Test connection").addButton((b) => {
      b.setButtonText("Test").onClick(async () => {
        try {
          const ok = await this.plugin.ai.testConnection();
          new Notice(ok ? "AI provider reachable." : "AI provider unreachable.");
        } catch (e) {
          new Notice("AI test error: " + (e as Error).message);
        }
      });
    });

    this.renderCollapsible(c, "Diagnostics ▾", (a) => {
      new Setting(a)
        .setName("Verbose AI debug notifications")
        .setDesc(
          "When on, a persistent Notice tracks each AI request: fetch issued → HTTP status → first byte → streaming chunks → finish_reason. " +
            "Console logs the same milestones with elapsed seconds. Use while diagnosing a stuck request; turn off in normal use."
        )
        .addToggle((t) =>
          t.setValue(this.plugin.settings.ai.debug).onChange(async (v) => {
            this.plugin.settings.ai.debug = v;
            await this.plugin.saveSettings();
          })
        );
    });
  }

  private renderOpenAi(c: HTMLElement) {
    const help = new Setting(c).setName("OpenAI setup & cost guide");
    help.descEl.createSpan({
      text:
        "What gets sent, what it costs, how to create an API key, and how to keep the bill under $1/month. ",
    });
    help.descEl.createEl("a", {
      text: "Read the guide on GitHub →",
      href: "https://github.com/davadev/obsidian_chinese_comprehensible_input/blob/main/docs/openai-setup.md",
      attr: { target: "_blank", rel: "noopener" },
    });

    new Setting(c)
      .setName("OpenAI API key")
      .setDesc(
        "Paste your sk-… key. Stored in Obsidian's device-local key store (app.saveLocalStorage), " +
          "never written to data.json or the settings-mirror file."
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(loadApiKey(this.plugin.app, "openai")).onChange((v) => {
          saveApiKey(this.plugin.app, "openai", v);
        });
      });

    this.renderOpenAiUsage(c);
  }

  /** GPT-5.4 mini info card + rolling token / cost totals. Mimics the
   *  OpenAI pricing page layout the user referenced. */
  private renderOpenAiUsage(c: HTMLElement) {
    const wrap = c.createDiv({ cls: "cci-openai-usage" });
    wrap.createEl("div", { cls: "cci-openai-usage-name", text: OPENAI_MODEL_DISPLAY });
    wrap.createEl("p", { cls: "cci-openai-usage-desc", text: OPENAI_MODEL_DESC });

    const priceBlock = wrap.createDiv({ cls: "cci-openai-usage-pricing" });
    priceBlock.createEl("div", { cls: "cci-openai-usage-section", text: "Price" });
    const priceRow = (label: string, value: string) => {
      const row = priceBlock.createDiv({ cls: "cci-openai-usage-row" });
      row.createSpan({ cls: "cci-openai-usage-label", text: label });
      row.createSpan({ cls: "cci-openai-usage-value", text: value });
    };
    priceRow("Input:", `$${OPENAI_PRICE_PER_1M.input.toFixed(2)} / 1M tokens`);
    priceRow("Cached input:", `$${OPENAI_PRICE_PER_1M.cachedInput.toFixed(3)} / 1M tokens`);
    priceRow("Output:", `$${OPENAI_PRICE_PER_1M.output.toFixed(2)} / 1M tokens`);

    const usageBlock = wrap.createDiv({ cls: "cci-openai-usage-spent" });
    usageBlock.createEl("div", { cls: "cci-openai-usage-section", text: "Your usage" });

    const now = Date.now();
    const windows = [
      { label: "24h", ms: 24 * 60 * 60 * 1000 },
      { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
      { label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
    ];
    const entries = (this.plugin.settings.ai.usageLog ?? []).filter(
      (e) => e.provider === "openai"
    );
    const fmtTok = (n: number) =>
      n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const fmtUsd = (n: number) =>
      n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

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

  private renderOllama(c: HTMLElement) {
    const ai = this.plugin.settings.ai.ollama;
    this.renderDocLink(
      c,
      "Ollama tips & model choice",
      "Picking a model (7B vs 14B vs 32B), bumping repair iterations for weaker models, and when to send known words.",
      "ollama-tips.md"
    );
    new Setting(c).setName("Base URL").addText((t) =>
      t.setValue(ai.baseUrl).onChange(async (v) => {
        ai.baseUrl = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c)
      .setName("API key (optional)")
      .setDesc(
        "Only needed for protected Ollama proxies. Stored in Obsidian's device-local key store, never in data.json."
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(loadApiKey(this.plugin.app, "ollama")).onChange((v) => {
          saveApiKey(this.plugin.app, "ollama", v);
        });
      });
    new Setting(c).setName("Chat model").addText((t) =>
      t.setValue(ai.chatModel).onChange(async (v) => {
        ai.chatModel = v;
        await this.plugin.saveSettings();
      })
    );

    this.renderCollapsible(c, "Advanced AI ▾", (a) => {
      new Setting(a)
        .setName("Endpoint mode")
        .setDesc(
          "Pick 'Ollama native' if you reach Ollama directly (especially over Tailscale from iPhone). " +
            "Some Ollama builds expose CORS on /api/* but not /v1/*, which makes the OpenAI-compat path fail with 'Load failed'. " +
            "/v1/responses is OpenAI-only."
        )
        .addDropdown((d) => {
          d.addOption("chat", "OpenAI-compat /v1/chat/completions");
          d.addOption("ollama", "Ollama native /api/chat (recommended for Ollama)");
          d.addOption("responses", "OpenAI /v1/responses");
          d.setValue(ai.endpointMode);
          d.onChange(async (v) => {
            ai.endpointMode = v as "chat" | "responses" | "ollama";
            await this.plugin.saveSettings();
          });
        });
      new Setting(a).setName("Temperature").addText((t) =>
        t.setValue(String(ai.temperature)).onChange(async (v) => {
          const n = parseFloat(v);
          if (!Number.isNaN(n)) {
            ai.temperature = n;
            await this.plugin.saveSettings();
          }
        })
      );
      new Setting(a).setName("Max output tokens").addText((t) =>
        t.setValue(String(ai.maxOutputTokens)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n)) {
            ai.maxOutputTokens = n;
            await this.plugin.saveSettings();
          }
        })
      );
      new Setting(a).setName("Timeout (ms)").addText((t) =>
        t.setValue(String(ai.timeoutMs)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n)) {
            ai.timeoutMs = n;
            await this.plugin.saveSettings();
          }
        })
      );
      new Setting(a).setName("Max repair iterations").addText((t) =>
        t.setValue(String(ai.maxRepairIterations)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n)) {
            ai.maxRepairIterations = n;
            await this.plugin.saveSettings();
          }
        })
      );

      new Setting(a)
        .setName("Structured-output format")
        .setDesc(
          "json_object works on the widest range of providers (Ollama, OpenAI, vLLM). " +
            "json_schema is stricter but only OpenAI + Ollama >= 0.5.7 honour it. " +
            "none sends no response_format flag — the prompt alone steers the model."
        )
        .addDropdown((d) =>
          d
            .addOptions({
              json_object: "json_object (recommended)",
              json_schema: "json_schema (strict)",
              none: "none",
            })
            .setValue(ai.responseFormat)
            .onChange(async (v) => {
              ai.responseFormat = v as "json_object" | "json_schema" | "none";
              await this.plugin.saveSettings();
            })
        );

      new Setting(a)
        .setName("Stream responses (SSE)")
        .setDesc(
          "Stream tokens as the model generates instead of waiting for the full reply. " +
            "Required when the connection goes through Tailscale / a VPN / a load balancer that kills idle HTTP connections, " +
            "because streaming keeps bytes flowing so the connection never goes idle."
        )
        .addToggle((t) =>
          t.setValue(ai.stream).onChange(async (v) => {
            ai.stream = v;
            await this.plugin.saveSettings();
          })
        );

      new Setting(a)
        .setName("Suppress thinking trace")
        .setDesc(
          "Append /no_think to the system prompt so qwen3-style reasoning models skip the long thought trace " +
            "that otherwise eats the completion-token budget. Harmless to non-thinking models."
        )
        .addToggle((t) =>
          t.setValue(ai.suppressThinking).onChange(async (v) => {
            ai.suppressThinking = v;
            await this.plugin.saveSettings();
          })
        );
    });
  }

  private renderStory(c: HTMLElement) {
    new Setting(c).setName("Generated stories").setHeading();
    this.renderDocLink(
      c,
      "Story generation guide",
      "What Smart Story does end-to-end, the repair loop, and which knobs help when results disappoint.",
      "story-generation.md"
    );

    new Setting(c)
      .setName("Auto-generate a daily story")
      .setDesc(
        "When the AI provider is reachable, generate one story per day at the time below. Saves to the folder. Retries every 30 min on failure; failed days are dropped at midnight — no carry-over."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.story.autoGenerateEnabled).onChange(async (v) => {
          this.plugin.settings.story.autoGenerateEnabled = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(c)
      .setName("Daily generation time")
      .setDesc("Local 24-hour HH:MM. Default 08:00.")
      .addText((t) =>
        t
          .setPlaceholder("08:00")
          .setValue(this.plugin.settings.story.autoGenerateTime)
          .onChange(async (v) => {
            const trimmed = v.trim();
            if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
              this.plugin.settings.story.autoGenerateTime = trimmed;
              await this.plugin.saveSettings();
            }
          })
      );

    const folderSetting = new Setting(c).setName("Folder");
    let folderInput: TextComponent | null = null;
    folderSetting.addText((t) => {
      folderInput = t;
      t.setValue(this.plugin.settings.story.folder).onChange(async (v) => {
        this.plugin.settings.story.folder = v;
        await this.plugin.saveSettings();
      });
    });
    folderSetting.addButton((b) =>
      b.setButtonText("Browse").onClick(() => {
        openVaultFolderPicker(this.app, this.plugin.settings.story.folder, (path) => {
          void (async () => {
            this.plugin.settings.story.folder = path;
            await this.plugin.saveSettings();
            if (folderInput?.setValue) folderInput.setValue(path);
          })();
        });
      })
    );
    new Setting(c).setName("Default due word count").addText((t) =>
      t.setValue(String(this.plugin.settings.story.defaultDueCount)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.story.defaultDueCount = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new Setting(c).setName("Default length (chars)").addText((t) =>
      t.setValue(String(this.plugin.settings.story.defaultLengthChars)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.story.defaultLengthChars = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new Setting(c).setName("Default style").addDropdown((d) => {
      d.addOption("story", "Story");
      d.addOption("article", "Article");
      d.addOption("dialogue", "Dialogue");
      d.setValue(this.plugin.settings.story.defaultStyle);
      d.onChange(async (v) => {
        this.plugin.settings.story.defaultStyle = v as "story" | "article" | "dialogue";
        await this.plugin.saveSettings();
      });
    });
    this.renderCollapsible(c, "Advanced story options ▾", (a) => {
      new Setting(a).setName("Known coverage threshold (0..1)").addText((t) =>
        t.setValue(String(this.plugin.settings.story.knownCoverageThreshold)).onChange(async (v) => {
          const n = parseFloat(v);
          if (!Number.isNaN(n)) {
            this.plugin.settings.story.knownCoverageThreshold = n;
            await this.plugin.saveSettings();
          }
        })
      );
      new Setting(a).setName("Include glossary in note").addToggle((t) =>
        t.setValue(this.plugin.settings.story.includeGlossary).onChange(async (v) => {
          this.plugin.settings.story.includeGlossary = v;
          await this.plugin.saveSettings();
        })
      );
      new Setting(a)
        .setName("Send known words to AI")
        .setDesc("Opt in to include a sample of your known vocabulary in story prompts, so the model sees examples of your current Chinese level.")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.story.sendKnownWords ?? false).onChange(async (v) => {
            this.plugin.settings.story.sendKnownWords = v;
            await this.plugin.saveSettings();
          })
        );
      new Setting(a)
        .setName("Known words sample percent")
        .setDesc("When sending known words, randomly include this percent of all known words. Lower values keep prompts smaller.")
        .addText((t) =>
          t.setValue(String(this.plugin.settings.story.knownWordsSamplePercent ?? 30)).onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!Number.isNaN(n)) {
              this.plugin.settings.story.knownWordsSamplePercent = Math.max(1, Math.min(100, n));
              await this.plugin.saveSettings();
            }
          })
        );
    });
  }

  private renderData(c: HTMLElement) {
    new Setting(c).setName("Data").setHeading();

    new Setting(c)
      .setName("Index vault")
      .setDesc(
        "Scan every Markdown file for Chinese words and record exposures. " +
          "Runs automatically once on first plugin load; use this to scan again after large vault edits. " +
          "Scanning again records additional exposures for matching words."
      )
      .addButton((b) =>
        b.setButtonText(this.plugin.settings.vaultIndexed ? "Scan again" : "Index now").onClick(async () => {
          this.plugin.settings.vaultIndexed = false;
          await this.plugin.saveSettings();
          await indexVaultWithNotice(this.plugin);
        })
      );

    this.renderCollapsible(c, "Advanced data ▾", (a) => {
      new Setting(a)
        .setName("Auto-download dictionary on first load")
        .setDesc(
          "Silently fetch CC-CEDICT from MDBG when the vault doesn't have a dictionary yet."
        )
        .addToggle((t) =>
          t
            .setValue(this.plugin.settings.autoDownloadDictionary)
            .onChange(async (v) => {
              this.plugin.settings.autoDownloadDictionary = v;
              await this.plugin.saveSettings();
            })
        );
    });

    new Setting(c).setName("Export vocabulary JSON").addButton((b) =>
      b.setButtonText("Export JSON").onClick(async () => {
        const json = await this.plugin.vocab.exportJson();
        await navigator.clipboard.writeText(json);
        new Notice("Vocabulary JSON copied to clipboard.");
      })
    );

    new Setting(c).setName("Export vocabulary CSV").addButton((b) =>
      b.setButtonText("Export CSV").onClick(async () => {
        const csv = await this.plugin.vocab.exportCsv();
        await navigator.clipboard.writeText(csv);
        new Notice("Vocabulary CSV copied to clipboard.");
      })
    );

    const doImport = async (text: string) => {
      const result = await this.plugin.vocab.importJson(text);
      new Notice(`Imported ${result.added} new, ${result.updated} updated.`);
      this.plugin.refreshChineseViews();
      this.plugin.refreshStatsViews();
    };

    new Setting(c)
      .setName("Import vocabulary JSON")
      .setDesc("Merges records by key. Existing entries are updated; new keys are added.")
      .addButton((b) =>
        b.setButtonText("From clipboard").onClick(async () => {
          try {
            const text = await navigator.clipboard.readText();
            await doImport(text);
          } catch (err) {
            new Notice("Import failed: " + (err as Error).message);
          }
        })
      )
      .addButton((b) =>
        b.setButtonText("From file…").onClick(() => {
          const input = activeDocument.createElement("input");
          input.type = "file";
          input.accept = ".json,application/json";
          input.addEventListener("change", () => {
            void (async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              await doImport(text);
            } catch (err) {
              new Notice("Import failed: " + (err as Error).message);
            }
            })();
          });
          input.click();
        })
      );

    new Setting(c)
      .setName("Reset plugin data")
      .setDesc("Permanently deletes all word records and resets settings. Cannot be undone.")
      .addButton((b) => {
        b.setButtonText("Reset").onClick(async () => {
          if (await confirmAsync(this.app, "Really reset all plugin data?", "Reset")) {
            await this.plugin.vocab.resetAll();
            new Notice("Plugin data reset.");
          }
        });
        b.buttonEl.addClass("mod-warning");
      });
  }

  private renderSync(c: HTMLElement) {
    new Setting(c).setName("Sync (remotely-save)").setHeading();
    this.renderDocLink(
      c,
      "Vault-mirror sync guide",
      `Why this exists for users who don't sync ${this.app.vault.configDir}/, vocab vs settings mirror, and what's filtered out.`,
      "sync-mirror.md"
    );
    this.renderDocLink(
      c,
      "Conflict resolution guide",
      "How the priority list resolves two-device disagreements on word status.",
      "conflicts.md"
    );
    c.createEl("p", {
      cls: "cci-settings-section-desc",
      text:
        "Write a vault-side JSON mirror of your vocabulary so the remotely-save " +
        "plugin syncs it between devices without enabling its \"sync config dir\" " +
        "toggle. Each device merges incoming changes idempotently — no double-counted " +
        "exposures, and \"new\" never overrides a classified status.",
    });

    new Setting(c)
      .setName("Mirror vocabulary to a vault file")
      .setDesc(
        "When on, the plugin writes a copy of your vocabulary to the path below on every save and merges the file back in when remotely-save pulls a remote update."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.sync.mirrorEnabled).onChange(async (v) => {
          this.plugin.settings.sync.mirrorEnabled = v;
          await this.plugin.saveSettings();
          if (v) await this.plugin.refreshSyncMirror();
        })
      );

    const mirrorPathSetting = new Setting(c)
      .setName("Mirror file path")
      .setDesc(
        `Default: ${VOCAB_MIRROR_PATH_DEFAULT}. Must be a regular vault path (not under ${this.app.vault.configDir}/) so remotely-save picks it up.`
      );
    let mirrorPathInput: TextComponent | null = null;
    mirrorPathSetting.addText((t) => {
      mirrorPathInput = t;
      t
        .setPlaceholder(VOCAB_MIRROR_PATH_DEFAULT)
        .setValue(this.plugin.settings.sync.mirrorPath)
        .onChange(async (v) => {
          const trimmed = v.trim();
          this.plugin.settings.sync.mirrorPath = trimmed || VOCAB_MIRROR_PATH_DEFAULT;
          await this.plugin.saveSettings();
          if (this.plugin.settings.sync.mirrorEnabled) {
            await this.plugin.refreshSyncMirror();
          }
        });
    });
    mirrorPathSetting.addButton((b) =>
      b.setButtonText("Browse").onClick(() => {
        openVaultFilePicker(
          this.app,
          this.plugin.settings.sync.mirrorPath,
          { extensions: ["json"] },
          (path) => {
            void (async () => {
            this.plugin.settings.sync.mirrorPath = path;
            await this.plugin.saveSettings();
            if (mirrorPathInput?.setValue) mirrorPathInput.setValue(path);
            if (this.plugin.settings.sync.mirrorEnabled) {
              await this.plugin.refreshSyncMirror();
            }
            })();
          }
        );
      })
    );

    new Setting(c)
      .setName("Auto re-sync interval (minutes)")
      .setDesc(
        "How often to re-check the mirror file on disk for changes pulled in by remotely-save. " +
        "0 disables auto-poll (manual \"Force re-sync now\" still works). Minimum effective interval is 30 seconds."
      )
      .addText((t) =>
        t
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.sync.mirrorPollIntervalMinutes ?? 5))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.sync.mirrorPollIntervalMinutes =
              Number.isFinite(n) && n >= 0 ? n : 5;
            await this.plugin.saveSettings();
            this.plugin.startSyncMirrorPoller();
          })
      );

    new Setting(c)
      .setName("Force re-sync now")
      .setDesc(
        "Re-read the mirror file, merge any pending changes (including remotely-save conflict files), and write the result back."
      )
      .addButton((b) =>
        b.setButtonText("Re-sync").onClick(async () => {
          if (!this.plugin.settings.sync.mirrorEnabled) {
            new Notice("Mirror is off — enable it first.");
            return;
          }
          await this.plugin.vocab.reloadMirror();
          this.plugin.refreshChineseViews();
          this.plugin.refreshStatsViews();
          new Notice("Vocabulary mirror re-synced.");
        })
      );

    this.renderCollapsible(c, "Advanced sync ▾", (a) => {
    new Setting(a).setName("Conflict resolution priority").setHeading();
    a.createEl("p", {
      cls: "cci-settings-section-desc",
      text:
        "When two devices set different statuses on the same word, the status higher in this list wins — overriding the timestamp. " +
        "\"New\" always loses to any classified status (hardcoded). Drag rows or use the arrow buttons to reorder.",
    });
    const listHost = a.createDiv();
    renderStatusPriorityList(listHost, {
      values: this.plugin.settings.sync.statusPriority,
      onChange: async (next) => {
        this.plugin.settings.sync.statusPriority = next;
        await this.plugin.saveSettings();
      },
    });
    new Setting(a)
      .setName("Reset priority list to default")
      .addButton((b) =>
        b.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.sync.statusPriority = [...DEFAULT_STATUS_PRIORITY];
          await this.plugin.saveSettings();
          renderStatusPriorityList(listHost, {
            values: this.plugin.settings.sync.statusPriority,
            onChange: async (next: WordStatus[]) => {
              this.plugin.settings.sync.statusPriority = next;
              await this.plugin.saveSettings();
            },
          });
        })
      );

    // ----- Settings mirror (preferences sync) -----
    new Setting(a).setName("Sync between devices").setHeading();
    a.createEl("p", {
      cls: "cci-settings-section-desc",
      text:
        "Optional: mirror your display + behavioral settings to a vault-side JSON file so other devices can pick them up via remotely-save / Nextcloud. Excluded from the mirror: AI credentials, mirror paths, per-device dictionary state.",
    });
    new Setting(a)
      .setName("Mirror settings to a vault file")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.sync.settingsMirrorEnabled).onChange(async (v) => {
          this.plugin.settings.sync.settingsMirrorEnabled = v;
          await this.plugin.saveSettings();
          if (v) await this.plugin.settingsMirror.bootstrap();
        })
      );
    const settingsMirrorPathSetting = new Setting(a).setName("Settings mirror file path");
    let settingsMirrorPathInput: TextComponent | null = null;
    settingsMirrorPathSetting.addText((t) => {
      settingsMirrorPathInput = t;
      t
        .setValue(this.plugin.settings.sync.settingsMirrorPath)
        .onChange(async (v) => {
          this.plugin.settings.sync.settingsMirrorPath = v.trim() || "Chinese Learning/cci-settings.json";
          await this.plugin.saveSettings();
        });
    });
    settingsMirrorPathSetting.addButton((b) =>
      b.setButtonText("Browse").onClick(() => {
        openVaultFilePicker(
          this.app,
          this.plugin.settings.sync.settingsMirrorPath,
          { extensions: ["json"] },
          (path) => {
            void (async () => {
              this.plugin.settings.sync.settingsMirrorPath = path;
              await this.plugin.saveSettings();
              if (settingsMirrorPathInput?.setValue) settingsMirrorPathInput.setValue(path);
            })();
          }
        );
      })
    );

    new Setting(a)
      .setName("Push current settings to mirror now")
      .setDesc(
        "Force-write this device's settings to the mirror file, bypassing the fresh-install touched check. Use when the other device's changes haven't propagated and you want to seed the file from here."
      )
      .addButton((b) =>
        b.setButtonText("Push").setCta().onClick(async () => {
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
        })
      );

    // ----- Backup / Restore (one-shot export / import) -----
    new Setting(a).setName("Backup / restore").setHeading();
    a.createEl("p", {
      cls: "cci-settings-section-desc",
      text:
        "Export your settings to a JSON file inside the vault, or restore from one. Sensitive fields (AI key, sync paths) are excluded from both directions.",
    });
    let exportPath = SETTINGS_EXPORT_DEFAULT_PATH;
    const exportSetting = new Setting(a).setName("Export path");
    let exportPathInput: TextComponent | null = null;
    exportSetting.addText((t) => {
      exportPathInput = t;
      t.setValue(exportPath).onChange((v) => {
        exportPath = v.trim() || SETTINGS_EXPORT_DEFAULT_PATH;
      });
    });
    exportSetting.addButton((b) =>
      b.setButtonText("Export").setCta().onClick(async () => {
        try {
          await exportSettings(this.plugin, exportPath);
          new Notice(`Settings exported to ${exportPath}`);
        } catch (e) {
          new Notice("Export failed: " + (e as Error).message);
        }
      })
    );

    let importPath = SETTINGS_EXPORT_DEFAULT_PATH;
    const importSetting = new Setting(a).setName("Import path");
    let importPathInput: TextComponent | null = null;
    importSetting.addText((t) => {
      importPathInput = t;
      t.setValue(importPath).onChange((v) => {
        importPath = v.trim();
      });
    });
    importSetting.addButton((b) =>
      b.setButtonText("Browse").onClick(() => {
        openVaultFilePicker(this.app, importPath, { extensions: ["json"] }, (path) => {
          importPath = path;
          if (importPathInput?.setValue) importPathInput.setValue(path);
        });
      })
    );
    importSetting.addButton((b) => {
      b.setButtonText("Import").onClick(async () => {
        if (!importPath) {
          new Notice("Pick an import path first.");
          return;
        }
        if (!(await confirmAsync(this.app, "Import settings from " + importPath + "? Your current settings will be overwritten where the file has values.", "Import"))) return;
        try {
          const { applied, skipped } = await importSettings(this.plugin, importPath);
          const skip = skipped.length ? ` (skipped sensitive: ${skipped.join(", ")})` : "";
          new Notice(`Imported ${applied} top-level keys${skip}.`);
          this.rerender();
        } catch (e) {
          new Notice("Import failed: " + (e as Error).message);
        }
      });
      b.buttonEl.addClass("mod-warning");
    });
    void exportPathInput;
    });
  }

  private renderAbout(c: HTMLElement) {
    new Setting(c).setName("About / Licenses").setHeading();
    this.renderDocLink(
      c,
      "Documentation index",
      "Browse the full set of user guides on GitHub: FAQ, AI tips, SRS, sync, word states, and more.",
      "index.md"
    );
    this.renderDocLink(
      c,
      "Frequently asked questions",
      "Quick answers to the top issues users hit.",
      "faq.md"
    );
    const ul = c.createEl("ul");
    ul.createEl("li", { text: "Dictionary: CC-CEDICT (CC BY-SA 4.0)" });
    ul.createEl("li", { text: "HSK overlay: Complete HSK Vocabulary (MIT)" });
    ul.createEl("li", { text: "Plugin code: MIT" });
    c.createEl("p", {
      text:
        "See NOTICE.md in the plugin folder for attribution details and release-blocker reminder.",
    });
  }
}
