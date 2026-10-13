// Pure predicates behind check-release's "docs and What's new" gates.
// Kept free of I/O so src/tests/docsChecks.test.ts can exercise them; check-release.mjs runs on import.

/** `0.9.1-beta.3` -> `0.9.1`; `0.9.1` -> `0.9.1`; anything else -> null. */
export function baseVersion(version) {
  const m = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(version ?? ""));
  return m ? m[1] : null;
}

/** A minor (`X.Y.0`) release is expected to change something a user sees; patch releases often do not. */
export const isMinorRelease = (base) => /^\d+\.\d+\.0$/.test(base);

/** Does `releaseNotes.ts` carry an entry for `base`? Matches the `version: "X.Y.Z"` field of a RELEASE_NOTES entry. */
export function hasWhatsNewEntry(releaseNotesSource, base) {
  const escaped = base.replace(/\./g, "\\.");
  return new RegExp(`^\\s*version:\\s*"${escaped}"`, "m").test(releaseNotesSource);
}

/** docs/*.md pages (file names) that `docs/index.md` never links to. Draft release notes are exempt. */
export function unindexedDocs(docFiles, indexText) {
  return docFiles
    .filter((f) => f.endsWith(".md") && f !== "index.md" && !/^release-notes-/.test(f))
    .filter((f) => !new RegExp(`\\]\\(\\./${f.replace(/\./g, "\\.")}(?:#[^)]*)?\\)`).test(indexText));
}

/**
 * Image paths (relative to the repo root) that README.md/docs reference under resources/screenshots/ but that are not in
 * `existing`. `sources` maps a markdown file name to its text.
 */
export function brokenScreenshotRefs(sources, existing) {
  const have = new Set(existing);
  const broken = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(/resources\/screenshots\/([A-Za-z0-9._-]+\.(?:png|svg|jpg|gif))/g)) {
      if (!have.has(m[1])) broken.push(`${file}: ${m[1]}`);
    }
  }
  return broken;
}
