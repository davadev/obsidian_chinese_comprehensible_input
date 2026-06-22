import { describe, expect, it, vi } from "vitest";
import { openHref } from "../editor/markdownRendering";

describe("markdownRendering openHref", () => {
  it("opens external links in a new tab", () => {
    const open = vi.fn();
    (globalThis as any).window = { open };

    openHref({ isInteractiveMode: () => false } as any, "https://example.com");

    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("opens markdown vault links in the Chinese view", async () => {
    const file = { extension: "md", path: "note.md" };
    const openFileInChineseView = vi.fn(async () => {});
    const openLinkText = vi.fn(async () => {});
    const plugin = {
      isInteractiveMode: () => false,
      openFileInChineseView,
      app: {
        workspace: {
          getActiveFile: () => ({ path: "current.md" }),
          openLinkText,
        },
        metadataCache: {
          getFirstLinkpathDest: vi.fn(() => file),
        },
      },
    } as any;

    openHref(plugin, "note");
    await Promise.resolve();

    expect(openFileInChineseView).toHaveBeenCalledWith(file);
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("does not navigate while an interactive mode is active", () => {
    const open = vi.fn();
    (globalThis as any).window = { open };
    const openFileInChineseView = vi.fn(async () => {});

    openHref({ isInteractiveMode: () => true, openFileInChineseView } as any, "https://example.com");

    expect(open).not.toHaveBeenCalled();
    expect(openFileInChineseView).not.toHaveBeenCalled();
  });
});
