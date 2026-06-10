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
 * Cache key is a 32-bit FNV hash of the visible doc text. Capacity is small
 * (a handful of open notes), evicted in insertion order.
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

export function getCachedTokens(text: string): Token[] | undefined {
  return cache.get(hashText(text));
}

export function putCachedTokens(text: string, tokens: Token[]): void {
  const k = hashText(text);
  if (cache.has(k)) cache.delete(k); // move to MRU position
  cache.set(k, tokens);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearTokenCache(): void {
  cache.clear();
}
