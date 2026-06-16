import { App, normalizePath, requestUrl } from "obsidian";
import { DictionaryEntry } from "./DictionaryTypes";
import { numbersToToneMarks } from "./normalizeChinese";

export const CC_CEDICT_GZ_URL =
  "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";

export const CC_CEDICT_ZIP_URL =
  "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip";

export interface DownloadStatus {
  state: "idle" | "downloading" | "parsing" | "writing" | "done" | "error";
  bytesDownloaded: number;
  totalBytes: number;
  entriesParsed: number;
  message: string;
  versionLine?: string;
  downloadedAt?: string;
}

export type StatusListener = (s: DownloadStatus) => void;

/**
 * Downloads CC-CEDICT, parses to JSON, and writes a vault-side dictionary file
 * that DictionaryService loads at runtime. Browser-safe only — uses
 * Obsidian's requestUrl (no Node fetch quirks) and DecompressionStream.
 */
export class DictionaryDownloader {
  private status: DownloadStatus = {
    state: "idle",
    bytesDownloaded: 0,
    totalBytes: 0,
    entriesParsed: 0,
    message: "",
  };
  private listeners = new Set<StatusListener>();

  constructor(
    private app: App,
    private outputPath = ".cci-dictionary.json"
  ) {}

  getStatus(): DownloadStatus {
    return this.status;
  }

  onStatus(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<DownloadStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  /**
   * Run the full download → decompress → parse → write pipeline.
   * Resolves to the number of entries written. Throws on failure.
   */
  async run(): Promise<number> {
    try {
      this.update({
        state: "downloading",
        message: "Downloading CC-CEDICT…",
        bytesDownloaded: 0,
        entriesParsed: 0,
      });

      const text = await this.fetchText();

      this.update({
        state: "parsing",
        message: "Parsing entries…",
        bytesDownloaded: text.length,
        totalBytes: text.length,
      });

      const { entries, versionLine } = parseCedict(text, (n) =>
        this.update({ entriesParsed: n })
      );

      this.update({
        state: "writing",
        message: `Writing ${entries.length} entries to vault…`,
        versionLine,
      });

      const path = normalizePath(this.outputPath);
      const json = JSON.stringify(entries);
      await this.app.vault.adapter.write(path, json);

      const now = new Date().toISOString();
      this.update({
        state: "done",
        message: `Downloaded ${entries.length} entries.`,
        downloadedAt: now,
        entriesParsed: entries.length,
      });
      return entries.length;
    } catch (err) {
      this.update({
        state: "error",
        message: "Download failed: " + (err as Error).message,
      });
      throw err;
    }
  }

  /**
   * Prefer the .txt.gz endpoint — single gzip stream, no ZIP parsing needed.
   * Fall back to the .zip endpoint if the gz request fails for any reason.
   */
  private async fetchText(): Promise<string> {
    try {
      const resp = await requestUrl({ url: CC_CEDICT_GZ_URL, method: "GET", throw: false });
      if (resp.status >= 200 && resp.status < 300 && resp.arrayBuffer.byteLength > 1000) {
        const inflated = await gunzip(new Uint8Array(resp.arrayBuffer));
        return new TextDecoder("utf-8").decode(inflated);
      }
    } catch {
      // fall through to zip
    }
    const resp = await requestUrl({ url: CC_CEDICT_ZIP_URL, method: "GET", throw: false });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status} fetching CC-CEDICT archive from MDBG`);
    }
    const inflated = await unzipFirstEntry(new Uint8Array(resp.arrayBuffer));
    return new TextDecoder("utf-8").decode(inflated);
  }
}

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  // @ts-ignore — DecompressionStream is available in Obsidian's Chromium/WebKit runtime.
  const ds = new DecompressionStream("gzip");
  const blobPart = new Uint8Array(input).slice().buffer as BlobPart;
  const stream = new Blob([blobPart]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * Parse CC-CEDICT format:
 *   traditional simplified [pin1 yin1] /def 1/def 2/
 * Lines starting with `#` are comments. First few comment lines contain
 * version info we capture for the manifest.
 */
export function parseCedict(
  text: string,
  onProgress?: (entries: number) => void
): { entries: DictionaryEntry[]; versionLine: string } {
  const entries: DictionaryEntry[] = [];
  let versionLine = "";
  const lineRe = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;
  let i = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("#")) {
      if (!versionLine && line.includes("CC-CEDICT")) versionLine = line.slice(1).trim();
      if (!versionLine && line.toLowerCase().includes("version")) versionLine = line.slice(1).trim();
      continue;
    }
    const m = lineRe.exec(line);
    if (!m) continue;
    const [, traditional, simplified, pinyinRaw, defs] = m;
    const pinyin = numbersToToneMarks(pinyinRaw).replace(/u:/g, "ü");
    entries.push({
      simplified,
      traditional,
      pinyin,
      definitions: defs.split("/").map((d) => d.trim()).filter(Boolean),
    });
    i++;
    if (onProgress && i % 5000 === 0) onProgress(i);
  }
  if (onProgress) onProgress(i);
  return { entries, versionLine };
}

/**
 * Minimal ZIP reader: locates the End Of Central Directory record, walks the
 * Central Directory, finds the first regular file, and inflates its DEFLATE
 * stream via the browser-native DecompressionStream("deflate-raw").
 */
async function unzipFirstEntry(zip: Uint8Array): Promise<Uint8Array> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Find EOCD signature (0x06054b50) by scanning backwards.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP EOCD not found");
  const cdOffset = dv.getUint32(eocd + 16, true);

  // First Central Directory entry.
  if (dv.getUint32(cdOffset, true) !== 0x02014b50) throw new Error("ZIP central dir signature missing");
  const compressionMethod = dv.getUint16(cdOffset + 10, true);
  const compressedSize = dv.getUint32(cdOffset + 20, true);
  const fileNameLen = dv.getUint16(cdOffset + 28, true);
  const extraLen = dv.getUint16(cdOffset + 30, true);
  const commentLen = dv.getUint16(cdOffset + 32, true);
  const localHeaderOffset = dv.getUint32(cdOffset + 42, true);

  // Skip past local file header to get to the actual data.
  if (dv.getUint32(localHeaderOffset, true) !== 0x04034b50)
    throw new Error("ZIP local header signature missing");
  const lfhNameLen = dv.getUint16(localHeaderOffset + 26, true);
  const lfhExtraLen = dv.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
  const compressed = zip.subarray(dataStart, dataStart + compressedSize);

  void fileNameLen;
  void extraLen;
  void commentLen;

  if (compressionMethod === 0) return compressed; // stored
  if (compressionMethod !== 8) throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);

  // @ts-ignore — DecompressionStream is available in Obsidian's Chromium/WebKit runtime.
  const ds = new DecompressionStream("deflate-raw");
  const blobPart = new Uint8Array(compressed).slice().buffer as BlobPart;
  const stream = new Blob([blobPart]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}
