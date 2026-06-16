import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { applyCustomColors, deriveHskColorsFromAccent } from "../ui/colorTheme";

describe("colorTheme", () => {
  const setProperty = vi.fn();
  let accent = "";

  beforeEach(() => {
    setProperty.mockReset();
    accent = "";
    (globalThis as any).document = {
      body: {
        style: { setProperty },
      },
    };
    (globalThis as any).getComputedStyle = vi.fn(() => ({
      getPropertyValue: (name: string) => (name === "--interactive-accent" ? accent : ""),
    }));
  });

  it("applyCustomColors writes all top-level and HSK CSS vars", () => {
    applyCustomColors(DEFAULT_SETTINGS);
    expect(setProperty).toHaveBeenCalledWith("--cci-color-known", DEFAULT_SETTINGS.customColors.known);
    expect(setProperty).toHaveBeenCalledWith("--cci-color-partial", DEFAULT_SETTINGS.customColors.partial);
    expect(setProperty).toHaveBeenCalledWith("--cci-color-unknown", DEFAULT_SETTINGS.customColors.unknown);
    expect(setProperty).toHaveBeenCalledWith("--cci-color-new", DEFAULT_SETTINGS.customColors.new);
    expect(setProperty).toHaveBeenCalledWith("--cci-color-hsk-7", DEFAULT_SETTINGS.customColors.hsk["7"]);
    expect(setProperty).toHaveBeenCalledTimes(11);
  });

  it("deriveHskColorsFromAccent falls back to built-in defaults when accent is unparseable", () => {
    accent = "not-a-color";
    expect(deriveHskColorsFromAccent()).toEqual(DEFAULT_SETTINGS.customColors.hsk);
  });

  it("deriveHskColorsFromAccent derives seven hex shades from a valid accent", () => {
    accent = "rgb(255, 0, 0)";
    const out = deriveHskColorsFromAccent();
    expect(Object.keys(out)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    for (const level of Object.keys(out)) {
      expect(out[level as keyof typeof out]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(out["1"]).not.toBe(out["7"]);
  });
});
