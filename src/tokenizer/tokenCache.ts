import { Token } from "./tokenizerTypes";

/**
 * Module-level LRU token cache shared across editor instances.
 *
 * Why this exists: the Chinese decoration ViewPlugin used to start an async
 * tokenize from its constructor, leaving the first paint without
 * decorations until the dispatch landed. With a process-wide cache,
 * `ChineseTextFileView.onOpen()` can `await` the tokenize *before* the
 * editor is created — and the ViewPlugin constructor finds the tokens
 * synchronously in this map, so first paint already carries decorations.
 *
 * Cache key is a 32-bit FNV hash of the visible doc text — the text itself is
 * not stored, so a hash collision would hand back another document's tokens.
 * With a 16-entry cap the odds are around 3e-8, which is not worth an extra
 * full-text comparison on every lookup, but it is a real (if remote) failure
 * mode rather than an impossible one.
 *
 * Eviction is insertion-order (FIFO), NOT least-recently-used: `get` does not
 * promote an entry. A note reopened repeatedly can therefore be evicted ahead
 * of one opened once. Harmless at this size — a miss just re-tokenizes — but
 * do not read the capacity comment as an LRU guarantee.
 */

const MAX_ENTRIES = 16;

const cache = new Map<number, Token[]>();

export function hashText(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Hands back the LIVE cache entry, not a copy. `chineseDecorations` assigns it
 * straight to `this.lastTokens`, so the same array is shared by every editor
 * instance holding that document; mutating it would corrupt the cache for all
 * of them. Nothing does today, and all readers treat it as read-only.
 *
 * Typing the return `readonly Token[]` would enforce that, but the constraint
 * propagates through `TokenizerService.tokenize()` into every consumer, so it
 * belongs in a change of its own rather than riding along with a bug fix.
 */
export function getCachedTokens(text: string): Token[] | undefined {
  return cache.get(hashText(text));
}

export function putCachedTokens(text: string, tokens: Token[]): void {
  const k = hashText(text);
  if (cache.has(k)) cache.delete(k); // re-insert so this entry evicts last
  cache.set(k, tokens);
  while (cache.size > MAX_ENTRIES) {
    const next = cache.keys().next();
    if (next.done) break;
    const oldest: number = next.value;
    cache.delete(oldest);
  }
}

export function clearTokenCache(): void {
  cache.clear();
}
