/**
 * Pure object helpers used by SettingsMirror's per-key conflict resolution.
 * Extracted so they can be unit-tested in isolation and reused by other
 * settings-side code (export/import, etc.) without pulling in the mirror's
 * write/absorb plumbing.
 */

/** Walk an object and produce a flat record keyed by dot-joined leaf paths.
 *  Arrays are treated as leaves (not flattened further) so order survives.
 *  Primitives at the top level use the given `prefix` as their key; if
 *  `prefix` is empty, primitives are dropped. */
export function flatten(
  obj: unknown,
  prefix = "",
  out: Record<string, unknown> = {}
): Record<string, unknown> {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const k of Object.keys(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    flatten((obj as Record<string, unknown>)[k], next, out);
  }
  return out;
}

/** Inverse of `flatten`. Reconstructs nested object from dot-joined keys. */
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(flat)) {
    const parts = k.split(".");
    let cursor: Record<string, unknown> = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cursor[p] || typeof cursor[p] !== "object") cursor[p] = {};
      cursor = cursor[p] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = flat[k];
  }
  return out;
}

/** Structural equality. Handles primitives, arrays (order-sensitive),
 *  and plain objects. Doesn't try to be clever about Date / Map / Set. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
