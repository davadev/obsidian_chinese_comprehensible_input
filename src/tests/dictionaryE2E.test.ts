import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DictionaryService } from "../dictionary/DictionaryService";
import { parseCedict } from "../dictionary/DictionaryDownloader";
import { TokenizerService } from "../tokenizer/TokenizerService";
import { countTraditionalMarkers, looksTraditional } from "../dictionary/scriptDetect";
import { displayPinyin, displaySurface } from "../dictionary/displayForms";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";
import type { Token } from "../tokenizer/tokenizerTypes";

/**
 * End-to-end over REAL dictionary data.
 *
 * Every other test in this repo drives a hand-written stub — a three-entry
 * dictionary, a tokenizer that calls every character a word. That leaves a
 * whole class of bug invisible: the stub agrees with the code, and neither
 * agrees with CC-CEDICT. The 0.6.0 flashcard bug is the case in point.
 * `VocabularyStore.ensure()` seeds `lookup(surface)[0].traditional` into
 * `rec.surfaces`, and CC-CEDICT orders entries by codepoint, so `干` seeds the
 * obsolete `乹` — which `displaySurface()` then showed on the flashcard. No
 * stub had multi-variant headwords in it, so nothing failed.
 *
 * So this file wires the real pieces together — parseCedict → DictionaryService
 * → Trie → LatticeTokenizer → scriptDetect / displayForms — over a committed
 * CC-CEDICT subset (see scripts/build-cedict-fixture.mjs; glosses excluded, so
 * NOTICE.md's "does not bundle CC-CEDICT" still holds).
 */

const FIXTURE = resolve(__dirname, "fixtures", "cedictSample.generated.txt");

/** The Traditional test note from docs/traditional-chinese.md. */
const NOTE_TRADITIONAL = [
  "# 臺灣的週末",
  "今天天氣很熱，我和朋友去圖書館學習中文。",
  "路上的垃圾很多，可是公園很乾淨。",
  "她的頭髮很長，我們坐計程車回家，花了兩個鐘頭。",
  "我喜歡看臺灣的歷史影片，網路上有很多。",
  "這裡的腳踏車也很方便，捷運站旁邊還有便利商店。",
].join("\n\n");

const NOTE_SIMPLIFIED = "这个字是干。这个字是发。这个字是历。这个字是里。这个字是钟。";
const NOTE_SHORT_TRADITIONAL = "我在這裡等你。";

/** DictionaryService only ever touches `vault.adapter.exists` / `read`. */
function fakeApp(entriesJson: string) {
  return {
    vault: {
      adapter: {
        exists: async (p: string) => p === ".cci-dictionary.json",
        read: async () => entriesJson,
      },
    },
  } as never;
}

let dict: DictionaryService;
let tokenizer: TokenizerService;
let settings: CciSettings;

beforeAll(async () => {
  const { entries } = parseCedict(readFileSync(FIXTURE, "utf8"));
  dict = new DictionaryService(fakeApp(JSON.stringify(entries)));
  await dict.ensureLoaded();
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CciSettings;
  tokenizer = new TokenizerService(
    dict,
    { hasRecord: () => false, knownBoost: () => 0 },
    () => settings
  );
});

async function segment(text: string, script: "simplified" | "traditional"): Promise<Token[]> {
  settings.scriptVariant = script;
  // The trie is built per script and the token cache is module-level.
  tokenizer.invalidate();
  const tokens = await tokenizer.tokenize(text);
  return tokens.filter((t) => t.isWord && /[一-鿿]/.test(t.surface));
}

describe("real dictionary: parseCedict → DictionaryService", () => {
  it("keeps CC-CEDICT's entry order, so entries[0] is the codepoint-first variant", () => {
    // This ordering is the reason displaySurface() may never trust
    // lookup()[0].traditional. Asserting it here means the day CC-CEDICT
    // reorders, or someone sorts the entries, this test says so.
    expect(dict.lookup("干")[0].traditional).toBe("乹");
    expect(dict.lookup("历")[0].traditional).toBe("厤");
    expect(dict.lookup("钟")[0].traditional).toBe("鍾");
  });

  it("counts the real number of traditional forms per headword", () => {
    expect(dict.distinctTraditionalForms("干")).toBe(4);
    expect(dict.distinctTraditionalForms("历")).toBe(4);
    expect(dict.distinctTraditionalForms("发")).toBe(2);
    expect(dict.distinctTraditionalForms("里")).toBe(2);
    expect(dict.distinctTraditionalForms("钟")).toBe(2);
    // Unambiguous, so conversion for display IS allowed here.
    expect(dict.distinctTraditionalForms("学习")).toBe(1);
  });

  it("repairs the pinyin CC-CEDICT writes with u: and -iu", () => {
    // Both defects shipped in every dictionary built before 0.6.0:
    // "nu:3" stranded the tone digit, and the -iu mark sat on the i.
    expect(dict.lookup("女")[0].pinyin).toBe("nǚ");
    expect(dict.lookup("九")[0].pinyin).toBe("jiǔ");
    expect(dict.lookup("六")[0].pinyin).toBe("liù");
    expect(dict.lookup("丢")[0].pinyin).toBe("diū");
    // 绿 is polyphonic — lu:4 and lu4 — and CC-CEDICT's order between them is
    // not ours to assume, so assert the reading exists rather than that it is
    // first. (Assuming it was first is exactly the mistake displaySurface()
    // used to make with traditional variants.)
    expect(dict.lookup("绿").map((e) => e.pinyin)).toContain("lǜ");
  });

  it("leaves no raw u: or stray tone digit anywhere in the dictionary", () => {
    // The stronger form of the check above: whatever CC-CEDICT throws at
    // parseCedict, nothing reaches the reader still written "nu:3" or "nü3".
    const bad = [...dict.allEntries()]
      .filter((e) => /u:/.test(e.pinyin) || /[a-zü][1-5]/i.test(e.pinyin))
      .map((e) => `${e.simplified}=${e.pinyin}`);
    expect(bad).toEqual([]);
  });

  it("lifts the Taiwan reading out of the gloss", () => {
    const laji = dict.lookup("垃圾")[0];
    expect(displayPinyin(laji, undefined, "mainland")).toBe("lā jī");
    expect(displayPinyin(laji, undefined, "taiwan")).toBe("lè sè");
  });

  it("falls back to the Mainland reading when no Taiwan one is recorded", () => {
    const xuexi = dict.lookup("学习")[0];
    expect(displayPinyin(xuexi, undefined, "taiwan")).toBe(displayPinyin(xuexi, undefined, "mainland"));
  });
});

