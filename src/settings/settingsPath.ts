/**
 * Dotted-path access for the declarative settings tab.
 *
 * Obsidian's `SettingDefinition` addresses each control by a single flat
 * `key`, but this plugin's settings are nested (`ai.ollama.baseUrl`,
 * `customColors.hsk.3`). `CciSettingsTab` overrides `getControlValue` /
 * `setControlValue` and routes them through these two helpers.
 *
 * Kept in its own module because the settings tab itself is DOM-heavy and
 * outside the unit-test surface, while this resolution logic is pure and
 * worth testing.
 */
type JsonRecord = Record<string, unknown>;

/** Read `obj.a.b.c`. Returns undefined if any segment is missing. */
export function getByPath(obj: unknown, path: string): unknown {
  let cursor: unknown = obj;
  for (const part of path.split(".")) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as JsonRecord)[part];
  }
  return cursor;
}

/**
 * Write `obj.a.b.c = value`, creating intermediate plain objects as
 * needed. A segment that exists but is not an object is replaced — the
 * caller owns the shape, and settings are always plain JSON here.
 */
export function setByPath(obj: JsonRecord, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: JsonRecord = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cursor[parts[i]];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[parts[i]] = {};
    }
    cursor = cursor[parts[i]] as JsonRecord;
  }
  cursor[parts[parts.length - 1]] = value;
}
