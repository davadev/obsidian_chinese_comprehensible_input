#!/usr/bin/env node
/**
 * Build script: fetches CC-CEDICT from MDBG and emits
 * src/tests/fixtures/cedictSample.generated.txt — a small, curated subset
 * used by the end-to-end dictionary/tokenizer tests.
 *
 * Emitted in CC-CEDICT's own line format rather than as parsed JSON, so the
 * test drives the real parseCedict() as well: the `u:` → ü conversion and the
 * -iu tone placement both happen there, and a pre-parsed fixture would skip
 * the code that gets them wrong.
 *
 * Source:  https://www.mdbg.net/chinese/dictionary?page=cc-cedict
 * License: CC BY-SA 4.0.
 *
 * WHAT IS EXTRACTED, AND WHY IT IS SAFE TO COMMIT
 *
 * Only the simplified → traditional → pinyin mapping. Every English gloss is
 * dropped and replaced with a placeholder, exactly as scripts/build-hsk-map.mjs
 * imports the HSK term→level mapping and nothing else. NOTICE.md records that
 * the plugin does not bundle CC-CEDICT, and that stays true: the glosses are
 * the creative content, and none of them ship.
 *
 * The single exception is the `Taiwan pr. [le4 se4]` gloss, kept verbatim
 * because it IS the data under test — extractTaiwanReading() parses the
 * reading back out of that formatted field, and a paraphrase would not
 * exercise it.
 *
 * WHY A FIXTURE AT ALL
 *
 * Every other test in this repo drives hand-written stubs, so nothing catches
 * a stub that disagrees with the real dictionary. The 0.6.0 bug where
 * VocabularyStore.ensure() seeded lookup()[0].traditional into rec.surfaces —
 * making flashcards show 乹 for 干 — was found by reading code, not by a
 * failing test, because no test had real multi-variant headwords in it.
 *
 * Run: `npm run build:fixture`
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "src", "tests", "fixtures", "cedictSample.generated.txt");
const URL_GZ = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";

const PLACEHOLDER = "(gloss omitted — see NOTICE.md)";

/**
 * Headwords the e2e tests need. Every CC-CEDICT entry for each is kept, so
 * entry ORDER and the variant count are the real ones — that is the whole
 * point for the ambiguous set.
 */
const KEEP = {
  // Ambiguous: more than one traditional form, and CC-CEDICT orders by
  // codepoint, so entries[0].traditional is an obsolete or wrong-sense variant.
  ambiguous: ["干", "发", "历", "里", "钟"],
  // Taiwan-specific readings.
  taiwan: ["垃圾", "蜗牛", "질"].filter((s) => s !== "질"),
  // Vocabulary of the Traditional test note, so the tokenizer can be driven
  // over real prose in both script modes.
  note: [
    "台湾", "臺灣", "周末", "今天", "天气", "朋友", "图书馆", "学习", "中文",
    "路上", "垃圾", "可是", "公园", "干净", "头发", "计程车", "回家", "钟头",
    "喜欢", "历史", "影片", "网路", "网络", "这里", "脚踏车", "方便", "捷运",
    "便利商店", "旁边", "还有", "我们", "两", "个", "花", "坐", "看", "去",
    "和", "我", "她", "的", "很", "多", "有", "也", "在", "等", "你", "热",
    "长", "站",
  ],
  // Pinyin repair: `u:` for ü, and -iu finals whose tone mark sat on the i.
  pinyin: ["女", "绿", "九", "六", "牛奶", "休息", "秋天", "丢", "旅行"],
  /**
   * One of the 392 union-only surfaces whose characters are ALL simplified
   * headwords in their own right, so it is reachable from Simplified text.
   * 乾杯 is what proves the union only ever merges (乾杯 as one token) what the
   * simplified-only trie splits (乾 + 杯) — the measurement that justifies
   * making "auto" the default. 杯 must come too, or the split half is missing.
   */
  unionOnly: ["干杯", "杯"],
  /**
   * Every single character appearing in the test notes, in BOTH scripts.
   *
   * Not optional padding. `isTraditionalMarker(ch)` is
   * `byTraditional.has(ch) && !bySimplified.has(ch)`, so a character whose own
   * entry is missing from the subset reports a marker status it does not have
   * in the real dictionary — 乾 and 裡 are simplified headwords in their own
   * right, and without their entries the fixture calls them Traditional-only.
   * Pulling every character in makes marker counts over these notes faithful.
   */
  noteChars: [
    ..."臺灣的週末今天氣很熱我和朋友去圖書館學習中文路上垃圾多可是公園乾淨",
    ..."她頭髮長們坐計程車回家花了兩個鐘喜歡看歷史影片網有這裡腳踏也方便捷",
    ..."運站旁邊還利商店这个字干发历里钟在等你",
  ],
};

function fetchBuf(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { "user-agent": "cci-plugin-build" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        fetchBuf(new URL(r.headers.location, url).toString()).then(res, rej);
        return;
      }
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode} for ${url}`));
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => res(Buffer.concat(chunks)));
    }).on("error", rej);
  });
}

const TAIWAN_PR = /^Taiwan pr\.\s*\[[^\]]+\]$/;

async function main() {
  const text = gunzipSync(await fetchBuf(URL_GZ)).toString("utf8");
  const wanted = new Set(Object.values(KEEP).flat());
  const lineRe = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;

  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const m = lineRe.exec(line);
    if (!m) continue;
    const [, traditional, simplified, pinyin, defs] = m;
    // Match on either side so traditional-only headwords (臺灣, 網路) come in.
    if (!wanted.has(simplified) && !wanted.has(traditional)) continue;
    // Keep the Taiwan-reading gloss verbatim; drop every other definition.
    const taiwan = defs.split("/").map((d) => d.trim()).filter((d) => TAIWAN_PR.test(d));
    out.push({
      simplified,
      traditional,
      line: `${traditional} ${simplified} [${pinyin}] /${[PLACEHOLDER, ...taiwan].join("/")}/`,
    });
  }

  const header = [
    "# Generated by scripts/build-cedict-fixture.mjs — do not edit by hand.",
    "# Derived from CC-CEDICT (https://www.mdbg.net/chinese/dictionary?page=cc-cedict),",
    "# CC BY-SA 4.0. Headword/pinyin mapping only; English glosses are NOT included.",
    "# See NOTICE.md.",
  ].join("\n");
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, header + "\n" + out.map((e) => e.line).join("\n") + "\n", "utf8");
  console.log(`wrote ${out.length} entries → ${OUT_PATH}`);
  const missing = [...wanted].filter(
    (w) => !out.some((e) => e.simplified === w || e.traditional === w)
  );
  if (missing.length) console.warn(`WARNING: no entry found for: ${missing.join(" ")}`);
}

void main();
