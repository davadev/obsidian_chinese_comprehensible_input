import { App, normalizePath, requestUrl } from "obsidian";
import { ECDICT_CSV_URL, ECDICT_OUTPUT_PATH } from "../constants";
import { EcdictReverseEntry, EcdictReverseIndex } from "./DictionaryTypes";

export interface EcdictDownloadStatus {
  state: "idle" | "downloading" | "parsing" | "writing" | "done" | "error";
  bytesDownloaded: number;
  totalBytes: number;
  entriesParsed: number;
  reverseBuckets: number;
  message: string;
  downloadedAt?: string;
}

export type EcdictStatusListener = (s: EcdictDownloadStatus) => void;

/** Cap each Chinese-substring bucket so hot chars (一, 的, …) don't
 *  bloat the index. Twelve gives enough variety without runaway size. */
const MAX_BUCKET_SIZE = 12;

/**
 * Downloads ECDICT's English→Chinese mini variant and builds a
 * Chinese→English reverse-lookup index. For each row, every run of CJK
 * ideographs in the `translation` field becomes an index key pointing at
 * the English headword + phonetic + full translation. Written to a
 * vault-side JSON file that DictionaryService loads at runtime.
 */
export class EcdictDownloader {
  private status: EcdictDownloadStatus = {
    state: "idle",
    bytesDownloaded: 0,
    totalBytes: 0,
    entriesParsed: 0,
    reverseBuckets: 0,
    message: "",
  };
  private listeners = new Set<EcdictStatusListener>();

  constructor(private app: App, private outputPath = ECDICT_OUTPUT_PATH) {}

  getStatus(): EcdictDownloadStatus {
    return this.status;
  }

  onStatus(fn: EcdictStatusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<EcdictDownloadStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  /** Run download → parse → reverse-index → write. Returns bucket count. */
  async run(): Promise<{ entries: number; buckets: number }> {
    try {
      this.update({
        state: "downloading",
        message: "Downloading ECDICT (mini)…",
        bytesDownloaded: 0,
        entriesParsed: 0,
        reverseBuckets: 0,
      });

      const csv = await this.fetchCsv();

      this.update({
        state: "parsing",
        message: "Building reverse-lookup index…",
        bytesDownloaded: csv.length,
        totalBytes: csv.length,
      });

      const { index, rowCount } = buildReverseIndex(csv, (rows, buckets) =>
        this.update({ entriesParsed: rows, reverseBuckets: buckets })
      );

      this.update({
        state: "writing",
        message: `Writing ${Object.keys(index).length} buckets to vault…`,
      });

      const path = normalizePath(this.outputPath);
      await this.app.vault.adapter.write(path, JSON.stringify(index));

      const now = new Date().toISOString();
      const bucketCount = Object.keys(index).length;
      this.update({
        state: "done",
        message: `ECDICT installed: ${rowCount} entries → ${bucketCount} buckets.`,
        downloadedAt: now,
        entriesParsed: rowCount,
        reverseBuckets: bucketCount,
      });
      return { entries: rowCount, buckets: bucketCount };
    } catch (err) {
      this.update({
        state: "error",
        message: "ECDICT download failed: " + (err as Error).message,
      });
      throw err;
    }
  }

  private async fetchCsv(): Promise<string> {
    const resp = await requestUrl({ url: ECDICT_CSV_URL, method: "GET", throw: false });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status} fetching ECDICT from GitHub`);
    }
    return new TextDecoder("utf-8").decode(resp.arrayBuffer);
  }
}

const CJK_RUN_RE = /[一-鿿]+/g;

/**
 * Parse ECDICT CSV (header row: word,phonetic,definition,translation,…).
 * For each row, extract every contiguous CJK run from the translation
 * field and append an entry under that key in the reverse index. Bucket
 * size capped at MAX_BUCKET_SIZE to keep file size bounded.
 */
export function buildReverseIndex(
  csv: string,
  onProgress?: (rows: number, buckets: number) => void
): { index: EcdictReverseIndex; rowCount: number } {
  const index: EcdictReverseIndex = {};
  // CSV with quoted fields: walk by hand. Most ECDICT rows don't quote
  // unless the translation contains commas, which is common.
  const rows = parseCsv(csv);
  // Header
  const header = rows.shift();
  if (!header) return { index, rowCount: 0 };
  const colWord = header.indexOf("word");
  const colPhonetic = header.indexOf("phonetic");
  const colTranslation = header.indexOf("translation");
  if (colWord < 0 || colTranslation < 0) {
    throw new Error("ECDICT CSV missing expected columns (word / translation)");
  }

  let rowCount = 0;
  for (const row of rows) {
    const word = row[colWord];
    const translation = row[colTranslation];
    const phonetic = colPhonetic >= 0 ? row[colPhonetic] : undefined;
    if (!word || !translation) continue;
    rowCount++;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    CJK_RUN_RE.lastIndex = 0;
    while ((m = CJK_RUN_RE.exec(translation)) !== null) {
      const key = m[0];
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = index[key] ?? (index[key] = []);
      if (bucket.length >= MAX_BUCKET_SIZE) continue;
      const entry: EcdictReverseEntry = { word, translation };
      if (phonetic) entry.phonetic = phonetic;
      bucket.push(entry);
    }
    if (onProgress && rowCount % 2000 === 0) {
      onProgress(rowCount, Object.keys(index).length);
    }
  }
  if (onProgress) onProgress(rowCount, Object.keys(index).length);
  return { index, rowCount };
}

/** Minimal CSV parser: handles double-quoted fields with "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      // Skip CRLF as a single newline.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
