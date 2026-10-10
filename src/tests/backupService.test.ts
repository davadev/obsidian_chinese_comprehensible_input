import { describe, expect, it, vi } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BACKUP_INDEX_FILE,
  BackupAdapter,
  BackupCodec,
  BackupContext,
  BackupService,
  PENDING_RESTORE_FILE,
  createGzipCodec,
  sha256Hex,
} from "../data/BackupService";

/**
 * #149: the service around the backup rules. An in-memory adapter with fault injection stands in for the vault, real
 * gzip and real SHA-256 do the rest. The properties under test: nothing here can stop the plugin from loading (every
 * failure path ends in a Notice and an untouched `data.json`), a snapshot always precedes anything that could change the
 * data, and the issue's whole story (install, upgrade through betas, downgrade, restore) ends with exactly the data the
 * older version left.
 */

const DIR = ".obsidian/plugins/cci/backups";
const DATA = ".obsidian/plugins/cci/data.json";
const VOCAB_MIRROR = "Chinese Learning/vocabulary.json";
const SETTINGS_MIRROR = "Chinese Learning/settings.json";

type Op = { op: string; path: string };

class FakeFs {
  files = new Map<string, string | Uint8Array>();
  dirs = new Set<string>([".obsidian/plugins/cci"]);
  ops: Op[] = [];
  /** Return an Error to make that operation fail. */
  fault: ((op: string, path: string) => Error | null) | null = null;

  private hit(op: string, path: string): void {
    this.ops.push({ op, path });
    const e = this.fault?.(op, path);
    if (e) throw e;
  }

  adapter: BackupAdapter = {
    exists: async (p) => {
      this.hit("exists", p);
      return this.files.has(p) || this.dirs.has(p);
    },
    read: async (p) => {
      this.hit("read", p);
      const v = this.files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return typeof v === "string" ? v : new TextDecoder().decode(v);
    },
    write: async (p, d) => {
      this.hit("write", p);
      this.files.set(p, d);
    },
    readBinary: async (p) => {
      this.hit("readBinary", p);
      const v = this.files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      const u = typeof v === "string" ? new TextEncoder().encode(v) : v;
      return u.slice().buffer;
    },
    writeBinary: async (p, d) => {
      this.hit("writeBinary", p);
      this.files.set(p, new Uint8Array(d));
    },
    mkdir: async (p) => {
      this.hit("mkdir", p);
      this.dirs.add(p);
    },
    remove: async (p) => {
      this.hit("remove", p);
      this.files.delete(p);
    },
    rename: async (a, b) => {
      this.hit("rename", `${a} -> ${b}`);
      const v = this.files.get(a);
      if (v === undefined) throw new Error(`ENOENT ${a}`);
      this.files.set(b, v);
      this.files.delete(a);
    },
  };

  text(p: string): string | undefined {
    const v = this.files.get(p);
    return v === undefined ? undefined : typeof v === "string" ? v : new TextDecoder().decode(v);
  }
}

interface Env {
  fs: FakeFs;
  notices: string[];
  ctx: BackupContext;
  svc: (version: string, codec?: BackupCodec) => BackupService;
}

function makeEnv(ctx: Partial<BackupContext> = {}): Env {
  const fs = new FakeFs();
  const notices: string[] = [];
  let tick = 0;
  const full: BackupContext = { enabled: true, keep: 5, vocabMirrorPath: null, settingsMirrorPath: null, ...ctx };
  return {
    fs,
    notices,
    ctx: full,
    svc: (version, codec = createGzipCodec()) =>
      new BackupService({
        adapter: fs.adapter,
        codec,
        sha256: sha256Hex,
        now: () => new Date(Date.UTC(2026, 9, 1, 0, 0, tick++)),
        notify: (m) => void notices.push(m),
        dir: DIR,
        dataPath: DATA,
        version,
        context: () => full,
      }),
  };
}

const readIndex = (fs: FakeFs) => JSON.parse(fs.text(`${DIR}/${BACKUP_INDEX_FILE}`) ?? "null");

