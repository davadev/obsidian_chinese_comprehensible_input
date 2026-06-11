import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CciPlugin from "../main";
import { indexVaultWithNotice } from "../vocabulary/VaultIndexer";

export class CciSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: CciPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Chinese Comprehensible Input" });

    this.renderDictionary(containerEl);
    this.renderDisplay(containerEl);
    this.renderColors(containerEl);
    this.renderTokenizer(containerEl);
    this.renderExposure(containerEl);
    this.renderSrs(containerEl);
    this.renderAi(containerEl);
    this.renderStory(containerEl);
    this.renderData(containerEl);
    this.renderAbout(containerEl);
  }

  private renderDictionary(c: HTMLElement) {
    c.createEl("h3", { text: "Dictionary" });
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
  }

  private renderDisplay(c: HTMLElement) {
    c.createEl("h3", { text: "Display" });
    new Setting(c)
      .setName("Default display mode")
      .setDesc("How annotations are shown by default in Read mode.")
      .addDropdown((d) => {
        d.addOption("two-line", "Two-line (pinyin)");
        d.addOption("three-line", "Three-line (pinyin + gloss)");
        d.addOption("popup-only", "Popup only");
        d.addOption("color-only", "Color only");
        d.setValue(this.plugin.settings.defaultDisplayMode);
        d.onChange(async (v) => {
          this.plugin.settings.defaultDisplayMode = v as any;
          await this.plugin.saveSettings();
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
  }

  private renderColors(c: HTMLElement) {
    c.createEl("h3", { text: "Colors" });
    new Setting(c).setName("Color known words").addToggle((t) =>
      t.setValue(this.plugin.settings.showKnownColor).onChange(async (v) => {
        this.plugin.settings.showKnownColor = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c).setName("Color partial words").addToggle((t) =>
      t.setValue(this.plugin.settings.showPartialColor).onChange(async (v) => {
        this.plugin.settings.showPartialColor = v;
        await this.plugin.saveSettings();
      })
    );
    new Setting(c).setName("Color unknown words").addToggle((t) =>
      t.setValue(this.plugin.settings.showUnknownColor).onChange(async (v) => {
        this.plugin.settings.showUnknownColor = v;
        await this.plugin.saveSettings();
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
      .setName("Open vocabulary stats")
      .setDesc("Dashboard, per-note breakdown, and the full word list.")
      .addButton((b) =>
        b.setButtonText("Open stats").onClick(() => this.plugin.openStatsView())
      );

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
