import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { applyCustomColors, deriveHskColorsFromAccent } from "../ui/colorTheme";

describe("colorTheme", () => {
  const setProperty = vi.fn();
  const removeProperty = vi.fn();
  let accent = "";

  beforeEach(() => {
    setProperty.mockReset();
    removeProperty.mockReset();
    accent = "";
    (globalThis as any).document = {
      body: {
        style: { setProperty, removeProperty },
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

  it("applyCustomColors clears the text-color vars while the feature is off", () => {
    applyCustomColors(DEFAULT_SETTINGS);
    for (const v of ["--cci-text-chars", "--cci-text-pinyin", "--cci-text-gloss"]) {
      expect(removeProperty).toHaveBeenCalledWith(v);
      expect(setProperty).not.toHaveBeenCalledWith(v, expect.anything());
    }
  });

  it("applyCustomColors writes the text-color vars when enabled", () => {
    applyCustomColors({
      ...DEFAULT_SETTINGS,
      textColors: { enabled: true, chars: "#111111", pinyin: "#222222", gloss: "#333333" },
    });
    expect(setProperty).toHaveBeenCalledWith("--cci-text-chars", "#111111");
    expect(setProperty).toHaveBeenCalledWith("--cci-text-pinyin", "#222222");
    expect(setProperty).toHaveBeenCalledWith("--cci-text-gloss", "#333333");
    expect(removeProperty).not.toHaveBeenCalled();
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
