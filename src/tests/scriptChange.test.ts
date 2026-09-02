import { describe, it, expect } from "vitest";
import { planScriptChange, ScriptState } from "../settings/scriptChange";

const S: ScriptState = { script: "simplified", region: "mainland" };

describe("planScriptChange", () => {
  it("does nothing when neither setting moved", () => {
    expect(planScriptChange(S, { ...S })).toEqual({
      noop: true, rebuildTrie: false, retokenize: false,
    });
  });

  it("rebuilds the trie when the script changes", () => {
    // Script changes segmentation, so the trie and the surface-lookup
    // caches are stale.
    expect(planScriptChange(S, { ...S, script: "traditional" })).toEqual({
      noop: false, rebuildTrie: true, retokenize: true,
    });
  });

  it("re-tokenizes but does NOT rebuild the trie for a region change", () => {
    // Region is display-only — but a plain redecorate is still not enough,
    // because RubyWidget snapshots its pinyin when it is constructed.
    expect(planScriptChange(S, { ...S, region: "taiwan" })).toEqual({
      noop: false, rebuildTrie: false, retokenize: true,
    });
  });

  it("handles both changing at once", () => {
    expect(planScriptChange(S, { script: "traditional", region: "taiwan" })).toEqual({
      noop: false, rebuildTrie: true, retokenize: true,
    });
  });

  it("fires on the way back as well", () => {
    const T: ScriptState = { script: "traditional", region: "taiwan" };
    expect(planScriptChange(T, S)).toEqual({
      noop: false, rebuildTrie: true, retokenize: true,
    });
  });

  it("always re-tokenizes whenever anything changed", () => {
    // The silent-failure mode this guards is repainting fresh colours over
    // stale tokens, so retokenize must never be false on a real change.
    const states: ScriptState[] = [
      { script: "simplified", region: "mainland" },
      { script: "simplified", region: "taiwan" },
      { script: "traditional", region: "mainland" },
      { script: "traditional", region: "taiwan" },
    ];
    for (const a of states) {
      for (const b of states) {
        const plan = planScriptChange(a, b);
        if (a.script === b.script && a.region === b.region) {
          expect(plan.noop).toBe(true);
        } else {
          expect(plan.retokenize).toBe(true);
        }
      }
    }
  });
});
