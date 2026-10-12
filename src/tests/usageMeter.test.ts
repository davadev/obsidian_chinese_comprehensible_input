import { describe, expect, it } from "vitest";
import { UsageMeter, formatSpent } from "../ui/usageMeter";

/** What a job cost on OpenAI, added up from the token usage of the requests it made. */

function plugin() {
  const listeners = new Set<(e: any) => void>();
  return {
    listeners,
    onAiUsage: (cb: (e: any) => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    emit: (e: object) => listeners.forEach((l) => l(e)),
  };
}
const luna = (inputTokens: number, outputTokens: number, provider = "openai") => ({
  ts: 1,
  provider,
  model: "gpt-6-luna",
  inputTokens,
  cachedInputTokens: 0,
  outputTokens,
});

describe("formatSpent", () => {
  it("shows thousandths of a dollar, and cents once it is worth it", () => {
    expect(formatSpent(0.0123456)).toBe("$0.0123");
    expect(formatSpent(0.00004)).toBe("$0.0000");
    expect(formatSpent(0.1)).toBe("$0.10");
    expect(formatSpent(2.349)).toBe("$2.35");
  });
});

describe("UsageMeter", () => {
  it("adds up OpenAI requests at each model's own price, and says nothing before any request", () => {
    const p = plugin();
    const m = new UsageMeter(p as any);
    m.start();
    expect(m.line()).toBeNull();
    p.emit(luna(1000, 2000));
    expect(m.line()).toBe("Cost on OpenAI: $0.0011 (1 request).");
    p.emit(luna(1000, 2000));
    p.emit({ ...luna(1000, 2000), model: "gpt-5.4-mini" });
    expect(m.requests).toBe(3);
    expect(m.usd).toBeCloseTo(0.01195, 6);
    expect(m.line()).toMatch(/^Cost on OpenAI: \$0\.01(19|20) \(3 requests\)\.$/);
  });

  it("ignores a local model, and stops counting when stopped", () => {
    const p = plugin();
    const m = new UsageMeter(p as any);
    m.start();
    p.emit(luna(1000, 2000, "ollama"));
    expect(m.line()).toBeNull();
    m.stop();
    expect(p.listeners.size).toBe(0);
    p.emit(luna(1000, 2000));
    expect(m.requests).toBe(0);
    m.stop();
  });

  it("starting twice does not count a request twice", () => {
    const p = plugin();
    const m = new UsageMeter(p as any);
    m.start();
    m.start();
    expect(p.listeners.size).toBe(1);
    p.emit(luna(1000, 2000));
    expect(m.requests).toBe(1);
  });
});
