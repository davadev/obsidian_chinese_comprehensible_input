import { describe, expect, it } from "vitest";
import { createQueuedDataBlobUpdater } from "../data/pluginDataUpdater";

describe("pluginDataUpdater", () => {
  it("serializes overlapping writes so namespaces do not clobber each other", async () => {
    let state: Record<string, any> = { settings: { theme: "light" }, vocab: { words: {} } };
    const update = createQueuedDataBlobUpdater(
      async () => JSON.parse(JSON.stringify(state)),
      async (blob) => {
        state = JSON.parse(JSON.stringify(blob));
      }
    );

    const first = update(async (blob) => {
      (blob as any).settings.theme = "dark";
      await Promise.resolve();
    });
    const second = update((blob) => {
      (blob as any).vocab.words["学习"] = { seenCount: 1 };
    });

    await Promise.all([first, second]);

    expect(state).toEqual({
      settings: { theme: "dark" },
      vocab: { words: { 学习: { seenCount: 1 } } },
    });
  });

  it("continues processing later writes after a failed mutation", async () => {
    let state: Record<string, any> = {};
    const update = createQueuedDataBlobUpdater(
      async () => JSON.parse(JSON.stringify(state)),
      async (blob) => {
        state = JSON.parse(JSON.stringify(blob));
      }
    );

    await expect(
      update(() => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await update((blob) => {
      (blob as any).settings = { ok: true };
    });

    expect(state).toEqual({ settings: { ok: true } });
  });
});

describe("pluginDataUpdater on a first run", () => {
  it("hands the mutation an empty blob when loadData() returns null (Obsidian does that before the first save)", async () => {
    let saved: unknown;
    const update = createQueuedDataBlobUpdater(
      async () => null as unknown as Record<string, unknown>,
      async (blob) => {
        saved = JSON.parse(JSON.stringify(blob));
      }
    );
    await update((blob) => {
      (blob as Record<string, unknown>).settings = { a: 1 };
    });
    expect(saved).toEqual({ settings: { a: 1 } });
  });
});