describe("startup: the version-change snapshot", () => {
  it("snapshots the RAW text of data.json (byte for byte), labelled with the version that wrote it, and records the new version", async () => {
    const env = makeEnv();
    const raw = '{\n  "settings": {"a": 1},\n\t"vocab": {"words": {}}   \n}\n'; // odd whitespace must survive
    env.fs.files.set(DATA, raw);
    const r = await env.svc("0.8.0-beta.1").startup();

    expect(r.action).toBe("first-run");
    expect(r.backedUp).toMatchObject({ kind: "version-change", fromVersion: "unknown", encoding: "gzip", includes: ["data"] });
    const idx = readIndex(env.fs);
    expect(idx.lastRunVersion).toBe("0.8.0-beta.1");
    expect(idx.backups).toHaveLength(1);

    const stored = env.fs.files.get(`${DIR}/${r.backedUp!.file}`) as Uint8Array;
    const bundle = JSON.parse(gunzipSync(Buffer.from(stored)).toString("utf8"));
    expect(bundle).toEqual({ v: 1, files: { data: raw } });
    expect(r.backedUp!.sha256).toBe(await sha256Hex(JSON.stringify(bundle)));
  });

  it("an upgrade is labelled with the version recorded at the previous start", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    await env.svc("0.8.0-beta.1").startup();
    env.fs.files.set(DATA, '{"v":2}');
    const r = await env.svc("0.8.0-beta.2").startup();
    expect(r.action).toBe("upgrade");
    expect(r.backedUp?.fromVersion).toBe("0.8.0-beta.1");
  });

  it("the same version starting again does nothing at all", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    await env.svc("0.8.0").startup();
    env.fs.ops.length = 0;
    const r = await env.svc("0.8.0").startup();
    expect(r.action).toBe("same");
    expect(r.backedUp).toBeNull();
    expect(env.fs.ops.filter((o) => o.op !== "exists" && o.op !== "read")).toEqual([]);
  });

  it("an upgrade over unchanged data records the version but writes no second copy", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    await env.svc("0.8.0-beta.1").startup();
    const r = await env.svc("0.8.0-beta.2").startup();
    expect(r.skipped).toBe("unchanged");
    expect(readIndex(env.fs).backups).toHaveLength(1);
    expect(readIndex(env.fs).lastRunVersion).toBe("0.8.0-beta.2");
  });

  it("a fresh install (no data.json yet) has nothing to protect but still records the version", async () => {
    const env = makeEnv();
    const r = await env.svc("0.8.0").startup();
    expect(r.skipped).toBe("no-data");
    expect(r.backedUp).toBeNull();
    expect(readIndex(env.fs).lastRunVersion).toBe("0.8.0");
  });

  it("with backups switched off it takes nothing but still tracks the version", async () => {
    const env = makeEnv({ enabled: false });
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0").startup();
    expect(r.skipped).toBe("disabled");
    expect(readIndex(env.fs)).toEqual({ schemaVersion: 1, lastRunVersion: "0.8.0", backups: [] });
    expect([...env.fs.files.keys()].filter((k) => k.endsWith(".gz"))).toEqual([]);
  });

  it("includes this device's vault mirror files when they exist, and leaves out ones that do not", async () => {
    const env = makeEnv({ vocabMirrorPath: VOCAB_MIRROR, settingsMirrorPath: SETTINGS_MIRROR });
    env.fs.files.set(DATA, '{"v":1}');
    env.fs.files.set(VOCAB_MIRROR, '{"vocab":"mirror"}');
    const r = await env.svc("0.8.0").startup();
    expect(r.backedUp?.includes).toEqual(["data", "vocabMirror"]);
  });

  it("stores plain JSON when the device cannot compress, and that backup is restorable", async () => {
    const env = makeEnv();
    const noGzip: BackupCodec = { compress: async () => null, decompress: async () => { throw new Error("none"); } };
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0-beta.1", noGzip).startup();
    expect(r.backedUp?.encoding).toBe("none");
    expect(r.backedUp?.file.endsWith(".json")).toBe(true);

    env.fs.files.set(DATA, '{"v":"changed"}');
    expect((await env.svc("0.8.0-beta.1", noGzip).stageRestore(r.backedUp!.id)).ok).toBe(true);
    const applied = await env.svc("0.8.0-beta.1", noGzip).applyPendingRestore();
    expect(applied.status).toBe("applied");
    expect(env.fs.text(DATA)).toBe('{"v":1}');
  });

  it("a compressor that throws is treated as 'no gzip', not as a failed backup", async () => {
    const env = makeEnv();
    const broken: BackupCodec = { compress: async () => { throw new Error("boom"); }, decompress: async () => "" };
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0", broken).startup();
    expect(r.backedUp?.encoding).toBe("none");
  });
});

describe("ordering: nothing touches the data before the snapshot is safe", () => {
  it("never writes data.json, and records the version only after the backup file is in place and verified", async () => {
    const env = makeEnv({ vocabMirrorPath: VOCAB_MIRROR });
    env.fs.files.set(DATA, '{"v":1}');
    env.fs.files.set(VOCAB_MIRROR, "{}");
    await env.svc("0.8.0").startup();

    const writes = env.fs.ops.filter((o) => ["write", "writeBinary", "rename", "remove"].includes(o.op));
    expect(writes.some((o) => o.path.includes("data.json") || o.path.includes(VOCAB_MIRROR))).toBe(false);

    const idxRename = env.fs.ops.findIndex((o) => o.op === "rename" && o.path.endsWith(`${BACKUP_INDEX_FILE}.tmp -> ${DIR}/${BACKUP_INDEX_FILE}`));
    const fileRename = env.fs.ops.findIndex((o) => o.op === "rename" && o.path.includes(".json.gz.tmp -> "));
    const readBack = env.fs.ops.findIndex((o) => o.op === "readBinary");
    expect(fileRename).toBeGreaterThan(-1);
    expect(readBack).toBeGreaterThan(fileRename); // verified after it was written...
    expect(idxRename).toBeGreaterThan(readBack); // ...and only then is the version recorded
  });
});

