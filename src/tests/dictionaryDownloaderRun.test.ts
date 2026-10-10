import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync, deflateRawSync } from "node:zlib";

/**
 * The download pipeline end to end, with real gzip / ZIP bytes and a scripted `requestUrl`: the
 * gz endpoint, the zip fallback, the ways each can fail, and what the user is told. No network.
 * The only code in the plugin that parses an archive from the internet, so its failure modes are
 * worth pinning: a bad download must end in a clear error and leave the existing dictionary alone.
 */

const h = vi.hoisted(() => ({ responses: [] as Array<() => unknown>, urls: [] as string[] }));
vi.mock("obsidian", async (orig) => {
  const real = await orig<typeof import("obsidian")>();
  return {
    ...real,
    requestUrl: vi.fn(async (p: { url: string }) => {
      h.urls.push(p.url);
      const next = h.responses.shift();
      if (!next) throw new Error("no scripted response");
      const r = next() as { status: number; bytes?: Uint8Array } | Error;
      if (r instanceof Error) throw r;
      const b = r.bytes ?? new Uint8Array(0);
      return { status: r.status, arrayBuffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }),
  };
});

import {
  CC_CEDICT_GZ_URL,
  CC_CEDICT_ZIP_URL,
  DictionaryDownloader,
  parseCedict,
  type DownloadStatus,
} from "../dictionary/DictionaryDownloader";

/** Big enough to pass the downloader's "this is a real archive" size check (> 1000 bytes). */
const N = 300;
const LINES = Array.from({ length: N }, (_, i) => `詞${i} 词${i} [ci2 ${i % 4}] /word ${(i * 7919).toString(36)}/second ${(i * 104729).toString(36)}/`);
const TEXT = ["# CC-CEDICT", "# Version: 1.0", ...LINES].join("\n");
const gz = (s: string) => new Uint8Array(gzipSync(Buffer.from(s)));
const ok = (b: Uint8Array) => () => ({ status: 200, bytes: b });
const status = (code: number) => () => ({ status: code });

/** A one-file ZIP, built by hand so the reader is tested against the real format. */
function zip(content: string, method: 0 | 8 | number = 8, opts: { badEocd?: boolean; badCd?: boolean; badLocal?: boolean } = {}) {
  const raw = Buffer.from(content);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const name = Buffer.from("cedict.txt");
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(opts.badLocal ? 0 : 0x04034b50, 0);
  lfh.writeUInt16LE(method, 8);
  lfh.writeUInt32LE(data.length, 18);
  lfh.writeUInt32LE(raw.length, 22);
  lfh.writeUInt16LE(name.length, 26);
  const local = Buffer.concat([lfh, name, data]);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(opts.badCd ? 0 : 0x02014b50, 0);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(0, 42);
  const central = Buffer.concat([cd, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(opts.badEocd ? 0 : 0x06054b50, 0);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return new Uint8Array(Buffer.concat([local, central, eocd]));
}

function app() {
  const written = new Map<string, string>();
  return {
    written,
    app: { vault: { adapter: { write: vi.fn(async (p: string, c: string) => void written.set(p, c)) } } } as never,
  };
}

beforeEach(() => {
  h.responses.length = 0;
  h.urls.length = 0;
});

describe("DictionaryDownloader.run", () => {
  it("test data is big enough to count as a real archive (> 1000 bytes gzipped)", () => {
    expect(gz(TEXT).length).toBeGreaterThan(1000);
  });

  it("downloads the gz archive, parses it and writes the JSON where asked", async () => {
    h.responses.push(ok(gz(TEXT)));
    const { app: a, written } = app();
    const n = await new DictionaryDownloader(a, "dict/out.json").run();
    expect(n).toBe(N);
    expect(h.urls).toEqual([CC_CEDICT_GZ_URL]);
    const entries = JSON.parse(written.get("dict/out.json")!);
    expect(entries).toHaveLength(N);
    expect(entries[0].simplified).toBe("词0");
    expect(entries[0].definitions).toEqual(["word 0", "second 0"]);
  });

  it("walks through the states in order and ends 'done' with the version line and a timestamp", async () => {
    h.responses.push(ok(gz(TEXT)));
    const { app: a } = app();
    const d = new DictionaryDownloader(a);
    const seen: DownloadStatus[] = [];
    d.onStatus((s) => seen.push(s));
    await d.run();
    expect(seen.map((s) => s.state)).toEqual(expect.arrayContaining(["downloading", "parsing", "writing", "done"]));
    const order = ["downloading", "parsing", "writing", "done"];
    const firsts = order.map((st) => seen.findIndex((s) => s.state === st));
    expect([...firsts].sort((x, y) => x - y)).toEqual(firsts);
    expect(d.getStatus().state).toBe("done");
    expect(d.getStatus().versionLine).toContain("CC-CEDICT");
    expect(Date.parse(d.getStatus().downloadedAt!)).not.toBeNaN();
    expect(d.getStatus().entriesParsed).toBe(N);
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    h.responses.push(ok(gz(TEXT)));
    const d = new DictionaryDownloader(app().app);
    const fn = vi.fn();
    const off = d.onStatus(fn);
    off();
    await d.run();
    expect(fn).not.toHaveBeenCalled();
  });

  describe("falls back to the zip endpoint", () => {
    it.each([
      ["the gz request returns an HTTP error", () => h.responses.push(status(503))],
      ["the gz request throws (offline)", () => h.responses.push(() => new Error("net::ERR"))],
      ["the gz body is too small to be the dictionary", () => h.responses.push(ok(new Uint8Array(10)))],
      ["the gz body is not gzip at all", () => h.responses.push(ok(new Uint8Array(2000).fill(7)))],
    ])("when %s", async (_n, setup) => {
      setup();
      h.responses.push(ok(zip(TEXT)));
      const { app: a } = app();
      expect(await new DictionaryDownloader(a).run()).toBe(N);
      expect(h.urls).toEqual([CC_CEDICT_GZ_URL, CC_CEDICT_ZIP_URL]);
    });

    it("does not trust a gz body under 1000 bytes even when it is valid gzip (an error page, a stub)", async () => {
      h.responses.push(ok(gz("# CC-CEDICT\n你好 你好 [ni3 hao3] /hi/")), ok(zip(TEXT)));
      expect(await new DictionaryDownloader(app().app).run()).toBe(N);
      expect(h.urls).toEqual([CC_CEDICT_GZ_URL, CC_CEDICT_ZIP_URL]);
    });

    it("reads a stored (uncompressed) zip entry as well as a deflated one", async () => {
      h.responses.push(status(404), ok(zip(TEXT, 0)));
      expect(await new DictionaryDownloader(app().app).run()).toBe(N);
    });
  });

  describe("fails clearly, and writes nothing", () => {
    const run = async (...rs: Array<() => unknown>) => {
      h.responses.push(...rs);
      const { app: a, written } = app();
      const d = new DictionaryDownloader(a);
      const err = await d.run().then(
        () => null,
        (e: Error) => e
      );
      return { err, written, d };
    };

    it("when both endpoints answer with an HTTP error", async () => {
      const { err, written, d } = await run(status(500), status(502));
      expect(err?.message).toMatch(/HTTP 502/);
      expect(written.size).toBe(0);
      expect(d.getStatus().state).toBe("error");
      expect(d.getStatus().message).toMatch(/^Download failed: HTTP 502/);
    });

    it("when both endpoints are unreachable", async () => {
      const { err, written } = await run(() => new Error("offline"), () => new Error("offline"));
      expect(err?.message).toBe("offline");
      expect(written.size).toBe(0);
    });

    it.each([
      ["a zip with no end-of-directory record", zip(TEXT, 8, { badEocd: true }), /EOCD not found/],
      ["a zip with a damaged central directory", zip(TEXT, 8, { badCd: true }), /central dir signature/],
      ["a zip with a damaged local header", zip(TEXT, 8, { badLocal: true }), /local header signature/],
      ["a zip using a compression method we do not read", zip(TEXT, 12), /Unsupported ZIP compression method 12/],
    ])("on %s", async (_n, archive, msg) => {
      const { err, written } = await run(status(404), ok(archive));
      expect(err?.message).toMatch(msg);
      expect(written.size).toBe(0);
    });

    it("when the write itself fails, and says so", async () => {
      h.responses.push(ok(gz(TEXT)));
      const adapter = { write: vi.fn(async () => Promise.reject(new Error("disk full"))) };
      const d = new DictionaryDownloader({ vault: { adapter } } as never);
      await expect(d.run()).rejects.toThrow("disk full");
      expect(d.getStatus().message).toBe("Download failed: disk full");
    });
  });
});

describe("parseCedict edges", () => {
  it("uses the first CC-CEDICT comment, else a 'version' comment, as the version line", () => {
    expect(parseCedict("# CC-CEDICT x\n# CC-CEDICT y").versionLine).toBe("CC-CEDICT x");
    expect(parseCedict("# hello\n# Version 2\n# CC-CEDICT").versionLine).toBe("Version 2");
    expect(parseCedict("# nothing useful").versionLine).toBe("");
  });

  it("skips blank, comment and malformed lines, and handles CRLF", () => {
    const text = "# c\r\n\r\n你好 你好 [ni3 hao3] /hello/\r\nnot an entry\r\n只有 一个 [x] \r\n";
    expect(parseCedict(text).entries.map((e) => e.simplified)).toEqual(["你好"]);
  });

  it("drops empty definitions and trims the rest", () => {
    const [e] = parseCedict("你好 你好 [ni3 hao3] / hello // hi /").entries;
    expect(e.definitions).toEqual(["hello", "hi"]);
  });

  it("converts u: spellings and tones, and reports progress at the end and every 5000 entries", () => {
    const lines = Array.from({ length: 5001 }, () => "女 女 [nu:3] /woman/").join("\n");
    const progress: number[] = [];
    const { entries } = parseCedict(lines, (n) => progress.push(n));
    expect(entries[0].pinyin).toBe("nǚ");
    expect(progress).toEqual([5000, 5001]);
  });

  it("an empty file is an empty dictionary", () => {
    expect(parseCedict("")).toEqual({ entries: [], versionLine: "" });
  });
});
