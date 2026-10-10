/**
 * What may be used as the path of a sync mirror file.
 *
 * Why this is checked at all: the path box in Settings used to save on every keystroke, and every save wrote the whole
 * mirror to whatever the box held at that moment. Typing or pasting a path therefore created a file or folder for each
 * intermediate string (`vocabulary.`, `vocabulary.json nowledgebase/Languages/`) in the user's vault, each one a
 * multi-megabyte write that a sync tool then tried to upload. A path is only used once it is a plausible `.json` file.
 *
 * Returns `null` when the path is fine, otherwise a sentence saying what is wrong.
 */
export function mirrorPathProblem(raw: string): string | null {
  const p = raw.trim();
  if (!p) return "The path is empty.";
  if (p.startsWith("/") || p.includes("\\")) return "Use a path inside the vault, with forward slashes and no leading slash.";
  if (/[:*?"<>|]/.test(p)) return 'A file name cannot contain any of : * ? " < > |';
  const parts = p.split("/");
  if (parts.some((s) => s === "")) return "The path has an empty folder name (a doubled or trailing slash).";
  if (parts.some((s) => s === "." || s === "..")) return 'The path cannot contain "." or ".." segments.';
  if (parts.some((s) => /[. ]$/.test(s))) return "A folder or file name cannot end with a dot or a space.";
  const name = parts[parts.length - 1];
  if (!/\.json$/i.test(name) || name.length <= 5) return "The file name must end in .json (for example Chinese Learning/vocabulary.json).";
  return null;
}
