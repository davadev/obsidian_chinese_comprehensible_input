import { describe, it, expect, vi } from "vitest";
import {
  EINK_NUMBER_SCALE_DEFAULT,
  EINK_NUMBER_SCALE_MAX,
  EINK_NUMBER_SCALE_MIN,
  EINK_NUMBER_SCALE_STEP,
  applyEinkToRoot,
  clampEinkNumberScale,
  isEinkMode,
} from "../view/einkMode";
import { DEFAULT_SETTINGS } from "../settings/defaults";

/**
 * E-ink mode (#112). The view applies it with a one-line call into this module,
 * and the repo has no DOM harness (#119), so everything that can be decided
 * without a real element is decided here and tested directly.
 */

describe("isEinkMode", () => {
  it("is true only for the boolean true", () => {
    expect(isEinkMode({ einkMode: true })).toBe(true);
  });

  it("degrades every other stored value to OFF", () => {
    // OFF is how the plugin looked before this feature existed, so it is the safe
    // direction for a value that cannot be trusted.
    for (const v of [false, undefined, null, "true", "false", 1, 0, {}, []]) {
      expect(isEinkMode({ einkMode: v })).toBe(false);
    }
    expect(isEinkMode({})).toBe(false);
  });

  it("is off by default", () => {
    expect(isEinkMode(DEFAULT_SETTINGS)).toBe(false);
  });
});

describe("clampEinkNumberScale", () => {
  it("leaves in-range values alone", () => {
    for (const v of [80, 90, 100, 110, 120, 130, 87.5]) expect(clampEinkNumberScale(v)).toBe(v);
  });

  it("pulls out-of-range numbers back to the nearest bound", () => {
    expect(clampEinkNumberScale(0)).toBe(EINK_NUMBER_SCALE_MIN);
    expect(clampEinkNumberScale(79)).toBe(EINK_NUMBER_SCALE_MIN);
    expect(clampEinkNumberScale(-50)).toBe(EINK_NUMBER_SCALE_MIN);
    expect(clampEinkNumberScale(131)).toBe(EINK_NUMBER_SCALE_MAX);
    expect(clampEinkNumberScale(1000)).toBe(EINK_NUMBER_SCALE_MAX);
  });

  it("sends anything that is not a finite number to the default, never through", () => {
    // `calc(NaN)` makes the whole font-size declaration invalid, which silently
    // leaves the number at the browser default instead of failing visibly.
    for (const v of [NaN, Infinity, -Infinity, undefined, null, "150", "abc", {}, [], true]) {
      expect(clampEinkNumberScale(v)).toBe(EINK_NUMBER_SCALE_DEFAULT);
    }
  });

  it("has sane constants the slider can actually reach", () => {
    expect(EINK_NUMBER_SCALE_MIN).toBeLessThan(EINK_NUMBER_SCALE_DEFAULT);
    expect(EINK_NUMBER_SCALE_DEFAULT).toBeLessThan(EINK_NUMBER_SCALE_MAX);
    // Both ends and the default must land on a slider step, or the thumb can
    // never rest exactly on them.
    expect((EINK_NUMBER_SCALE_MAX - EINK_NUMBER_SCALE_MIN) % EINK_NUMBER_SCALE_STEP).toBe(0);
    expect((EINK_NUMBER_SCALE_DEFAULT - EINK_NUMBER_SCALE_MIN) % EINK_NUMBER_SCALE_STEP).toBe(0);
  });

  it("agrees with the default the settings ship with", () => {
    expect(DEFAULT_SETTINGS.einkNumberScalePercent).toBe(EINK_NUMBER_SCALE_DEFAULT);
  });
});

function fakeRoot() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
    props,
    setAttribute: vi.fn((n: string, v: string) => void attrs.set(n, v)),
    removeAttribute: vi.fn((n: string) => void attrs.delete(n)),
    style: { setProperty: vi.fn((n: string, v: string) => void props.set(n, v)) },
  };
}

describe("applyEinkToRoot", () => {
  it("sets the attribute when on", () => {
    const root = fakeRoot();
    applyEinkToRoot(root, { einkMode: true, einkNumberScalePercent: 100 });
    expect(root.attrs.has("data-eink")).toBe(true);
  });

  it("REMOVES the attribute when off, rather than setting a falsy value", () => {
    // The CSS keys on `[data-eink]`, which matches on PRESENCE: `data-eink="false"`
    // would still turn the whole mode on.
    const root = fakeRoot();
    applyEinkToRoot(root, { einkMode: true });
    applyEinkToRoot(root, { einkMode: false });
    expect(root.attrs.has("data-eink")).toBe(false);
    expect(root.setAttribute).toHaveBeenCalledTimes(1);
    expect(root.removeAttribute).toHaveBeenCalledWith("data-eink");
  });

  it("writes the size as a multiplier, clamped", () => {
    const root = fakeRoot();
    applyEinkToRoot(root, { einkMode: true, einkNumberScalePercent: 110 });
    expect(root.props.get("--cci-eink-number-scale")).toBe("1.1");
    applyEinkToRoot(root, { einkMode: true, einkNumberScalePercent: 9999 });
    expect(root.props.get("--cci-eink-number-scale")).toBe(String(EINK_NUMBER_SCALE_MAX / 100));
    applyEinkToRoot(root, { einkMode: true, einkNumberScalePercent: 1 });
    expect(root.props.get("--cci-eink-number-scale")).toBe(String(EINK_NUMBER_SCALE_MIN / 100));
  });

  it("writes the size even when off, so switching on needs no second step", () => {
    const root = fakeRoot();
    applyEinkToRoot(root, { einkMode: false, einkNumberScalePercent: 120 });
    expect(root.props.get("--cci-eink-number-scale")).toBe("1.2");
  });

  it("leaves a root clean for garbage settings", () => {
    const root = fakeRoot();
    applyEinkToRoot(root, { einkMode: "yes", einkNumberScalePercent: "big" });
    expect(root.attrs.size).toBe(0);
    expect(root.props.get("--cci-eink-number-scale")).toBe(String(EINK_NUMBER_SCALE_DEFAULT / 100));
  });

  it("is idempotent, and on -> off -> on leaves no residue", () => {
    const root = fakeRoot();
    const on = { einkMode: true, einkNumberScalePercent: 100 };
    applyEinkToRoot(root, on);
    applyEinkToRoot(root, on);
    expect([...root.attrs.keys()]).toEqual(["data-eink"]);
    applyEinkToRoot(root, { ...on, einkMode: false });
    expect(root.attrs.size).toBe(0);
    applyEinkToRoot(root, on);
    expect([...root.attrs.keys()]).toEqual(["data-eink"]);
    expect(root.attrs.get("data-eink")).toBe("");
  });
});
