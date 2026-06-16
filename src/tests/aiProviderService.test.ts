import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderService } from "../ai/AiProviderService";

function service(onUsage?: (entry: any) => void) {
  return new AiProviderService(() => ({ debug: false } as any), null, () => "", onUsage ?? null);
}

describe("AiProviderService streaming", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).fetch;
  });

  it("aborts desktop streaming requests when timeout elapses", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          (err as Error & { name?: string }).name = "AbortError";
          reject(err);
        });
      })
    );
    (globalThis as any).fetch = fetch;

    const promise = (service() as any).chatJsonStream(
      "https://example.com/v1/chat/completions",
      { stream: true },
      { timeoutMs: 1000, apiKey: "" },
      "openai"
    );
    const rejected = expect(promise).rejects.toThrow("AI request timed out after 1s");

    await vi.advanceTimersByTimeAsync(1000);

    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses streamed content and forwards usage chunks", async () => {
    const encoder = new TextEncoder();
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n'),
      })
      .mockResolvedValueOnce({
        done: false,
        value: encoder.encode('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n'),
      })
      .mockResolvedValueOnce({
        done: false,
        value: encoder.encode("data: [DONE]\n\n"),
      })
      .mockResolvedValueOnce({ done: true, value: undefined });
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "text/event-stream" },
      body: { getReader: () => ({ read }) },
    }));
    const onUsage = vi.fn();

    const out = await (service(onUsage) as any).chatJsonStream(
      "https://example.com/v1/chat/completions",
      { stream: true },
      { timeoutMs: 1000, apiKey: "" },
      "openai"
    );

    expect(out).toBe("你好");
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", inputTokens: 10, cachedInputTokens: 0, outputTokens: 4 })
    );
  });
});
