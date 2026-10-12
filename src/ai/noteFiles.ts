import { App } from "obsidian";

/** Strip filesystem-illegal characters from a string so it can be used
 *  inside a vault filename. Caps length to keep results sensible. */
export function sanitizeForFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      try {
        await app.vault.createFolder(cur);
      } catch {
        // ignore concurrent-create races
      }
    }
  }
}
