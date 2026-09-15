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
  describe("accent parsing — normalizeToHex formats", () => {
    // Only rgb() was ever fed in, so the hex, short-hex and hsl() branches
    // of normalizeToHex went unexercised, as did most hue sectors below.
    const derive = (a: string) => {
      accent = a;
      return deriveHskColorsFromAccent();
    };
    const isHexRamp = (out: Record<string, string>) =>
      Object.values(out).every((c) => /^#[0-9a-f]{6}$/.test(c));

    it("accepts a full #rrggbb accent", () => {
      const out = derive("#3b82f6");
      expect(isHexRamp(out)).toBe(true);
      expect(out).not.toEqual(DEFAULT_SETTINGS.customColors.hsk);
    });

    it("expands a short #rgb accent to the same ramp as its long form", () => {
      expect(derive("#0f0")).toEqual(derive("#00ff00"));
    });

    it("accepts an hsl() accent", () => {
      const out = derive("hsl(210, 80%, 50%)");
      expect(isHexRamp(out)).toBe(true);
      expect(out).not.toEqual(DEFAULT_SETTINGS.customColors.hsk);
    });

    it("accepts the alpha spellings rgba() and hsla()", () => {
      expect(derive("rgba(255, 0, 0, 0.5)")).toEqual(derive("rgb(255, 0, 0)"));
      expect(isHexRamp(derive("hsla(210, 80%, 50%, 0.5)"))).toBe(true);
    });

    it("falls back to defaults on a malformed hex", () => {
      // Hits the `#`-prefixed but invalid path, distinct from a non-hex string.
      expect(derive("#12")).toEqual(DEFAULT_SETTINGS.customColors.hsk);
      expect(derive("#gggggg")).toEqual(DEFAULT_SETTINGS.customColors.hsk);
    });

    it("derives a distinct ramp for each primary and secondary hue", () => {
      // Red/green/blue exercise the three hexToHsl hue cases; adding
      // yellow/cyan/magenta covers all six hslToHex sectors.
      const hues = {
        red: derive("#ff0000"),
        yellow: derive("#ffff00"),
        green: derive("#00ff00"),
        cyan: derive("#00ffff"),
        blue: derive("#0000ff"),
        magenta: derive("#ff00ff"),
      };
      for (const out of Object.values(hues)) expect(isHexRamp(out)).toBe(true);
      const midShades = Object.values(hues).map((o) => o["4"]);
      expect(new Set(midShades).size).toBe(6);
    });

    it("produces a monotonically darkening ramp from level 1 to 7", () => {
      const out = derive("#3b82f6");
      const lum = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
      };
      for (let i = 1; i < 7; i++) {
        expect(lum(out[String(i + 1) as keyof typeof out])).toBeLessThan(
          lum(out[String(i) as keyof typeof out])
        );
      }
    });

    it("treats an achromatic accent as a valid, unsaturated-floor ramp", () => {
      // max === min in hexToHsl, so the hue switch is skipped entirely.
      const out = derive("#808080");
      expect(isHexRamp(out)).toBe(true);
      expect(out).not.toEqual(DEFAULT_SETTINGS.customColors.hsk);
    });
  });
});
