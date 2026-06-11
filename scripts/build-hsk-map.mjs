#!/usr/bin/env node
/**
 * Build script: fetches HSK 2.0 word lists from glxxyz/hskhsk.com (MIT)
 * and emits src/dictionary/hskMap.generated.ts — a compact
 * `Record<simplifiedTerm, level>` mapping the plugin uses at runtime.
 *
 * Source: https://github.com/glxxyz/hskhsk.com  data/lists/
 *         "HSK Official 2012 L{1..6}.txt"
 * License: MIT, © 2020 Alan Davies.
 *
 * Only the simplified term → HSK-level mapping is extracted. No
 * definitions / pinyin / examples / audio / frequency are imported.
 *
 * Run: `npm run build:hsk`
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "src", "dictionary", "hskMap.generated.ts");
const RAW = (level) =>
  `https://raw.githubusercontent.com/glxxyz/hskhsk.com/master/data/lists/HSK%20Official%202012%20L${level}.txt`;

const HAN_RE = /^[㐀-鿿豈-﫿\u{20000}-\u{2EBEF}]+$/u;

function fetchText(url) {
  return new Promise((resolveP, rejectP) => {
    https
      .get(url, { headers: { "user-agent": "cci-plugin-build" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(new URL(res.headers.location, url).toString()).then(resolveP, rejectP);
          return;
        }
        if (res.statusCode !== 200) {
          rejectP(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolveP(Buffer.concat(chunks).toString("utf8")));
        res.on("error", rejectP);
      })
      .on("error", rejectP);
  });
}

function parseList(text, level) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/^﻿/, "").trim();
    if (!line) continue;
    if (!HAN_RE.test(line)) {
      throw new Error(`L${level}: unexpected non-Han line ${JSON.stringify(line)}`);
    }
    out.push(line);
  }
  if (out.length < 100) {
    throw new Error(`L${level}: only ${out.length} terms parsed — file format may have changed`);
  }
  return out;
}

function emitModule(map, counts) {
  const sortedKeys = Object.keys(map).sort();
  const lines = [];
  lines.push("// GENERATED FILE — do not edit by hand. Run `npm run build:hsk` to regenerate.");
  lines.push("// Source: https://github.com/glxxyz/hskhsk.com  (data/lists)");
  lines.push("// License: MIT, (c) 2020 Alan Davies.");
  lines.push("// Only the simplified-term -> HSK-level mapping is imported; no");
  lines.push("// definitions, pinyin, examples, audio, or frequency data are used.");
  lines.push("");
  lines.push(`export const HSK_SOURCE = "2.0" as const;`);
  lines.push(`export const HSK_MAP_SIZE = ${sortedKeys.length};`);
  lines.push(`export const HSK_LEVEL_COUNTS: Readonly<Record<number, number>> = {`);
  for (let l = 1; l <= 6; l++) lines.push(`  ${l}: ${counts[l] ?? 0},`);
  lines.push(`};`);
  lines.push("");
  lines.push("export const HSK_MAP: Readonly<Record<string, number>> = {");
  for (const k of sortedKeys) {
    lines.push(`  ${JSON.stringify(k)}: ${map[k]},`);
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const map = Object.create(null);
  const counts = {};
  for (let level = 1; level <= 6; level++) {
    process.stderr.write(`Fetching L${level}… `);
    const text = await fetchText(RAW(level));
    const terms = parseList(text, level);
    let added = 0;
    for (const term of terms) {
      if (map[term] !== undefined) continue; // lowest level wins
      map[term] = level;
      added++;
    }
    counts[level] = added;
    process.stderr.write(`${terms.length} terms (added ${added}).\n`);
  }
  const total = Object.keys(map).length;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, emitModule(map, counts), "utf8");
  process.stderr.write(`\nWrote ${OUT_PATH} — ${total} unique terms.\n`);
  for (let l = 1; l <= 6; l++) process.stderr.write(`  L${l}: ${counts[l]}\n`);
}

main().catch((err) => {
  console.error("build-hsk-map failed:", err.message);
  process.exit(1);
});
