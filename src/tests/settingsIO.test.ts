import { describe, it, expect } from "vitest";
import { filterSettingsForSharing } from "../settings/SettingsIO";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { CciSettings } from "../settings/types";

function cloneDefaults(): CciSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

describe("filterSettingsForSharing", () => {
  it("strips ai.ollama.apiKey + ai.usageLog but keeps ollama base URL + model + endpoint mode", () => {
    const s = cloneDefaults();
    s.ai.ollama.apiKey = "secret-do-not-leak";
    s.ai.ollama.baseUrl = "http://192.168.1.10:11434/v1";
    s.ai.ollama.chatModel = "qwen2.5:14b";
    s.ai.ollama.endpointMode = "ollama";
    s.ai.ollama.temperature = 0.42;
    s.ai.usageLog = [
      { ts: Date.now(), provider: "openai", inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 },
    ];
    const out = filterSettingsForSharing(s) as any;
    expect(out.ai.ollama.apiKey).toBeUndefined();
    expect(out.ai.usageLog).toBeUndefined();
    expect(out.ai.ollama.baseUrl).toBe("http://192.168.1.10:11434/v1");
    expect(out.ai.ollama.chatModel).toBe("qwen2.5:14b");
    expect(out.ai.ollama.endpointMode).toBe("ollama");
    expect(out.ai.ollama.temperature).toBe(0.42);
  });

  it("strips all sync-config keys that are device-local", () => {
    const s = cloneDefaults();
    s.sync.mirrorEnabled = true;
    s.sync.mirrorPath = "Chinese Learning/vocabulary.json";
    s.sync.settingsMirrorEnabled = true;
    s.sync.settingsMirrorPath = "Chinese Learning/cci-settings.json";
    const out = filterSettingsForSharing(s) as any;
    expect(out.sync.mirrorEnabled).toBeUndefined();
    expect(out.sync.mirrorPath).toBeUndefined();
    expect(out.sync.settingsMirrorEnabled).toBeUndefined();
    expect(out.sync.settingsMirrorPath).toBeUndefined();
  });

  it("keeps sync.statusPriority and sync.mirrorPollIntervalMinutes", () => {
    const s = cloneDefaults();
    s.sync.statusPriority = ["known", "unknown", "new"] as any;
    s.sync.mirrorPollIntervalMinutes = 7;
    const out = filterSettingsForSharing(s) as any;
    expect(out.sync.statusPriority).toEqual(["known", "unknown", "new"]);
    expect(out.sync.mirrorPollIntervalMinutes).toBe(7);
  });

  it("strips top-level device-local keys: schemaVersion, dictionarySource, hskColorsDerivedFromAccent, vaultIndexed", () => {
    const s = cloneDefaults();
    s.dictionarySource = {
      source: "CC-CEDICT",
      versionLine: "v1",
      downloadedAt: "2026-01-01T00:00:00Z",
      entryCount: 999,
      outputPath: ".cci-dictionary.json",
    };
    s.hskColorsDerivedFromAccent = true;
    s.vaultIndexed = true;
    const out = filterSettingsForSharing(s) as any;
    expect(out.schemaVersion).toBeUndefined();
    expect(out.dictionarySource).toBeUndefined();
    expect(out.hskColorsDerivedFromAccent).toBeUndefined();
    expect(out.vaultIndexed).toBeUndefined();
  });

  it("keeps display preferences (defaultDisplayMode, colorMode, pinyinStyle, customColors)", () => {
    const s = cloneDefaults();
    s.defaultDisplayMode = "three-line";
    s.colorMode = "hsk";
    s.pinyinStyle = "numbers";
    s.customColors.known = "#abcdef";
    const out = filterSettingsForSharing(s) as any;
    expect(out.defaultDisplayMode).toBe("three-line");
    expect(out.colorMode).toBe("hsk");
    expect(out.pinyinStyle).toBe("numbers");
    expect(out.customColors.known).toBe("#abcdef");
  });

  it("returns a fresh object — mutating the result does not change the input", () => {
    const s = cloneDefaults();
    s.ai.ollama.chatModel = "original-model";
    const out = filterSettingsForSharing(s) as any;
    out.ai.ollama.chatModel = "mutated";
    expect(s.ai.ollama.chatModel).toBe("original-model");
  });

  it("survives missing nested ai / sync objects without throwing", () => {
    const partial = { defaultDisplayMode: "none" } as any;
    expect(() => filterSettingsForSharing(partial)).not.toThrow();
  });
});
