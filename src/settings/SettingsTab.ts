import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CciPlugin from "../main";
import { indexVaultWithNotice } from "../vocabulary/VaultIndexer";
import { renderStatusPriorityList } from "./StatusPriorityList";
import { DEFAULT_CUSTOM_COLORS, DEFAULT_STATUS_PRIORITY } from "./defaults";
import { deriveHskColorsFromAccent } from "../ui/colorTheme";
import { VOCAB_MIRROR_PATH_DEFAULT } from "../constants";
import { WordStatus } from "../vocabulary/VocabularyTypes";

export class CciSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: CciPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Chinese Comprehensible Input" });

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

  private renderDataManagement(c: HTMLElement) {
    c.createEl("h3", { text: "Data Management" });
    new Setting(c)
      .setDesc("Dashboard, per-note breakdown, flashcards, and the full word list.")
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => this.plugin.openStatsView())
      );
  }

  private renderDictionary(c: HTMLElement) {
    c.createEl("h3", { text: "Dictionaries" });

    new Setting(c)
      .setName("Use CC-CEDICT")
      .setDesc("Include CC-CEDICT entries in popups, tokenization, and pinyin lookup.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.useCedict).onChange(async (v) => {
          this.plugin.settings.useCedict = v;
          await this.plugin.saveSettings();
          this.plugin.tokenizer.invalidate();
          this.plugin.refreshChineseViews();
        })
      );
    new Setting(c)
      .setName("Use ECDICT (reverse English→Chinese)")
      .setDesc(
        "Show English headwords whose Chinese translation contains the looked-up surface. Read-only; appears as a separate section in the popup. Source: skywind3000/ECDICT (MIT)."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.useEcdict).onChange(async (v) => {
          this.plugin.settings.useEcdict = v;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
        })
      );

    c.createEl("h4", { text: "CC-CEDICT" });
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
      .addButton((b) =>
        b.setButtonText("Remove").setWarning().onClick(async () => {
          if (!confirm("Delete the downloaded CC-CEDICT file from the vault?")) return;
          const path = this.plugin.settings.dictionarySource?.outputPath ?? ".cci-dictionary.json";
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
        })
      );

    // Detach status listener when the settings tab rebuilds.
    this.plugin.register(() => unsub());

    // ----- ECDICT (reverse English→Chinese) -----
    c.createEl("h4", { text: "ECDICT (reverse English→Chinese)" });
    c.createEl("p", {
      cls: "setting-item-description",
      text:
        "Optional. Download skywind3000/ECDICT full CSV (~65 MB, ~770k rows, MIT). WARNING: the download is heavy and has OOM-crashed iOS Obsidian in testing — recommended on desktop only. Files are parsed into a Chinese→English reverse index (~25-50 MB JSON) stored locally. Looking up a Chinese word in the popup also shows English headwords whose translation contains it.",
    });

    const ecdictStatusEl = c.createDiv({ cls: "setting-item-description" });
    const updateEcdictStatusEl = () => {
      const meta = this.plugin.settings.dictionaryEcdictSource;
      const live = this.plugin.ecdictDownloader.getStatus();
      if (live.state === "downloading" || live.state === "parsing" || live.state === "writing") {
        ecdictStatusEl.setText(
          `${live.message} (rows ${live.entriesParsed} → buckets ${live.reverseBuckets})`
        );
        return;
      }
      if (meta) {
        ecdictStatusEl.setText(
          `Active: ${meta.source} · ${meta.entryCount} buckets · downloaded ${meta.downloadedAt.slice(0, 10)} · file ${meta.outputPath}`
        );
      } else {
        ecdictStatusEl.setText("ECDICT not yet downloaded.");
      }
    };
    updateEcdictStatusEl();
    const ecdictUnsub = this.plugin.ecdictDownloader.onStatus(() => updateEcdictStatusEl());

    new Setting(c)
      .setName("Download ECDICT")
      .setDesc("Fetches ecdict.csv (~65 MB) from the upstream GitHub repo and builds the reverse-lookup index in the vault. One-time download per device.")
      .addButton((b) =>
        b
          .setButtonText("Download ECDICT")
          .setCta()
          .onClick(async () => {
            b.setDisabled(true);
            try {
              const result = await this.plugin.ecdictDownloader.run();
              const status = this.plugin.ecdictDownloader.getStatus();
              this.plugin.settings.dictionaryEcdictSource = {
                source: "ECDICT",
                versionLine: "skywind3000/ECDICT full",
                downloadedAt: status.downloadedAt ?? new Date().toISOString(),
                entryCount: result.buckets,
                outputPath: ".cci-ecdict.json",
              };
              await this.plugin.saveSettings();
              await this.plugin.dictionary.reload();
              new Notice(`ECDICT installed: ${result.entries} rows → ${result.buckets} buckets.`);
            } catch (e) {
              new Notice("ECDICT download failed: " + (e as Error).message);
            } finally {
              b.setDisabled(false);
              updateEcdictStatusEl();
            }
          })
      )
      .addButton((b) =>
        b.setButtonText("Remove").setWarning().onClick(async () => {
          if (!confirm("Delete the downloaded ECDICT file from the vault?")) return;
          const path = this.plugin.settings.dictionaryEcdictSource?.outputPath ?? ".cci-ecdict.json";
          try {
            if (await this.app.vault.adapter.exists(path)) {
              await this.app.vault.adapter.remove(path);
            }
            this.plugin.settings.dictionaryEcdictSource = undefined;
            await this.plugin.saveSettings();
            await this.plugin.dictionary.reload();
            new Notice("ECDICT removed.");
          } catch (e) {
            new Notice("Remove failed: " + (e as Error).message);
          }
          updateEcdictStatusEl();
        })
      );

    c.createEl("p", {
      cls: "setting-item-description",
      text:
        "Attribution: ECDICT by skywind3000 (https://github.com/skywind3000/ECDICT), MIT License. CC-CEDICT data is licensed CC BY-SA 4.0 by MDBG (https://www.mdbg.net/chinese/dictionary?page=cc-cedict).",
    });

    this.plugin.register(() => ecdictUnsub());
  }

  private renderDisplay(c: HTMLElement) {
    c.createEl("h3", { text: "Display" });
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
          this.plugin.settings.defaultDisplayMode = v as any;
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
          this.plugin.settings.colorMode = v as any;
          await this.plugin.saveSettings();
          this.plugin.refreshChineseViews();
          this.plugin.refreshStatsViews();
        });
      });

    new Setting(c)
      .setName("Pinyin style")
      .addDropdown((d) => {
        d.addOption("marks", "Tone marks");
        d.addOption("numbers", "Tone numbers");
        d.addOption("none", "None");
        d.setValue(this.plugin.settings.pinyinStyle);
        d.onChange(async (v) => {
          this.plugin.settings.pinyinStyle = v as any;
          await this.plugin.saveSettings();
        });
      });

    new Setting(c)
      .setName("Reader font size (px)")
      .setDesc("Base font size used inside the Chinese Learning View.")
      .addSlider((s) =>
        s
          .setLimits(14, 40, 1)
          .setValue(this.plugin.settings.readerFontPx ?? 22)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.readerFontPx = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(c)
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

    new Setting(c)
      .setName("Known-word popups")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.knownWordPopups).onChange(async (v) => {
          this.plugin.settings.knownWordPopups = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(c)
      .setName("Show mnemonic before full definition")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.mnemonicsFirst).onChange(async (v) => {
          this.plugin.settings.mnemonicsFirst = v;
          await this.plugin.saveSettings();
        })
      );

    this.renderColorPickers(c);

    new Setting(c).setName("Color known words").addToggle((t) =>
      t.setValue(this.plugin.settings.showKnownColor).onChange(async (v) => {
        this.plugin.settings.showKnownColor = v;
        await this.plugin.saveSettings();
        this.plugin.refreshChineseViews();
      })
    );
    new Setting(c).setName("Color partial words").addToggle((t) =>
      t.setValue(this.plugin.settings.showPartialColor).onChange(async (v) => {
        this.plugin.settings.showPartialColor = v;
        await this.plugin.saveSettings();
        this.plugin.refreshChineseViews();
      })
    );
    new Setting(c).setName("Color unknown words").addToggle((t) =>
      t.setValue(this.plugin.settings.showUnknownColor).onChange(async (v) => {
        this.plugin.settings.showUnknownColor = v;
        await this.plugin.saveSettings();
        this.plugin.refreshChineseViews();
      })
    );
    new Setting(c).setName("Color new (untracked) words").addToggle((t) =>
      t.setValue(this.plugin.settings.showNewColor).onChange(async (v) => {
        this.plugin.settings.showNewColor = v;
        await this.plugin.saveSettings();
        this.plugin.refreshChineseViews();
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

    c.createEl("h4", { text: "HSK level colors" });
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
          this.display();
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
          this.display();
        })
      );
  }

  private renderTokenizer(c: HTMLElement) {
    c.createEl("h3", { text: "Tokenizer" });
    new Setting(c).setName("Engine").addDropdown((d) => {
      d.addOption("lattice", "Dictionary lattice (recommended)");
      d.addOption("intl-segmenter", "Intl.Segmenter (helper/fallback)");
      d.addOption("experimental", "Experimental WASM (not bundled)");
      d.setValue(this.plugin.settings.tokenizerEngine);
      d.onChange(async (v) => {
        this.plugin.settings.tokenizerEngine = v as any;
        await this.plugin.saveSettings();
      });
    });

    new Setting(c).setName("HSK source").addDropdown((d) => {
      d.addOption("2.0", "HSK 2.0");
      d.addOption("3.0", "HSK 3.0 / new HSK");
      d.addOption("both", "Both");
      d.setValue(this.plugin.settings.hskSource);
      d.onChange(async (v) => {
        this.plugin.settings.hskSource = v as any;
        await this.plugin.saveSettings();
      });
    });
  }

  private renderExposure(c: HTMLElement) {
    c.createEl("h3", { text: "Exposure tracking" });
    new Setting(c)
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

    new Setting(c)
      .setName("Limit: one exposure per word per note per session")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exposure.maxOncePerNotePerSession).onChange(async (v) => {
          this.plugin.settings.exposure.maxOncePerNotePerSession = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(c)
      .setName("Limit: one exposure per word per day")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exposure.maxOncePerDay).onChange(async (v) => {
          this.plugin.settings.exposure.maxOncePerDay = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(c).setName("Popup counts as exposure").addToggle((t) =>
      t.setValue(this.plugin.settings.exposure.popupCountsAsExposure).onChange(async (v) => {
        this.plugin.settings.exposure.popupCountsAsExposure = v;
        await this.plugin.saveSettings();
      })
    );

    new Setting(c).setName("Generated stories count as exposure").addToggle((t) =>
      t.setValue(this.plugin.settings.exposure.generatedReadingCountsAsExposure).onChange(async (v) => {
        this.plugin.settings.exposure.generatedReadingCountsAsExposure = v;
        await this.plugin.saveSettings();
      })
    );

    new Setting(c)
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

    new Setting(c)
      .setName("Store ALL exact timestamps (storage-heavy)")
      .setDesc("Warning: enabling this disables retention pruning and can grow storage large over time.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.storeAllExactTimestamps).onChange(async (v) => {
          this.plugin.settings.storeAllExactTimestamps = v;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderSrs(c: HTMLElement) {
    c.createEl("h3", { text: "Spaced repetition" });
    new Setting(c).setName("Review known words occasionally").addToggle((t) =>
      t.setValue(this.plugin.settings.srs.scheduleKnownOccasionally).onChange(async (v) => {
        this.plugin.settings.srs.scheduleKnownOccasionally = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c)
      .setName("Popup on a due word counts as a failed recall")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.srs.popupOnDueIsFailedRecall).onChange(async (v) => {
          this.plugin.settings.srs.popupOnDueIsFailedRecall = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(c).setName("Initial interval (days)").addText((t) => {
      t.setValue(String(this.plugin.settings.srs.initialIntervalDays));
      t.onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.srs.initialIntervalDays = n;
          await this.plugin.saveSettings();
        }
      });
    });
    new Setting(c).setName("Initial ease").addText((t) => {
      t.setValue(String(this.plugin.settings.srs.initialEase));
      t.onChange(async (v) => {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) {
          this.plugin.settings.srs.initialEase = n;
          await this.plugin.saveSettings();
        }
      });
    });
  }

  private renderAi(c: HTMLElement) {
    c.createEl("h3", { text: "AI provider" });
    c.createEl("p", {
      cls: "setting-item-description",
      text:
        "Plugin works fully without AI. When enabled, the provider must be OpenAI-compatible. " +
        "For Ollama, the default localhost URL is for desktop only; on mobile use the LAN host/IP of the Ollama machine.",
    });

    new Setting(c).setName("Enabled").addToggle((t) =>
      t.setValue(this.plugin.settings.ai.enabled).onChange(async (v) => {
        this.plugin.settings.ai.enabled = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c).setName("Provider name").addText((t) =>
      t.setValue(this.plugin.settings.ai.providerName).onChange(async (v) => {
        this.plugin.settings.ai.providerName = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c).setName("Base URL").addText((t) =>
      t.setValue(this.plugin.settings.ai.baseUrl).onChange(async (v) => {
        this.plugin.settings.ai.baseUrl = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c).setName("API key").addText((t) =>
      t.setValue(this.plugin.settings.ai.apiKey).onChange(async (v) => {
        this.plugin.settings.ai.apiKey = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c).setName("Chat model").addText((t) =>
      t.setValue(this.plugin.settings.ai.chatModel).onChange(async (v) => {
        this.plugin.settings.ai.chatModel = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c)
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
        d.setValue(this.plugin.settings.ai.endpointMode);
        d.onChange(async (v) => {
          this.plugin.settings.ai.endpointMode = v as "chat" | "responses" | "ollama";
          await this.plugin.saveSettings();
        });
      });
    new Setting(c).setName("Temperature").addText((t) =>
      t.setValue(String(this.plugin.settings.ai.temperature)).onChange(async (v) => {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) {
          this.plugin.settings.ai.temperature = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new Setting(c).setName("Max output tokens").addText((t) =>
      t.setValue(String(this.plugin.settings.ai.maxOutputTokens)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.ai.maxOutputTokens = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new Setting(c).setName("Timeout (ms)").addText((t) =>
      t.setValue(String(this.plugin.settings.ai.timeoutMs)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.ai.timeoutMs = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new Setting(c).setName("Max repair iterations").addText((t) =>
      t.setValue(String(this.plugin.settings.ai.maxRepairIterations)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) {
          this.plugin.settings.ai.maxRepairIterations = n;
          await this.plugin.saveSettings();
        }
      })
    );

    new Setting(c)
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
          .setValue(this.plugin.settings.ai.responseFormat)
          .onChange(async (v) => {
            this.plugin.settings.ai.responseFormat = v as "json_object" | "json_schema" | "none";
            await this.plugin.saveSettings();
          })
      );

    new Setting(c)
      .setName("Stream responses (SSE)")
      .setDesc(
        "Stream tokens as the model generates instead of waiting for the full reply. " +
          "Required when the connection goes through Tailscale / a VPN / a load balancer that kills idle HTTP connections, " +
          "because streaming keeps bytes flowing so the connection never goes idle."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.ai.stream)
          .onChange(async (v) => {
            this.plugin.settings.ai.stream = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(c)
      .setName("Suppress thinking trace")
      .setDesc(
        "Append /no_think to the system prompt so qwen3-style reasoning models skip the long thought trace " +
          "that otherwise eats the completion-token budget. Harmless to non-thinking models."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.ai.suppressThinking)
          .onChange(async (v) => {
            this.plugin.settings.ai.suppressThinking = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(c)
      .setName("Verbose AI debug notifications")
      .setDesc(
        "When on, a persistent Notice tracks each AI request: fetch issued → HTTP status → first byte → streaming chunks → finish_reason. " +
          "Console logs the same milestones with elapsed seconds. Use while diagnosing a stuck request; turn off in normal use."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.ai.debug)
          .onChange(async (v) => {
            this.plugin.settings.ai.debug = v;
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
  }

  private renderStory(c: HTMLElement) {
    c.createEl("h3", { text: "Generated stories" });
    new Setting(c).setName("Folder").addText((t) =>
      t.setValue(this.plugin.settings.story.folder).onChange(async (v) => {
        this.plugin.settings.story.folder = v;
        await this.plugin.saveSettings();
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
        this.plugin.settings.story.defaultStyle = v as any;
        await this.plugin.saveSettings();
      });
    });
    new Setting(c).setName("Known coverage threshold (0..1)").addText((t) =>
      t.setValue(String(this.plugin.settings.story.knownCoverageThreshold)).onChange(async (v) => {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) {
          this.plugin.settings.story.knownCoverageThreshold = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new Setting(c).setName("Include glossary in note").addToggle((t) =>
      t.setValue(this.plugin.settings.story.includeGlossary).onChange(async (v) => {
        this.plugin.settings.story.includeGlossary = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c)
      .setName("Send known words to AI")
      .setDesc("Opt in to include a sample of your known vocabulary in story prompts, so the model sees examples of your current Chinese level.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.story.sendKnownWords ?? false).onChange(async (v) => {
          this.plugin.settings.story.sendKnownWords = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(c)
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
  }

  private renderData(c: HTMLElement) {
    c.createEl("h3", { text: "Data" });

    new Setting(c)
      .setName("Index vault")
      .setDesc(
        "Scan every Markdown file for Chinese words and record exposures. " +
          "Runs automatically once on first plugin load; use this to re-scan after large vault edits."
      )
      .addButton((b) =>
        b.setButtonText(this.plugin.settings.vaultIndexed ? "Reindex" : "Index now").onClick(async () => {
          this.plugin.settings.vaultIndexed = false;
          await this.plugin.saveSettings();
          await indexVaultWithNotice(this.plugin);
        })
      );

    new Setting(c)
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
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json,application/json";
          input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              await doImport(text);
            } catch (err) {
              new Notice("Import failed: " + (err as Error).message);
            }
          });
          input.click();
        })
      );

    new Setting(c)
      .setName("Reset plugin data")
      .setDesc("Permanently deletes all word records and resets settings. Cannot be undone.")
      .addButton((b) =>
        b.setButtonText("Reset").setWarning().onClick(async () => {
          if (confirm("Really reset all plugin data?")) {
            await this.plugin.vocab.resetAll();
            new Notice("Plugin data reset.");
          }
        })
      );
  }

  private renderSync(c: HTMLElement) {
    c.createEl("h3", { text: "Sync (remotely-save)" });
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

    new Setting(c)
      .setName("Mirror file path")
      .setDesc(
        `Default: ${VOCAB_MIRROR_PATH_DEFAULT}. Must be a regular vault path (not under .obsidian/) so remotely-save picks it up.`
      )
      .addText((t) =>
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
          })
      );

    c.createEl("h4", { text: "Conflict resolution priority" });
    c.createEl("p", {
      cls: "cci-settings-section-desc",
      text:
        "When two devices set different statuses on the same word, the status higher in this list wins — overriding the timestamp. " +
        "\"New\" always loses to any classified status (hardcoded). Drag rows or use the arrow buttons to reorder.",
    });

    const listHost = c.createDiv();
    renderStatusPriorityList(listHost, {
      values: this.plugin.settings.sync.statusPriority,
      onChange: async (next) => {
        this.plugin.settings.sync.statusPriority = next;
        await this.plugin.saveSettings();
      },
    });

    new Setting(c)
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
  }

  private renderAbout(c: HTMLElement) {
    c.createEl("h3", { text: "About / Licenses" });
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
