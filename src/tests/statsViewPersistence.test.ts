import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { filterSettingsForSharing } from "../settings/SettingsIO";
import { DEFAULT_RADAR_TOPICS, TOPIC_IDS } from "../dictionary/topicMap.generated";

/**
 * StatsView's dashboard checkboxes (Progress chart series + HSK coverage
 * buckets) used to live as in-memory instance fields on the view, so any
 * change vanished when the user reopened the tab. The 0.3.x fix moved
 * them into `CciSettings` and routes the change handlers through
 * `saveSettings()`. These tests cover the data-layer side of that
 * contract — that the defaults match the previous in-memory values,
 * that a JSON roundtrip preserves a mutated state, and that the
 * settings-mirror filter does not strip the new fields.
 */
describe("StatsView checkbox persistence", () => {
  it("ships the same defaults the in-memory fields used to carry", () => {
    expect(DEFAULT_SETTINGS.progressChartSeries).toEqual({
      tracked: false,
      classified: true,
      known: true,
      partial: false,
      unknown: false,
    });
    expect(DEFAULT_SETTINGS.hskCoverageBuckets).toEqual({
      known: true,
      partial: false,
      unknown: false,
      new: false,
      untracked: false,
    });
  });

  it("survives a JSON save → reload roundtrip (the data.json path)", () => {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
    settings.progressChartSeries.tracked = true;
    settings.progressChartSeries.classified = false;
    settings.progressChartSeries.partial = true;
    settings.hskCoverageBuckets.partial = true;
    settings.hskCoverageBuckets.new = true;

    const written = JSON.stringify({ settings });
    const reloaded = JSON.parse(written) as { settings: typeof DEFAULT_SETTINGS };

    expect(reloaded.settings.progressChartSeries).toEqual({
      tracked: true,
      classified: false,
      known: true,
      partial: true,
      unknown: false,
    });
    expect(reloaded.settings.hskCoverageBuckets).toEqual({
      known: true,
      partial: true,
      unknown: false,
      new: true,
      untracked: false,
    });
  });

  it("survives the settings-mirror filter so cross-device sync carries the toggles", () => {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
    settings.progressChartSeries.tracked = true;
    settings.progressChartSeries.unknown = true;
    settings.hskCoverageBuckets.untracked = true;

    const shared = filterSettingsForSharing(settings);

    expect(shared.progressChartSeries).toEqual({
      tracked: true,
      classified: true,
      known: true,
      partial: false,
      unknown: true,
    });
    expect(shared.hskCoverageBuckets).toEqual({
      known: true,
      partial: false,
      unknown: false,
      new: false,
      untracked: true,
    });
  });
});

/**
 * Topic-coverage radar settings follow the same contract: edited from the
 * dashboard, persisted in CciSettings, and shared across devices. The
 * selection is a flat top-level array on purpose — settings are merged with a
 * shallow spread in `onloadInner`, so a nested object that later gains a key
 * would come back `undefined` for existing users.
 */
describe("Topic coverage radar persistence", () => {
  it("defaults to the shipped beginner-heavy spoke set", () => {
    expect(DEFAULT_SETTINGS.topicRadarTopics).toEqual([...DEFAULT_RADAR_TOPICS]);
    expect(DEFAULT_SETTINGS.topicRadarMode).toBe("coverage");
    for (const id of DEFAULT_SETTINGS.topicRadarTopics) expect(TOPIC_IDS).toContain(id);
  });

  it("does not alias the shipped default array", () => {
    // A shared reference would let one vault's edit mutate the module-level
    // constant for every other consumer in the process.
    expect(DEFAULT_SETTINGS.topicRadarTopics).not.toBe(DEFAULT_RADAR_TOPICS);
  });

  it("survives a JSON save -> reload roundtrip (the data.json path)", () => {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
    settings.topicRadarTopics = ["sport", "food_drink", "arts_culture"];
    settings.topicRadarMode = "relative";

    const reloaded = JSON.parse(JSON.stringify({ settings })) as { settings: typeof DEFAULT_SETTINGS };

    expect(reloaded.settings.topicRadarTopics).toEqual(["sport", "food_drink", "arts_culture"]);
    expect(reloaded.settings.topicRadarMode).toBe("relative");
  });

  it("survives the settings-mirror filter so the selection syncs across devices", () => {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
    settings.topicRadarTopics = ["sport", "food_drink", "arts_culture"];
    settings.topicRadarMode = "relative";

    const shared = filterSettingsForSharing(settings);

    expect(shared.topicRadarTopics).toEqual(["sport", "food_drink", "arts_culture"]);
    expect(shared.topicRadarMode).toBe("relative");
  });

  it("gets defaults when loading a data.json written before this feature existed", () => {
    // The shallow spread in onloadInner is what supplies them.
    const legacy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>;
    delete legacy.topicRadarTopics;
    delete legacy.topicRadarMode;

    const merged = { ...DEFAULT_SETTINGS, ...legacy };

    expect(merged.topicRadarTopics).toEqual([...DEFAULT_RADAR_TOPICS]);
    expect(merged.topicRadarMode).toBe("coverage");
  });
});
