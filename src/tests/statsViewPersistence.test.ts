import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { filterSettingsForSharing } from "../settings/SettingsIO";

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