describe("failure paths: the plugin must still load, and the data must be untouched", () => {
  const SEED = '{"precious":"data"}';

  it("disk full while writing the backup: notice, version NOT recorded, retried at the next start", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.fault = (op, p) => ((op === "writeBinary" || op === "write") && p.includes("version-change") ? new Error("ENOSPC: disk full") : null);
    const r = await env.svc("0.8.0").startup();

    expect(r.failed).toContain("disk full");
    expect(r.backedUp).toBeNull();
    expect(env.fs.text(DATA)).toBe(SEED);
    expect(env.notices.join(" ")).toContain("could not back up your data");
    expect(env.fs.files.has(`${DIR}/${BACKUP_INDEX_FILE}`) ? readIndex(env.fs).lastRunVersion : undefined).toBeUndefined();
    expect([...env.fs.files.keys()].filter((k) => k.includes("version-change"))).toEqual([]); // nothing half-written left

    env.fs.fault = null;
    const retry = await env.svc("0.8.0").startup();
    expect(retry.backedUp).not.toBeNull();
    expect(readIndex(env.fs).lastRunVersion).toBe("0.8.0");
  });

  it("unreadable data.json: fails open with a notice", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.fault = (op, p) => (op === "read" && p === DATA ? new Error("EIO") : null);
    const r = await env.svc("0.8.0").startup();
    expect(r.failed).toContain("EIO");
    expect(env.notices.length).toBeGreaterThan(0);
  });

  it("cannot create the backups folder: fails open", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.fault = (op) => (op === "mkdir" ? new Error("EACCES") : null);
    const r = await env.svc("0.8.0").startup();
    expect(r.failed).toContain("EACCES");
    expect(env.fs.text(DATA)).toBe(SEED);
  });

  it("a backup that does not read back identically is removed, not trusted", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    const real = env.fs.adapter.writeBinary;
    env.fs.adapter.writeBinary = async (p, d) => {
      const bad = new Uint8Array(d);
      bad[bad.length - 1] ^= 0xff; // corrupt the gzip trailer
      await real(p, bad.buffer);
    };
    const r = await env.svc("0.8.0").startup();
    expect(r.failed).toBeTruthy();
    expect([...env.fs.files.keys()].filter((k) => k.endsWith(".json.gz"))).toEqual([]);
    expect(env.fs.text(DATA)).toBe(SEED);
  });

  it("a backup that decodes fine but to DIFFERENT content (silent corruption) is removed, not trusted", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    const real = env.fs.adapter.writeBinary;
    env.fs.adapter.writeBinary = async (p, d) => {
      void d;
      const other = gzipSync(Buffer.from(JSON.stringify({ v: 1, files: { data: "SOMETHING ELSE" } })));
      await real(p, new Uint8Array(other).buffer);
    };
    const r = await env.svc("0.8.0").startup();
    expect(r.failed).toContain("did not read back identically");
    expect([...env.fs.files.keys()].filter((k) => k.endsWith(".json.gz"))).toEqual([]);
    expect(readIndex(env.fs)?.lastRunVersion).toBeUndefined();
  });

  it("rename unsupported: falls back to a direct write and still produces a verified backup", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.fault = (op) => (op === "rename" ? new Error("rename unsupported") : null);
    const r = await env.svc("0.8.0").startup();
    expect(r.backedUp).not.toBeNull();
    expect(env.fs.files.has(`${DIR}/${r.backedUp!.file}`)).toBe(true);
    expect([...env.fs.files.keys()].filter((k) => k.endsWith(".tmp"))).toEqual([]);
  });

  it("a corrupt index is set aside, history starts afresh, and the start still completes", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.dirs.add(DIR);
    env.fs.files.set(`${DIR}/${BACKUP_INDEX_FILE}`, "{ not json");
    const r = await env.svc("0.8.0").startup();
    expect(r.backedUp).not.toBeNull();
    expect(env.fs.text(`${DIR}/${BACKUP_INDEX_FILE}.bad`)).toBe("{ not json");
    expect(env.notices.join(" ")).toContain("unreadable");
    expect(readIndex(env.fs).backups).toHaveLength(1);
  });

  it("index entries that are malformed or point outside the folder are ignored", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.dirs.add(DIR);
    const good = { id: "ok", createdAt: "2026-01-01T00:00:00.000Z", fromVersion: "0.8.0", kind: "manual", file: "ok.json", encoding: "none", rawBytes: 1, storedBytes: 1, sha256: "x", includes: ["data"] };
    env.fs.files.set(
      `${DIR}/${BACKUP_INDEX_FILE}`,
      JSON.stringify({ schemaVersion: 1, lastRunVersion: "0.8.0", backups: [good, { ...good, id: "evil", file: "../../data.json" }, { ...good, id: "bad", kind: "nonsense" }, null, "x"] })
    );
    const list = await env.svc("0.8.0").list();
    expect(list.map((e) => e.id)).toEqual(["ok"]);
  });

  it("an exception thrown by the notifier itself does not escape", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, SEED);
    env.fs.fault = (op) => (op === "mkdir" ? new Error("EACCES") : null);
    const svc = new BackupService({
      adapter: env.fs.adapter, codec: createGzipCodec(), sha256: sha256Hex, now: () => new Date(0),
      notify: () => { throw new Error("no UI yet"); }, dir: DIR, dataPath: DATA, version: "0.8.0", context: () => env.ctx,
    });
    await expect(svc.startup()).resolves.toMatchObject({ failed: expect.stringContaining("EACCES") });
  });
});

describe("retention on disk", () => {
  it("keeps the newest N, deletes the files of the rest, and never evicts the stable-origin backup", async () => {
    const env = makeEnv({ keep: 2 });
    env.fs.files.set(DATA, '{"n":0}');
    await env.svc("0.8.0").startup(); // first run: backup labelled "unknown"
    const versions = ["0.9.0-beta.1", "0.9.0-beta.2", "0.9.0-beta.3", "0.9.0-beta.4", "0.9.0-beta.5"];
    for (let i = 0; i < versions.length; i++) {
      env.fs.files.set(DATA, `{"n":${i + 1}}`);
      await env.svc(versions[i]).startup();
    }
    const idx = readIndex(env.fs);
    const labels = idx.backups.map((e: { fromVersion: string }) => e.fromVersion);
    expect(labels).toContain("0.8.0"); // pinned: the stable that leads back
    expect(idx.backups.length).toBeLessThanOrEqual(3);
    const onDisk = [...env.fs.files.keys()].filter((k) => k.startsWith(DIR) && k.endsWith(".json.gz"));
    expect(onDisk).toHaveLength(idx.backups.length); // dropped entries' files are gone
  });
});

