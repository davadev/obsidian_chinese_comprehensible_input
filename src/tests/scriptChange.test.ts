import { describe, it, expect } from "vitest";
import { planScriptChange, ScriptState } from "../settings/scriptChange";

const S: ScriptState = { script: "simplified", region: "mainland" };

describe("planScriptChange", () => {
  it("does nothing when neither setting moved", () => {
    expect(planScriptChange(S, { ...S })).toEqual({
      noop: true, rebuildTrie: false, retokenize: false, notifyRemote: false,
    });
  });

  it("rebuilds the trie when the script changes", () => {
    // Script changes segmentation, so the trie and the surface-lookup
    // caches are stale.
    expect(planScriptChange(S, { ...S, script: "traditional" })).toEqual({
      noop: false, rebuildTrie: true, retokenize: true, notifyRemote: false,
    });
  });

  it("re-tokenizes but does NOT rebuild the trie for a region change", () => {
    // Region is display-only — but a plain redecorate is still not enough,
    // because RubyWidget snapshots its pinyin when it is constructed.
    expect(planScriptChange(S, { ...S, region: "taiwan" })).toEqual({
      noop: false, rebuildTrie: false, retokenize: true, notifyRemote: false,
    });
  });

  it("handles both changing at once", () => {
    expect(planScriptChange(S, { script: "traditional", region: "taiwan" })).toEqual({
      noop: false, rebuildTrie: true, retokenize: true, notifyRemote: false,
    });
  });

  it("fires on the way back as well", () => {
    const T: ScriptState = { script: "traditional", region: "taiwan" };
    expect(planScriptChange(T, S)).toEqual({
      noop: false, rebuildTrie: true, retokenize: true, notifyRemote: false,
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

  /**
   * `scriptVariant` is a shared setting, so flipping it on one device flips
   * every device — the reader re-segments and the flashcards switch script on
   * a machine the user never touched. Announce that, and only that: a change
   * the user just made here needs no notice.
   */
  describe("notifyRemote", () => {
    it("is true for a real change that arrived from another device", () => {
      const plan = planScriptChange(S, { ...S, script: "traditional" }, { remote: true });
      expect(plan.notifyRemote).toBe(true);
    });

    it("is true for a remote region-only change", () => {
      const plan = planScriptChange(S, { ...S, region: "taiwan" }, { remote: true });
      expect(plan.notifyRemote).toBe(true);
    });

    it("is false for the same change made locally", () => {
      expect(planScriptChange(S, { ...S, script: "traditional" }).notifyRemote).toBe(false);
      expect(
        planScriptChange(S, { ...S, script: "traditional" }, { remote: false }).notifyRemote
      ).toBe(false);
    });

    it("is false for a remote envelope that changed nothing", () => {
      // The mirror poller re-applies envelopes; only an actual move may notify.
      expect(planScriptChange(S, { ...S }, { remote: true }).notifyRemote).toBe(false);
    });
  });
});