describe("real tokenizer over a Traditional note", () => {
  const EXPECTED_WORDS = [
    "臺灣", "天氣", "朋友", "圖書館", "學習", "中文", "垃圾", "公園", "乾淨",
    "頭髮", "計程車", "回家", "鐘頭", "喜歡", "歷史", "影片", "網路", "這裡",
    "腳踏車", "方便", "捷運", "便利商店",
  ];

  it("segments every word once Traditional is selected", async () => {
    const surfaces = new Set((await segment(NOTE_TRADITIONAL, "traditional")).map((t) => t.surface));
    expect(EXPECTED_WORDS.filter((w) => !surfaces.has(w))).toEqual([]);
  });

  it("cannot segment it under Simplified — which is why indexing skips it", async () => {
    // The trie holds simplified headwords only, so the note shatters. Left
    // to index, each shard becomes a permanent vocabulary record.
    const surfaces = new Set((await segment(NOTE_TRADITIONAL, "simplified")).map((t) => t.surface));
    const found = EXPECTED_WORDS.filter((w) => surfaces.has(w));
    expect(found.length).toBeLessThan(EXPECTED_WORDS.length / 2);
    expect(surfaces.has("學習")).toBe(false);
    expect(surfaces.has("圖書館")).toBe(false);
  });

  it("shatters into shards that a per-token filter could not clean up", async () => {
    // Documents why the indexer skips the whole NOTE rather than filtering
    // tokens: 公 / 乾 / 程 / 喜 fall out of 公園 / 乾淨 / 計程車 / 喜歡 and are
    // themselves perfectly ordinary simplified headwords, so no predicate
    // distinguishes them from real vocabulary.
    const surfaces = new Set((await segment(NOTE_TRADITIONAL, "simplified")).map((t) => t.surface));
    for (const shard of ["公", "乾", "程", "喜"]) {
      expect(surfaces.has(shard)).toBe(true);
      expect(dict.isTraditionalMarker(shard)).toBe(false);
    }
  });
});

describe("real script detection", () => {
  it("recognises a Traditional note", () => {
    expect(countTraditionalMarkers(NOTE_TRADITIONAL, dict)).toBeGreaterThanOrEqual(3);
    expect(looksTraditional(NOTE_TRADITIONAL, dict)).toBe(true);
  });

  it("never fires on a Simplified note", () => {
    expect(countTraditionalMarkers(NOTE_SIMPLIFIED, dict)).toBe(0);
    expect(looksTraditional(NOTE_SIMPLIFIED, dict)).toBe(false);
  });

  it("misses a Traditional note below the marker threshold, as documented", () => {
    // 這 and 裡 only — two markers, and the threshold is three. This is the
    // known limit in docs/traditional-chinese.md, asserted so it stays known.
    expect(countTraditionalMarkers(NOTE_SHORT_TRADITIONAL, dict)).toBe(2);
    expect(looksTraditional(NOTE_SHORT_TRADITIONAL, dict)).toBe(false);
  });
});

describe("displaySurface against records built the way ensure() builds them", () => {
  /** Exactly what VocabularyStore.ensure() constructs for a newly met word. */
  function ensureRecord(surface: string) {
    const top = dict.lookup(surface)[0];
    return {
      surfaces: [surface, ...(top && top.traditional !== top.simplified ? [top.traditional] : [])],
      simplified: top?.simplified ?? surface,
      traditional: top?.traditional,
    };
  }

  it("keeps the simplified form for an ambiguous word met in Simplified", () => {
    // The 0.6.0 regression: `surfaces` is seeded from the dictionary, so
    // trusting it returned 乹 for 干, 厤 for 历, 鍾 for 钟.
    for (const ch of ["干", "发", "历", "里", "钟"]) {
      const rec = ensureRecord(ch);
      expect(rec.surfaces.length).toBe(2); // the seed really is there
      expect(displaySurface(rec, "traditional", dict)).toBe(ch);
    }
  });

  it("does offer the traditional form when the mapping is unambiguous", () => {
    expect(displaySurface(ensureRecord("学习"), "traditional", dict)).toBe("學習");
    expect(displaySurface(ensureRecord("头发"), "traditional", dict)).toBe("頭髮");
  });

  it("keeps the form actually read for a word met in Traditional", async () => {
    const surfaces = (await segment(NOTE_TRADITIONAL, "traditional")).map((t) => t.surface);
    for (const w of ["頭髮", "歷史", "這裡", "鐘頭", "乾淨"]) {
      expect(surfaces).toContain(w);
      const rec = ensureRecord(w);
      expect(displaySurface(rec, "traditional", dict)).toBe(w);
    }
  });

  it("shows the simplified form in Simplified mode either way", () => {
    expect(displaySurface(ensureRecord("學習"), "simplified", dict)).toBe("学习");
    expect(displaySurface(ensureRecord("学习"), "simplified", dict)).toBe("学习");
  });
});