describe("manual backup", () => {
  it("backs up now even with automatic backups off, and says so when nothing changed since the last one", async () => {
    const env = makeEnv({ enabled: false });
    env.fs.files.set(DATA, '{"v":1}');
    const svc = env.svc("0.8.0");
    const first = await svc.snapshot();
    expect(first.entry).toMatchObject({ kind: "manual", fromVersion: "0.8.0" });
    const again = await svc.snapshot();
    expect(again).toEqual({ entry: null, skipped: "unchanged" });
    env.fs.files.set(DATA, '{"v":2}');
    expect((await svc.snapshot()).entry).not.toBeNull();
    expect((await svc.list())).toHaveLength(2);
  });

  it("reports a failure instead of throwing", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    env.fs.fault = (op) => (op === "mkdir" ? new Error("EACCES") : null);
    const r = await env.svc("0.8.0").snapshot();
    expect(r.failed).toContain("EACCES");
  });

  it("a manual backup racing the start-up snapshot cannot corrupt the index", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    const svc = env.svc("0.8.0");
    const [a, b] = await Promise.all([svc.startup(), svc.snapshot()]);
    expect(a.backedUp).not.toBeNull();
    expect(b.entry === null ? b.skipped : "taken").toBeTruthy();
    const idx = readIndex(env.fs);
    expect(idx.backups.every((e: { file: string }) => env.fs.files.has(`${DIR}/${e.file}`))).toBe(true);
  });
});

describe("staged restore", () => {
  it("queueing a restore writes only the marker: data.json and the history are untouched", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0").startup();
    env.fs.files.set(DATA, '{"v":2}');
    const before = new Map(env.fs.files);
    const staged = await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    expect(staged.ok).toBe(true);
    expect(env.fs.text(DATA)).toBe('{"v":2}');
    const changed = [...env.fs.files.keys()].filter((k) => before.get(k) !== env.fs.files.get(k));
    expect(changed).toEqual([`${DIR}/${PENDING_RESTORE_FILE}`]);
  });

  it("refuses an unknown id or a missing backup file, and changes nothing", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0").startup();
    expect((await env.svc("0.8.0").stageRestore("nope")).ok).toBe(false);
    env.fs.files.delete(`${DIR}/${r.backedUp!.file}`);
    const missing = await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    expect(missing.ok).toBe(false);
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
  });

  it("a queued restore can be withdrawn", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0").startup();
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    await env.svc("0.8.0").cancelRestore();
    expect((await env.svc("0.8.0").applyPendingRestore()).status).toBe("none");
  });

  it("with nothing queued, applyPendingRestore does nothing and reads nothing but the marker's existence", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    env.fs.ops.length = 0;
    expect((await env.svc("0.8.0").applyPendingRestore()).status).toBe("none");
    expect(env.fs.ops).toEqual([{ op: "exists", path: `${DIR}/${PENDING_RESTORE_FILE}` }]);
  });

  async function stagedWith(mutate?: (env: Env, entryFile: string) => void) {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":"old"}');
    const r = await env.svc("0.8.0").startup();
    env.fs.files.set(DATA, '{"v":"current"}');
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    mutate?.(env, `${DIR}/${r.backedUp!.file}`);
    return { env, entry: r.backedUp! };
  }

  it("applies: data.json becomes exactly the backup, the marker goes, and the version is recorded", async () => {
    const { env } = await stagedWith();
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("applied");
    expect(env.fs.text(DATA)).toBe('{"v":"old"}');
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
    expect(readIndex(env.fs).lastRunVersion).toBe("0.8.0");
  });

  it("is itself reversible: what was on disk is kept as a pre-restore backup that restores back", async () => {
    const { env } = await stagedWith();
    await env.svc("0.8.0").applyPendingRestore();
    const pre = readIndex(env.fs).backups.find((e: { kind: string }) => e.kind === "pre-restore");
    expect(pre).toBeTruthy();
    await env.svc("0.8.0").stageRestore(pre.id);
    expect((await env.svc("0.8.0").applyPendingRestore()).status).toBe("applied");
    expect(env.fs.text(DATA)).toBe('{"v":"current"}');
  });

  it.each([
    ["a corrupt (but present) gzip file", (env: Env, f: string) => env.fs.files.set(f, new Uint8Array([1, 2, 3, 4]))],
    ["a gzip file whose content was tampered with", (env: Env, f: string) => {
      // Replace with a valid gzip of different text: decodes fine, fails the checksum.
      env.fs.files.set(f, new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ v: 1, files: { data: "TAMPERED" } })))));
    }],
    ["a missing backup file", (env: Env, f: string) => env.fs.files.delete(f)],
  ])("%s: the restore is abandoned, the marker removed, and the current data is untouched", async (_name, mutate) => {
    const { env } = await stagedWith(mutate);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("failed");
    expect(env.fs.text(DATA)).toBe('{"v":"current"}');
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
    expect(env.notices.join(" ")).toContain("Your current data was not changed");
  });

  it("a marker naming a backup that is no longer listed fails cleanly", async () => {
    const { env } = await stagedWith();
    env.fs.files.set(`${DIR}/${PENDING_RESTORE_FILE}`, JSON.stringify({ id: "ghost" }));
    expect((await env.svc("0.8.0").applyPendingRestore()).status).toBe("failed");
    expect(env.fs.text(DATA)).toBe('{"v":"current"}');
  });

  it("an unreadable marker fails cleanly", async () => {
    const { env } = await stagedWith();
    env.fs.files.set(`${DIR}/${PENDING_RESTORE_FILE}`, "{{{");
    expect((await env.svc("0.8.0").applyPendingRestore()).status).toBe("failed");
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
  });

  it("if the undo point cannot be saved, the restore is NOT done", async () => {
    const { env } = await stagedWith();
    env.fs.fault = (op, p) => ((op === "writeBinary" || op === "write") && p.includes("pre-restore") ? new Error("ENOSPC") : null);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("failed");
    expect(env.fs.text(DATA)).toBe('{"v":"current"}');
  });

  it("if data.json cannot be written, the restore is abandoned", async () => {
    const { env } = await stagedWith();
    env.fs.fault = (op, p) => (op === "write" && p.startsWith(DATA) ? new Error("EACCES") : null);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("failed");
    expect(env.fs.text(DATA)).toBe('{"v":"current"}');
  });

  it("rewrites the vault mirror files that still exist, and leaves alone one the user has since removed", async () => {
    const env = makeEnv({ vocabMirrorPath: VOCAB_MIRROR, settingsMirrorPath: SETTINGS_MIRROR });
    env.fs.files.set(DATA, '{"v":"old"}');
    env.fs.files.set(VOCAB_MIRROR, "VOCAB-OLD");
    env.fs.files.set(SETTINGS_MIRROR, "SETTINGS-OLD");
    const r = await env.svc("0.8.0").startup();
    expect(r.backedUp?.includes).toEqual(["data", "vocabMirror", "settingsMirror"]);

    env.fs.files.set(DATA, '{"v":"new"}');
    env.fs.files.set(VOCAB_MIRROR, "VOCAB-NEW");
    env.fs.files.delete(SETTINGS_MIRROR); // the user stopped using the settings mirror
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    const res = await env.svc("0.8.0").applyPendingRestore();

    expect(res.status).toBe("applied");
    expect(env.fs.text(VOCAB_MIRROR)).toBe("VOCAB-OLD");
    expect(env.fs.files.has(SETTINGS_MIRROR)).toBe(false);
    expect(res.mirrorsSkipped).toEqual([SETTINGS_MIRROR]);
    expect(env.notices.join(" ")).toContain("sync file");
  });
});

