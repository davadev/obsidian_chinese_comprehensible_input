import { describe, expect, it, vi } from "vitest";
import {
  CrashState,
  DEFAULT_CRASH_STATE,
  crashStatePath,
  decideOnLoad,
  readCrashState,
  writeCrashState,
} from "../crashGuard";

const THRESHOLD = 5;

/** Fake adapter that records the order of operations, so "was it written
 *  before we proceeded?" is answerable. */
function fakeAdapter(seed?: string) {
  const files = new Map<string, string>();
  const ops: string[] = [];
  if (seed !== undefined) files.set("p", seed);
  return {
    ops,
    files,
    adapter: {
      exists: async (p: string) => { ops.push(`exists:${p}`); return files.has(p); },
      read: async (p: string) => {
        ops.push(`read:${p}`);
        const v = files.get(p);
        if (v === undefined) throw new Error("ENOENT");
        return v;
      },
      write: async (p: string, d: string) => { ops.push(`write:${p}`); files.set(p, d); },
    },
  };
}

describe("decideOnLoad", () => {
  it("counts a normal launch and lets it proceed", () => {
    const d = decideOnLoad({ counter: 0, autoDisabled: false }, THRESHOLD);
    expect(d.action).toBe("proceed");
    expect(d.next).toEqual({ counter: 1, autoDisabled: false });
  });

  it("still proceeds on the last launch before the threshold", () => {
    // counter 4 -> 5, and 5 is not > 5.
    const d = decideOnLoad({ counter: 4, autoDisabled: false }, THRESHOLD);
    expect(d.action).toBe("proceed");
    expect(d.next.counter).toBe(5);
  });

  it("trips exactly one launch later, matching the previous behaviour", () => {
    // counter 5 -> 6, and 6 > 5.
    const d = decideOnLoad({ counter: 5, autoDisabled: false }, THRESHOLD);
    expect(d.action).toBe("trip-threshold");
    expect(d.next).toEqual({ counter: 0, autoDisabled: true });
  });

  it("clears the auto-disable flag on the way past, whatever the counter", () => {
    for (const counter of [0, 3, 99]) {
      const d = decideOnLoad({ counter, autoDisabled: true }, THRESHOLD);
      expect(d.action).toBe("clear-auto-disable");
      expect(d.next).toEqual({ counter: 0, autoDisabled: false });
    }
  });

  it("is pure — the input state is not mutated", () => {
    const input: CrashState = { counter: 2, autoDisabled: false };
    decideOnLoad(input, THRESHOLD);
    expect(input).toEqual({ counter: 2, autoDisabled: false });
  });
});

describe("consecutive crashes still disable the plugin", () => {
  /**
   * The property that keeps a vault usable: if every launch dies before the
   * 30-second reset, the plugin must eventually take itself out. Drives the
   * real read/decide/write cycle rather than the pure function alone.
   */
  it("auto-disables on the 6th consecutive crash and not before", async () => {
    const { adapter } = fakeAdapter();
    const launch = async () => {
      const state = await readCrashState(adapter, "p");
      const d = decideOnLoad(state, THRESHOLD);
      await writeCrashState(adapter, "p", d.next);
      return d.action;
    };
    const actions: string[] = [];
    for (let i = 0; i < 6; i++) actions.push(await launch());
    expect(actions).toEqual([
      "proceed", "proceed", "proceed", "proceed", "proceed", "trip-threshold",
    ]);
    // And the next launch after tripping clears the flag rather than looping.
    expect(await launch()).toBe("clear-auto-disable");
  });

  it("a launch that survives resets the count, so healthy use never trips", async () => {
    const { adapter } = fakeAdapter();
    for (let i = 0; i < 50; i++) {
      const d = decideOnLoad(await readCrashState(adapter, "p"), THRESHOLD);
      expect(d.action).toBe("proceed");
      await writeCrashState(adapter, "p", d.next);
      // 30s stability reset.
      await writeCrashState(adapter, "p", DEFAULT_CRASH_STATE);
    }
  });
});

describe("durability ordering", () => {
  /**
   * The increment must be on disk BEFORE the risky work runs, or the guard
   * cannot observe the crash it exists to catch. This is precisely the
   * property localStorage would have broken: setItem returns before its
   * backing store flushes.
   */
  it("persists the incremented counter before the caller proceeds", async () => {
    const { adapter, ops, files } = fakeAdapter();
    const d = decideOnLoad(await readCrashState(adapter, "p"), THRESHOLD);
    await writeCrashState(adapter, "p", d.next);
    // The write has completed by the time we act on "proceed".
    expect(ops.filter((o) => o.startsWith("write")).length).toBe(1);
    expect(JSON.parse(files.get("p")!)).toEqual({ counter: 1, autoDisabled: false });
  });
});

describe("fails open", () => {
  it("treats a missing file as clean", async () => {
    const { adapter } = fakeAdapter();
    expect(await readCrashState(adapter, "p")).toEqual(DEFAULT_CRASH_STATE);
  });

  it("treats corrupt JSON as clean instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { adapter } = fakeAdapter("{ not json");
    expect(await readCrashState(adapter, "p")).toEqual(DEFAULT_CRASH_STATE);
    warn.mockRestore();
  });

  it("treats a hand-edited file with junk values as clean", async () => {
    const { adapter } = fakeAdapter(JSON.stringify({ counter: "lots", autoDisabled: "yes" }));
    // A NaN counter would break the > comparison silently.
    expect(await readCrashState(adapter, "p")).toEqual({ counter: 0, autoDisabled: false });
  });

  it("survives an adapter that throws on read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = {
      exists: async () => true,
      read: async () => { throw new Error("I/O"); },
      write: async () => {},
    };
    expect(await readCrashState(adapter, "p")).toEqual(DEFAULT_CRASH_STATE);
    warn.mockRestore();
  });

  it("survives an adapter that throws on write, reporting the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = {
      exists: async () => false,
      read: async () => "",
      write: async () => { throw new Error("read-only volume"); },
    };
    await expect(writeCrashState(adapter, "p", DEFAULT_CRASH_STATE)).resolves.toBe(false);
    warn.mockRestore();
  });
});

describe("crashStatePath", () => {
  it("uses the plugin directory when Obsidian provides one", () => {
    expect(crashStatePath({ dir: ".obsidian/plugins/cci", id: "cci" }, ".obsidian"))
      .toBe(".obsidian/plugins/cci/crash-state.json");
  });

  it("falls back to the config dir — manifest.dir is optional in the API", () => {
    const p = crashStatePath({ id: "cci" }, ".obsidian");
    expect(p).toBe(".obsidian/plugins/cci/crash-state.json");
    expect(p).not.toContain("undefined");
  });

  it("honours a non-default config dir", () => {
    expect(crashStatePath({ id: "cci" }, ".my-config")).toBe(".my-config/plugins/cci/crash-state.json");
  });
});
