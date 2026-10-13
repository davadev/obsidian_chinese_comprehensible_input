import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  baseVersion,
  brokenScreenshotRefs,
  hasWhatsNewEntry,
  isMinorRelease,
  unindexedDocs,
} from "../../scripts/lib/docsChecks.mjs";

/**
 * The "What's new" entry and the docs index used to be prose rules only. check-release.mjs runs on import and cannot
 * be unit-tested, so the predicates live in scripts/lib/docsChecks.mjs and are pinned here, with the files as committed.
 */

const root = path.resolve(import.meta.dirname, "../..");

describe("baseVersion / isMinorRelease", () => {
  it("strips a prerelease suffix", () => {
    expect(baseVersion("0.9.1-beta.3")).toBe("0.9.1");
    expect(baseVersion("0.9.1")).toBe("0.9.1");
  });
  it("rejects anything that is not a version", () => {
    expect(baseVersion("nope")).toBeNull();
    expect(baseVersion(undefined)).toBeNull();
  });
  it("tells minor releases from patch releases", () => {
    expect(isMinorRelease("0.10.0")).toBe(true);
    expect(isMinorRelease("0.9.1")).toBe(false);
  });
});

describe("hasWhatsNewEntry", () => {
  const src = `export const RELEASE_NOTES = [\n  {\n    version: "0.9.0",\n    title: "x",\n  },\n];`;
  it("finds a matching entry", () => expect(hasWhatsNewEntry(src, "0.9.0")).toBe(true));
  it("does not match a different or longer version", () => {
    expect(hasWhatsNewEntry(src, "0.9.1")).toBe(false);
    expect(hasWhatsNewEntry(src, "0.9")).toBe(false);
    expect(hasWhatsNewEntry(src, "0.10.0")).toBe(false);
  });
  it("ignores the version mentioned in a comment", () => {
    expect(hasWhatsNewEntry(`// version: "0.9.5" later`, "0.9.5")).toBe(false);
  });
});

describe("unindexedDocs", () => {
  const index = "- [A](./a.md)\n- [B](./b.md#section)\n";
  it("lists pages the index does not link", () => {
    expect(unindexedDocs(["index.md", "a.md", "b.md", "c.md"], index)).toEqual(["c.md"]);
  });
  it("exempts the index itself, draft release notes and non-markdown files", () => {
    expect(unindexedDocs(["index.md", "release-notes-0.9.0.md", "x.png"], index)).toEqual([]);
  });
  it("does not treat a prefix as a link", () => {
    expect(unindexedDocs(["a.md"], "[x](./aa.md)")).toEqual(["a.md"]);
  });
});

describe("brokenScreenshotRefs", () => {
  it("reports references to images that do not exist", () => {
    const sources = { "README.md": "![](resources/screenshots/a.png) ![](resources/screenshots/gone.png)" };
    expect(brokenScreenshotRefs(sources, ["a.png"])).toEqual(["README.md: gone.png"]);
  });
  it("is quiet when everything exists", () => {
    expect(brokenScreenshotRefs({ "docs/x.md": "resources/screenshots/a.svg" }, ["a.svg"])).toEqual([]);
  });
});

describe("the repository as committed", () => {
  it("has an index entry for every docs page", () => {
    const docs = readdirSync(path.join(root, "docs"));
    const index = readFileSync(path.join(root, "docs/index.md"), "utf8");
    expect(unindexedDocs(docs, index)).toEqual([]);
  });
  it("only references screenshots that exist", () => {
    const docs = readdirSync(path.join(root, "docs")).filter((n) => n.endsWith(".md"));
    const sources: Record<string, string> = { "README.md": readFileSync(path.join(root, "README.md"), "utf8") };
    for (const n of docs) sources[`docs/${n}`] = readFileSync(path.join(root, "docs", n), "utf8");
    expect(brokenScreenshotRefs(sources, readdirSync(path.join(root, "resources/screenshots")))).toEqual([]);
  });
});