describe("the remaining failure paths: each ends as a result, never as an exception", () => {
  const boom = (match: (op: string, p: string) => boolean) => (op: string, p: string) => (match(op, p) ? new Error("EIO") : null);

  it("start-up: a failure while recording the version (index unwritable) is reported, not thrown", async () => {
    const env = makeEnv({ enabled: false });
    env.fs.files.set(DATA, "{}");
    env.fs.fault = boom((op) => op === "mkdir");
    const r = await env.svc("0.8.0").startup();
    expect(r.failed).toContain("EIO");
    expect(env.notices.join(" ")).toContain("backup check failed");
  });

  it("list() answers with an empty list when the index cannot be read at all", async () => {
    const env = makeEnv();
    env.fs.dirs.add(DIR);
    env.fs.files.set(`${DIR}/${BACKUP_INDEX_FILE}`, "{}");
    env.fs.fault = boom((op, p) => op === "exists" && p.endsWith(BACKUP_INDEX_FILE));
    expect(await env.svc("0.8.0").list()).toEqual([]);
  });

  it("stageRestore: a marker that cannot be written says so and changes nothing", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, "{}");
    const r = await env.svc("0.8.0").startup();
    env.fs.fault = boom((op, p) => op === "write" && p.includes(PENDING_RESTORE_FILE));
    const res = await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Nothing was changed");
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
  });

  it("keepCurrent: an unwritable index is reported, and the question simply comes back next start", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, "{}");
    await env.svc("0.9.0").startup();
    env.fs.fault = boom((op, p) => op === "write" && p.includes(BACKUP_INDEX_FILE));
    await expect(env.svc("0.8.0").keepCurrent()).resolves.toBeUndefined();
    expect(env.notices.join(" ")).toContain("could not record the version change");
  });

  it("restore: a mirror file that cannot be rewritten is reported as skipped while the data itself is restored", async () => {
    const env = makeEnv({ vocabMirrorPath: VOCAB_MIRROR });
    env.fs.files.set(DATA, '{"v":"old"}');
    env.fs.files.set(VOCAB_MIRROR, "OLD");
    const r = await env.svc("0.8.0").startup();
    env.fs.files.set(DATA, '{"v":"new"}');
    env.fs.files.set(VOCAB_MIRROR, "NEW");
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    env.fs.fault = boom((op, p) => (op === "write" || op === "rename") && p.includes("Chinese Learning"));
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("applied");
    expect(res.mirrorsSkipped).toEqual([VOCAB_MIRROR]);
    expect(env.fs.text(DATA)).toBe('{"v":"old"}');
  });

  it("restore: an unexpected error after the marker was seen still drops the marker and leaves the data alone", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":"old"}');
    const r = await env.svc("0.8.0").startup();
    env.fs.files.set(DATA, '{"v":"new"}');
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    // Break the index read itself, after the marker has been recognised.
    let reads = 0;
    env.fs.fault = (op, p) => (op === "read" && p.endsWith(BACKUP_INDEX_FILE) && ++reads >= 2 ? new Error("EIO") : null);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status === "failed" || res.status === "applied").toBe(true);
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
  });
});

describe("pendingRestore (what the Settings list shows)", () => {
  it("is null with nothing queued, the queued entry once queued, and null again after withdrawing", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    const r = await env.svc("0.8.0").startup();
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    expect((await env.svc("0.8.0").pendingRestore())?.id).toBe(r.backedUp!.id);
    await env.svc("0.8.0").cancelRestore();
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
  });

  it("is null for an unreadable marker or one naming a backup that is gone", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    await env.svc("0.8.0").startup();
    env.fs.files.set(`${DIR}/${PENDING_RESTORE_FILE}`, "{{{");
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
    env.fs.files.set(`${DIR}/${PENDING_RESTORE_FILE}`, JSON.stringify({ id: "ghost" }));
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
  });
});

