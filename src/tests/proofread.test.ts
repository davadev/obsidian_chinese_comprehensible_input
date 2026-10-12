import { describe, expect, it } from "vitest";
import {
  MAX_CORRECTIONS,
  PROOFREAD_SCHEMA,
  applyCorrections,
  locateCorrections,
  normaliseProofread,
  validateProofread,
} from "../ai/proofread";

/** Proof reading (#186): corrections are checked against the text they claim to fix, and applied by the plugin, not the model. */

const TEXT = "我昨天去了商店买东西很多。";
const c = (original: string, replacement: string, why = "Because.") => ({ original, replacement, why });

describe("normaliseProofread", () => {
  it("keeps corrections, trims the reason but not the spans, and tolerates junk", () => {
    expect(normaliseProofread({ corrections: [{ original: "了 ", replacement: "", why: " why " }] })).toEqual({ corrections: [{ original: "了 ", replacement: "", why: "why" }] });
    expect(normaliseProofread({ corrections: [null, "x", { original: 3 }] }).corrections).toEqual([{ original: "", replacement: "", why: "" }]);
    expect(normaliseProofread(null)).toEqual({ corrections: [] });
    expect(normaliseProofread({ corrections: "none" })).toEqual({ corrections: [] });
  });

  it("makes every property required, as strict json_schema needs", () => {
    expect(PROOFREAD_SCHEMA.required).toEqual(["corrections"]);
    expect((PROOFREAD_SCHEMA.properties.corrections as any).items.required).toEqual(["original", "replacement", "why"]);
  });
});

describe("locateCorrections", () => {
  it("places each span, in text order, and leaves out one that is not in the text", () => {
    const placed = locateCorrections(TEXT, [c("很多", "很多东西"), c("了", ""), c("不在", "x")]);
    expect(placed.map((p) => [p.original, p.start, p.end])).toEqual([["了", 4, 5], ["很多", 10, 12]]);
  });

  it("puts two corrections with the same original on two different places", () => {
    const placed = locateCorrections("他他很好。", [c("他", "她"), c("他", "它")]);
    expect(placed.map((p) => p.start)).toEqual([0, 1]);
  });

  it("ignores an empty original", () => {
    expect(locateCorrections(TEXT, [c("", "x")])).toEqual([]);
  });
});

describe("validateProofread", () => {
  it("accepts good corrections, and none", () => {
    expect(validateProofread({ corrections: [c("了商店买东西很多", "商店买了很多东西")] }, TEXT)).toEqual([]);
    expect(validateProofread({ corrections: [] }, TEXT)).toEqual([]);
    expect(validateProofread({ corrections: [c("的", "")] }, "我的的书")).toEqual([]);
  });

  it("rejects a span that is not in the text, an empty span, a no-op and a missing reason", () => {
    const issues = validateProofread({ corrections: [c("不在", "x"), c("", "x"), c("了", "了"), c("很多", "非常多", "")] }, TEXT);
    expect(issues).toEqual([
      'Correction 1: "original" must be copied exactly from the text, and "不在" is not in it.',
      'Correction 2: "original" must be copied exactly from the text, and "" is not in it.',
      "Correction 3: the replacement is the same as the original; leave it out if the text is correct.",
      "Correction 4 needs a reason.",
    ]);
  });

  it("rejects overlapping corrections and too many", () => {
    expect(validateProofread({ corrections: [c("去了商店", "去商店"), c("了商店买", "到商店买")] }, TEXT)).toEqual(["Corrections must not overlap; merge overlapping ones into a single correction."]);
    const many = Array.from({ length: MAX_CORRECTIONS + 1 }, () => c("很", "挺"));
    expect(validateProofread({ corrections: many }, "很很很很很很很")[0]).toBe("Give at most 5 corrections, the most important ones; you sent 6.");
  });
});

describe("applyCorrections", () => {
  it("applies every correction, whatever order they are given in", () => {
    expect(applyCorrections(TEXT, [c("很多", "很多东西".slice(0, 2)), c("了", "")])).toBe("我昨天去商店买东西很多。");
    expect(applyCorrections(TEXT, [c("买东西很多", "买了很多东西"), c("去了", "去")])).toBe("我昨天去商店买了很多东西。");
  });

  it("changes nothing when there is nothing to apply", () => {
    expect(applyCorrections(TEXT, [])).toBe(TEXT);
    expect(applyCorrections(TEXT, [c("不在", "x")])).toBe(TEXT);
  });
});
