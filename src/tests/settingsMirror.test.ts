import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { CciSettings } from "../settings/types";

/**
 * First tests this module has ever had.
 *
 * #124 — `applyEnvelope` gated on `remoteUpdatedAt <= appliedUpdatedAt`, and
 * `appliedUpdatedAt` was advanced from two different clocks: a remote device's
 * timestamp on absorb, and THIS device's `new Date()` on write. A device
 * running a few minutes fast therefore rejected a slower device's genuinely
 * newer changes, silently, and overwrote them on its next write.
 *
 * #123 — nothing cleared `conflictModalOpen` unless the resolve callback ran to
 * completion, so a dismissed (or failed) conflict left every later absorb a
 * no-op for the rest of the session.
 *
 * The conflict modal is mocked so the test holds its resolve callback and can
 * drive the outcome — dismissal, choices, or a failure part-way through.
 */

const h = vi.hoisted(() => ({
  resolvers: [] as Array<(choices: Map<string, string>) => void>,
}));

vi.mock("../ui/SettingsConflictModal", () => ({
  SettingsConflictModal: class {
    constructor(
      _app: unknown,
      _conflicts: unknown,
      onResolve: (choices: Map<string, string>) => void
    ) {
      h.resolvers.push(onResolve);
    }
    open() {
      /* the test decides if and how this one resolves */
    }
  },
}));

import { SettingsMirror } from "../settings/SettingsMirror";

const PATH = "Chinese Learning/settings.json";

function makePlugin(over: Partial<CciSettings> = {}) {
  const files = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p) || p === "Chinese Learning"),
    mkdir: vi.fn(async () => {}),
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    rename: vi.fn(async (a: string, b: string) => {
      files.set(b, files.get(a) ?? "");
      files.delete(a);
    }),
    remove: vi.fn(async (p: string) => {
      files.delete(p);
    }),
  };
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      ...over,
      sync: {
        ...DEFAULT_SETTINGS.sync,
        settingsMirrorEnabled: true,
        settingsMirrorPath: PATH,
      },
    } as CciSettings,
    app: { vault: { adapter }, setting: undefined },
    hasUserTouchedSettings: vi.fn(async () => true),
    saveSettingsSilently: vi.fn(async () => {}),
    refreshChineseViews: vi.fn(),
    refreshStatsViews: vi.fn(),
  };
  return { plugin, adapter, files };
}

const envelope = (settings: Partial<CciSettings>, updatedAt: string) =>
  JSON.stringify({ schemaVersion: 1, updatedAt, settings }, null, 2);

function make(over: Partial<CciSettings> = {}) {
  const { plugin, adapter, files } = makePlugin(over);
  const mirror = new SettingsMirror(plugin as never);
  return { mirror, plugin, adapter, files };
}

describe("SettingsMirror", () => {
  beforeEach(() => {
    h.resolvers.length = 0;
    (globalThis as unknown as { document: unknown }).document = {
      body: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } },
    };
    (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = vi.fn(
      () => ({ getPropertyValue: () => "" })
    );
  });

  describe("clock skew (#124)", () => {
    it("accepts a slower device's envelope after our own later write", async () => {
      vi.useFakeTimers();
      try {
        // Our clock reads 10:03 when we push.
        vi.setSystemTime(new Date("2026-06-15T10:03:00.000Z"));
        const { mirror, files } = make();
        await mirror.forcePushNow();

        // The other device, whose clock is correct, wrote at 10:01.
        files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:01:00.000Z"));
        const applied = await mirror.absorbExternalChange();

        expect(applied).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("accepts a THIRD device's older envelope after applying a newer one", async () => {
      // The case a remote-vs-remote comparison would still have got wrong:
      // with three devices, even two remote timestamps come from two clocks.
      const { mirror, files } = make();

      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      expect(await mirror.absorbExternalChange()).toBe(true);

      files.set(PATH, envelope({ annotationScalePercent: 80 }, "2026-06-15T10:01:00.000Z"));
      expect(await mirror.absorbExternalChange()).toBe(true);
    });

    it("still ignores the echo of our own write", async () => {
      // The hash gate is what makes removing the timestamp gate safe, so it has
      // to keep working.
      const { mirror, files, adapter } = make();
      await mirror.forcePushNow();
      const written = files.get(PATH)!;
      expect(written).toBeTruthy();
      adapter.read.mockClear();

      expect(await mirror.absorbExternalChange()).toBe(false);
    });

    it("still ignores a remote envelope it has already applied", async () => {
      const { mirror, files } = make();
      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      expect(await mirror.absorbExternalChange()).toBe(true);
      // Same bytes arrive again on the next poll tick.
      expect(await mirror.absorbExternalChange()).toBe(false);
    });

    it("forcePullNow re-applies even when we believe we are in sync", async () => {
      // The recovery path #124 asked for: there was a force PUSH and no way
      // back, so a device holding the wrong values had no way out short of
      // deleting the mirror file.
      const { mirror, files } = make();
      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      await mirror.absorbExternalChange();
      expect(await mirror.absorbExternalChange()).toBe(false);

      expect(await mirror.forcePullNow()).toBe(true);
    });
  });

  describe("conflict modal cannot wedge the mirror (#123)", () => {
    /** Local and remote both non-default and different → a genuine conflict. */
    const conflicting = () => make({ readerFontPx: 26 });

    /** The absorb reaches the modal several awaits deep (exists, read, a real
     *  SHA-256 digest, then hasUserTouchedSettings), so this waits rather than
     *  assuming a fixed number of microtasks. */
    const waitForModal = () =>
      vi.waitFor(() => {
        if (h.resolvers.length === 0) throw new Error("conflict modal not open yet");
      });

    it("opens the modal for a true conflict", async () => {
      const { mirror, files } = conflicting();
      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      void mirror.absorbExternalChange();
      await waitForModal();
      expect(h.resolvers.length).toBe(1);
    });

    it("keeps absorbing after a dismissal", async () => {
      const { mirror, files } = conflicting();
      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      const pending = mirror.absorbExternalChange();
      await waitForModal();

      // What the fixed `onClose` does: resolve with no choices at all.
      h.resolvers[0](new Map());
      await pending;

      // The whole point of #123: the next change still arrives.
      files.set(PATH, envelope({ annotationScalePercent: 80 }, "2026-06-15T10:05:00.000Z"));
      expect(await mirror.absorbExternalChange()).toBe(true);
    });

    it("keeps absorbing even when applying the choices THROWS", async () => {
      // This is what the `finally` buys: before it, `conflictModalOpen` was
      // cleared on the happy path only, so any failure part-way through left
      // settings sync dead for the session.
      const { mirror, plugin, files } = conflicting();
      files.set(PATH, envelope({ readerFontPx: 30 }, "2026-06-15T10:03:00.000Z"));
      plugin.saveSettingsSilently.mockRejectedValueOnce(new Error("disk full"));

      const pending = mirror.absorbExternalChange();
      await waitForModal();
      h.resolvers[0](new Map([["readerFontPx", "remote"]]));
      await pending;

      files.set(PATH, envelope({ annotationScalePercent: 80 }, "2026-06-15T10:05:00.000Z"));
      expect(await mirror.absorbExternalChange()).toBe(true);
    });
  });
});