describe("downgrade: the story from the issue", () => {
  // S is a stable release that has this feature; b1..b3 are betas after it. The data each version leaves is distinct.
  const S = "0.9.0", b1 = "0.10.0-beta.1", b2 = "0.10.0-beta.2";
  const D_S = '{"words":["by S"]}', D_S_LATER = '{"words":["by S","marked in S"]}', D_B1 = '{"words":["rewritten by b1"]}', D_B2 = '{"words":["b2 migrated this"]}';

  it("install S, upgrade through two betas, go back to S, restore: the data is exactly what S left, and the cycle repeats", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, D_S);
    await env.svc(S).startup(); // S's first run: the feature starts recording
    env.fs.files.set(DATA, D_S_LATER); // the user keeps using S

    const up1 = await env.svc(b1).startup();
    expect(up1).toMatchObject({ action: "upgrade", backedUp: { fromVersion: S } });
    env.fs.files.set(DATA, D_B1);
    const up2 = await env.svc(b2).startup();
    expect(up2).toMatchObject({ action: "upgrade", backedUp: { fromVersion: b1 } });
    env.fs.files.set(DATA, D_B2);

    // BRAT puts S back. Its code runs against b2's data.
    const down = await env.svc(S).startup();
    expect(down.action).toBe("downgrade");
    expect(down.downgrade).toMatchObject({ from: b2, to: S });
    expect(down.downgrade?.candidate?.fromVersion).toBe(S); // only the S backup qualifies: exactly the data S left
    expect(readIndex(env.fs).lastRunVersion).toBe(b2); // not recorded until the user answers
    expect(readIndex(env.fs).backups.some((e: { kind: string }) => e.kind === "downgrade-safety")).toBe(true);

    // "Decide later" asks again next start, and does not stack more safety copies.
    const again = await env.svc(S).startup();
    expect(again.action).toBe("downgrade");
    expect(readIndex(env.fs).backups.filter((e: { kind: string }) => e.kind === "downgrade-safety")).toHaveLength(1);

    // Restore, restart.
    expect((await env.svc(S).stageRestore(down.downgrade!.candidate!.id)).ok).toBe(true);
    const applied = await env.svc(S).applyPendingRestore();
    expect(applied.status).toBe("applied");
    expect(env.fs.text(DATA)).toBe(D_S_LATER);
    expect((await env.svc(S).startup()).action).toBe("same"); // restore recorded S as the running version

    // ...and the way forward again works.
    env.fs.files.set(DATA, '{"words":["S after restore"]}');
    const up3 = await env.svc(b1).startup();
    expect(up3).toMatchObject({ action: "upgrade", backedUp: { fromVersion: S } });
  });

  it("'Keep current data' records the lower version so the question is not asked again", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, D_S);
    await env.svc(b2).startup();
    env.fs.files.set(DATA, D_B2);
    const down = await env.svc(S).startup();
    expect(down.action).toBe("downgrade");
    await env.svc(S).keepCurrent();
    expect((await env.svc(S).startup()).action).toBe("same");
    expect(env.fs.text(DATA)).toBe(D_B2); // keeping means keeping
  });

  it("a downgrade with no suitable backup reports no candidate (nothing to offer)", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, D_S);
    await env.svc(b2).startup(); // only backup is labelled "unknown": offered, since unknown counts as oldest
    const down = await env.svc(S).startup();
    expect(down.downgrade?.candidate?.fromVersion).toBe("unknown");

    const empty = makeEnv();
    empty.fs.dirs.add(DIR);
    empty.fs.files.set(`${DIR}/${BACKUP_INDEX_FILE}`, JSON.stringify({ schemaVersion: 1, lastRunVersion: b2, backups: [] }));
    empty.fs.files.set(DATA, D_B2);
    const d2 = await empty.svc(S).startup();
    expect(d2.downgrade?.candidate).toBeNull();
  });

  it("downgrading with backups switched off neither prompts nor snapshots", async () => {
    const env = makeEnv({ enabled: false });
    env.fs.files.set(DATA, D_S);
    await env.svc(b2).startup();
    const down = await env.svc(S).startup();
    expect(down.downgrade).toBeUndefined();
    expect(down.skipped).toBe("disabled");
  });

  it("a failure to save the safety copy does not stop the downgrade question", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, D_S);
    await env.svc(S).startup();
    env.fs.files.set(DATA, D_S_LATER);
    await env.svc(b2).startup();
    env.fs.files.set(DATA, D_B2);
    env.fs.fault = (op, p) => ((op === "writeBinary" || op === "write") && p.includes("downgrade-safety") ? new Error("ENOSPC") : null);
    const down = await env.svc(S).startup();
    expect(down.downgrade?.candidate).not.toBeNull();
    expect(env.notices.join(" ")).toContain("safety copy");
  });
});

