import { describe, expect, it } from "vitest";
import { StatsView } from "../ui/StatsView";

/**
 * `invalidateCaches()` is called on a script switch, and it empties
 * `noteSurfaces`. But `noteScope` survives, and `scopedRecords()` only
 * filters while `noteSurfaces` is non-empty — so clearing without
 * re-deriving silently turns a note-scoped Words tab into the whole
 * vocabulary, with the scope selector still naming the note.
 *
 * Driven against the prototype rather than a constructed view: StatsView is
 * an ItemView and building one needs a real WorkspaceLeaf and container
 * element, which is exactly the Obsidian runtime surface these tests stay
 * out of. The behaviour under test is entirely in this one method.
 */
type ScopeInternals = {
  triageContextCache: Map<string, string>;
  noteSurfaces: Set<string>;
  noteScope: string;
  setScope(path: string): Promise<void>;
  invalidateCaches(): void;
};

function harness(noteScope: string) {
  const view = Object.create(StatsView.prototype) as ScopeInternals;
  const rescoped: string[] = [];
  view.triageContextCache = new Map([["学习", "{}"]]);
  view.noteSurfaces = new Set(["学习", "天气"]);
  view.noteScope = noteScope;
  view.setScope = (path: string) => {
    rescoped.push(path);
    return Promise.resolve();
  };
  return { view, rescoped };
}

describe("StatsView.invalidateCaches", () => {
  it("re-derives the note scope instead of leaving it empty", () => {
    const { view, rescoped } = harness("Notes/台灣.md");
    view.invalidateCaches();
    expect(rescoped).toEqual(["Notes/台灣.md"]);
  });

  it("does not re-scope when the view is showing the whole vault", () => {
    const { view, rescoped } = harness("");
    view.invalidateCaches();
    expect(rescoped).toEqual([]);
  });

  it("still drops the caches it is there to drop", () => {
    const { view } = harness("Notes/台灣.md");
    view.invalidateCaches();
    expect(view.triageContextCache.size).toBe(0);
    // setScope() is what repopulates this; the stub above does not, so an
    // empty set here is the pre-rescope state, not the final one.
    expect(view.noteSurfaces.size).toBe(0);
  });
});
