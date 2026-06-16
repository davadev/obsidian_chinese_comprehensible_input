import { describe, it, expect, beforeEach } from "vitest";
import {
  clearTokenCache,
  getCachedTokens,
  hashText,
  putCachedTokens,
} from "../tokenizer/tokenCache";
import type { Token } from "../tokenizer/tokenizerTypes";

function mkToken(s: string, start = 0): Token {
  return { surface: s, start, end: start + s.length } as Token;
}

describe("tokenCache", () => {
  beforeEach(() => clearTokenCache());

  it("returns undefined before put", () => {
    expect(getCachedTokens("你好")).toBeUndefined();
  });

  it("round-trips put → get on the same text", () => {
    const toks = [mkToken("你好")];
    putCachedTokens("你好", toks);
    expect(getCachedTokens("你好")).toBe(toks);
  });

  it("distinguishes different texts by hash", () => {
    putCachedTokens("aaa", [mkToken("aaa")]);
    putCachedTokens("bbb", [mkToken("bbb")]);
    expect(getCachedTokens("aaa")?.[0].surface).toBe("aaa");
    expect(getCachedTokens("bbb")?.[0].surface).toBe("bbb");
  });

  it("evicts least-recently-inserted past capacity of 16", () => {
    for (let i = 0; i < 20; i++) {
      putCachedTokens(`text-${i}`, [mkToken(`text-${i}`)]);
    }
    // First 4 should be evicted; last 16 should remain.
    for (let i = 0; i < 4; i++) {
      expect(getCachedTokens(`text-${i}`)).toBeUndefined();
    }
    for (let i = 4; i < 20; i++) {
      expect(getCachedTokens(`text-${i}`)).toBeDefined();
    }
  });

  it("re-putting the same key bumps it to MRU position", () => {
    for (let i = 0; i < 16; i++) {
      putCachedTokens(`k${i}`, [mkToken(`k${i}`)]);
    }
    // Touch k0 — it should now be the most recent, not the oldest.
    putCachedTokens("k0", [mkToken("k0-fresh")]);
    // Insert a new key — k1 should be evicted (not k0).
    putCachedTokens("k16", [mkToken("k16")]);
    expect(getCachedTokens("k0")?.[0].surface).toBe("k0-fresh");
    expect(getCachedTokens("k1")).toBeUndefined();
    expect(getCachedTokens("k16")).toBeDefined();
  });

  it("clearTokenCache empties everything", () => {
    putCachedTokens("hello", [mkToken("hello")]);
    expect(getCachedTokens("hello")).toBeDefined();
    clearTokenCache();
    expect(getCachedTokens("hello")).toBeUndefined();
  });

  it("hashText is deterministic and not constant", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("xyz"));
    expect(hashText("")).toBe(hashText(""));
  });

  it("hashText returns a uint32-shaped value", () => {
    const h = hashText("某个测试");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});