describe("createGzipCodec", () => {
  it("round-trips unicode and a multi-megabyte payload, and its output is real gzip", async () => {
    const codec = createGzipCodec();
    const text = JSON.stringify({ words: Array.from({ length: 40000 }, (_, i) => `词${i} 你好 ${"x".repeat(i % 40)}`) });
    expect(text.length).toBeGreaterThan(1_000_000);
    const bytes = (await codec.compress(text))!;
    expect(bytes.length).toBeLessThan(text.length / 3);
    expect(gunzipSync(Buffer.from(bytes)).toString("utf8")).toBe(text);
    expect(await codec.decompress(bytes)).toBe(text);
  });

  it("reports 'cannot compress' (null) where CompressionStream does not exist", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    try {
      expect(await createGzipCodec().compress("x")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to read a compressed backup where DecompressionStream does not exist", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    try {
      await expect(createGzipCodec().decompress(new Uint8Array([1]))).rejects.toThrow(/cannot read compressed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("what a damaged or foreign index and marker can contain", () => {
  const indexPath = `${DIR}/${BACKUP_INDEX_FILE}`;
  const entry = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    createdAt: "2026-10-01T00:00:00.000Z",
    fromVersion: "0.7.9",
    kind: "manual",
    file: "e1.json.gz",
    encoding: "gzip",
    rawBytes: 10,
    storedBytes: 5,
    sha256: "abc",
    includes: ["data"],
    ...over,
  });
  const withIndex = (raw: string) => {
    const env = makeEnv();
    env.fs.dirs.add(DIR);
    env.fs.files.set(indexPath, raw);
    return env;
  };

  it("lists only well-formed entries: every required field is checked, and a bad `includes` just means none", async () => {
    const bad = [
      entry({ id: 5 }),
      entry({ id: "" }),
      entry({ createdAt: undefined }),
      entry({ fromVersion: undefined }),
      entry({ file: undefined }),
      entry({ sha256: undefined }),
      entry({ rawBytes: "10" }),
      entry({ rawBytes: Infinity }),
      entry({ storedBytes: undefined }),
      entry({ kind: "nope" }),
      entry({ encoding: "zip" }),
      entry({ file: "../x.json" }),
      entry({ file: "a/b.json" }),
      entry({ file: "a\\b.json" }),
      null,
      "text",
    ];
    const env = withIndex(JSON.stringify({ schemaVersion: 1, backups: [...bad, entry({ id: "ok", includes: "data" })] }));
    const list = await env.svc("0.8.0").list();
    expect(list.map((e) => e.id)).toEqual(["ok"]);
    expect(list[0].includes).toEqual([]);
  });

  it.each([["null"], ["5"], ['"text"'], ['{"backups":"x"}'], ['{"backups":null,"lastRunVersion":7}']])(
    "reads %s as an empty history, without setting the file aside",
    async (raw) => {
      const env = withIndex(raw);
      expect(await env.svc("0.8.0").list()).toEqual([]);
      expect(env.fs.files.has(`${indexPath}.bad`)).toBe(false);
    }
  );

  it("sorts equal timestamps stably and newest first", async () => {
    const env = withIndex(
      JSON.stringify({
        backups: [
          entry({ id: "a", createdAt: "2026-10-01T00:00:00.000Z" }),
          entry({ id: "b", createdAt: "2026-10-03T00:00:00.000Z" }),
          entry({ id: "c", createdAt: "2026-10-01T00:00:00.000Z" }),
          entry({ id: "d", createdAt: "2026-10-02T00:00:00.000Z" }),
        ],
      })
    );
    expect((await env.svc("0.8.0").list()).map((e) => e.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("replaces an older .bad copy when a second damaged index is set aside", async () => {
    const env = withIndex("{{{ first");
    await env.svc("0.8.0").list();
    expect(env.fs.text(`${indexPath}.bad`)).toBe("{{{ first");
    env.fs.files.set(indexPath, "{{{ second");
    await env.svc("0.8.0").list();
    expect(env.fs.text(`${indexPath}.bad`)).toBe("{{{ second");
  });

  it("start-up with backups off and nothing changed writes nothing", async () => {
    const env = makeEnv({ enabled: false });
    env.fs.files.set(DATA, "{}");
    await env.svc("0.8.0").startup();
    const writes = () => env.fs.ops.filter((o) => o.op === "write").length;
    const before = writes();
    const r = await env.svc("0.8.0").startup();
    expect(r).toMatchObject({ action: "same", skipped: "disabled" });
    expect(writes()).toBe(before);
  });

  it("cancelRestore with nothing queued is a quiet no-op", async () => {
    const env = makeEnv();
    await expect(env.svc("0.8.0").cancelRestore()).resolves.toBeUndefined();
    expect(env.notices).toEqual([]);
  });

  it("a marker without an id queues nothing and is dropped on apply", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":1}');
    await env.svc("0.8.0").startup();
    env.fs.files.set(`${DIR}/${PENDING_RESTORE_FILE}`, "{}");
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("failed");
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
    expect(env.fs.text(DATA)).toBe('{"v":1}');
  });

  it("restoring when the index never recorded a version labels the undo point 'unknown'", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":"old"}');
    const r = await env.svc("0.8.0").startup();
    const idx = readIndex(env.fs);
    delete idx.lastRunVersion;
    env.fs.files.set(indexPath, JSON.stringify(idx));
    env.fs.files.set(DATA, '{"v":"new"}');
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("applied");
    expect(readIndex(env.fs).backups.find((e: { kind: string }) => e.kind === "pre-restore").fromVersion).toBe("unknown");
  });

  it("a failure while recording the restore is reported as a failed restore, with the marker dropped", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":"old"}');
    const r = await env.svc("0.8.0").startup();
    env.fs.files.set(DATA, '{"v":"new"}');
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    // Once the data has been put back, the final index write breaks.
    env.fs.fault = (op, p) => (op === "write" && p.includes(BACKUP_INDEX_FILE) && env.fs.text(DATA) === '{"v":"old"}' ? new Error("EIO") : null);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("failed");
    expect(res.message).toContain("EIO");
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
  });

  it("a backup file that holds JSON but not a bundle is refused", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, '{"v":"old"}');
    const r = await env.svc("0.8.0").startup();
    const idx = readIndex(env.fs);
    idx.backups[0].encoding = "none";
    idx.backups[0].sha256 = await sha256Hex("null");
    env.fs.files.set(indexPath, JSON.stringify(idx));
    env.fs.files.set(`${DIR}/${r.backedUp!.file}`, "null");
    env.fs.files.set(DATA, '{"v":"new"}');
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    const res = await env.svc("0.8.0").applyPendingRestore();
    expect(res.status).toBe("failed");
    expect(res.message).toContain("not a backup this version understands");
    expect(env.fs.text(DATA)).toBe('{"v":"new"}');
  });

  it("dropping an old backup whose file is already gone is not an error", async () => {
    const env = makeEnv({ keep: 1 });
    env.fs.files.set(DATA, '{"v":1}');
    const first = await env.svc("0.7.0").startup();
    env.fs.files.delete(`${DIR}/${first.backedUp!.file}`);
    env.fs.files.set(DATA, '{"v":2}');
    const second = await env.svc("0.8.0").startup();
    expect(second.backedUp).not.toBeNull();
    expect(env.notices).toEqual([]);
  });

  it("failure notices always carry some text: non-Error throws, empty messages, nameless errors", async () => {
    const run = async (thrown: unknown) => {
      const env = makeEnv({ enabled: false });
      env.fs.files.set(DATA, "{}");
      env.fs.fault = (op) => (op === "mkdir" ? (thrown as Error) : null);
      return (await env.svc("0.8.0").startup()).failed ?? "";
    };
    expect(await run("plain string")).toContain("plain string");
    expect(await run(Object.assign(new Error(""), { name: "EACCES" }))).toContain("EACCES");
    expect(await run(Object.assign(new Error(""), { name: "" }))).toContain("unknown error");
  });
});

describe("the operation queue", () => {
  it("an operation that fails does not wedge the ones queued behind it", async () => {
    const env = makeEnv();
    const svc = env.svc("0.8.0") as unknown as { run: <T>(fn: () => Promise<T>) => Promise<T> };
    await expect(svc.run(async () => { throw new Error("bug"); })).rejects.toThrow("bug");
    await expect(svc.run(async () => "still running")).resolves.toBe("still running");
  });
});

describe("deleteBackup", () => {
  const twoBackups = async () => {
    const env = makeEnv({ keep: 5 });
    env.fs.files.set(DATA, '{"v":1}');
    const first = (await env.svc("0.7.0").startup()).backedUp!;
    env.fs.files.set(DATA, '{"v":2}');
    const second = (await env.svc("0.8.0").startup()).backedUp!;
    return { env, first, second };
  };

  it("removes the entry and the file, and leaves the other backup and data.json alone", async () => {
    const { env, first, second } = await twoBackups();
    const r = await env.svc("0.8.0").deleteBackup(first.id);
    expect(r).toEqual({ ok: true, message: "Backup deleted." });
    expect((await env.svc("0.8.0").list()).map((e) => e.id)).toEqual([second.id]);
    expect(env.fs.files.has(`${DIR}/${first.file}`)).toBe(false);
    expect(env.fs.files.has(`${DIR}/${second.file}`)).toBe(true);
    expect(env.fs.text(DATA)).toBe('{"v":2}');
  });

  it("writes the index before it removes the file, so a failure never leaves a listed backup without a file", async () => {
    const { env, first } = await twoBackups();
    env.fs.ops.length = 0;
    await env.svc("0.8.0").deleteBackup(first.id);
    const iWrite = env.fs.ops.findIndex((o) => o.op === "write" && o.path.includes(BACKUP_INDEX_FILE));
    const iRemove = env.fs.ops.findIndex((o) => o.op === "remove" && o.path.endsWith(first.file));
    expect(iWrite).toBeGreaterThanOrEqual(0);
    expect(iRemove).toBeGreaterThan(iWrite);
  });

  it("withdraws a restore that was queued for it, but not one queued for another backup", async () => {
    const { env, first, second } = await twoBackups();
    await env.svc("0.8.0").stageRestore(second.id);
    await env.svc("0.8.0").deleteBackup(first.id);
    expect((await env.svc("0.8.0").pendingRestore())?.id).toBe(second.id);
    await env.svc("0.8.0").deleteBackup(second.id);
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
    expect(env.fs.files.has(`${DIR}/${PENDING_RESTORE_FILE}`)).toBe(false);
  });

  it("copes with a marker it cannot read, and with the file already being gone", async () => {
    const { env, first } = await twoBackups();
    env.fs.files.set(`${DIR}/${PENDING_RESTORE_FILE}`, "{{{");
    env.fs.files.delete(`${DIR}/${first.file}`);
    expect((await env.svc("0.8.0").deleteBackup(first.id)).ok).toBe(true);
  });

  it("says so for a backup that is not in the list", async () => {
    const { env } = await twoBackups();
    const r = await env.svc("0.8.0").deleteBackup("ghost");
    expect(r).toEqual({ ok: false, message: "That backup is no longer in the list." });
    expect(env.notices).toEqual([]);
  });

  it("an unwritable index fails with a notice and keeps both the entry and the file", async () => {
    const { env, first } = await twoBackups();
    env.fs.fault = (op, p) => (op === "write" && p.includes(BACKUP_INDEX_FILE) ? new Error("EIO") : null);
    const r = await env.svc("0.8.0").deleteBackup(first.id);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("EIO");
    expect(env.notices.join(" ")).toContain("Could not delete the backup");
    env.fs.fault = null;
    expect((await env.svc("0.8.0").list()).map((e) => e.id)).toContain(first.id);
    expect(env.fs.files.has(`${DIR}/${first.file}`)).toBe(true);
  });
});

describe("pendingRestore when the index cannot be read", () => {
  it("answers null instead of throwing", async () => {
    const env = makeEnv();
    env.fs.files.set(DATA, "{}");
    const r = await env.svc("0.8.0").startup();
    await env.svc("0.8.0").stageRestore(r.backedUp!.id);
    env.fs.fault = (op, p) => (op === "exists" && p.endsWith(BACKUP_INDEX_FILE) ? new Error("EIO") : null);
    expect(await env.svc("0.8.0").pendingRestore()).toBeNull();
  });
});
