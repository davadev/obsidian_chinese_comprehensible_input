/**
 * Pull the first balanced `{ … }` block out of a model reply and parse it. Tolerant of prose and markdown fences around it
 * (the prompts ask for neither, local models sometimes add them). Throws a readable Error, naming what was being asked for.
 */
export function extractJsonObject(raw: string, what: string): unknown {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error(`AI did not return a JSON object for the ${what}.`);
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch (err) {
    throw new Error(`Could not parse AI JSON: ${(err as Error).message}`);
  }
}
