import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { Notice } from "./__mocks__/obsidian"; // the stub itself: `Notice.instances` is not in the real typings
import { AiProviderService } from "../ai/AiProviderService";
import { OPENAI_BASE_URL, OPENAI_MODEL_ID } from "../ai/openaiProfile";

/**
 * The provider layer between the plugin and whatever model answers: request shape per endpoint mode and provider,
 * every way the answer can be shaped, every way it can fail (and what the person is told), streaming on desktop
 * (fetch) and on mobile (requestUrl), usage reporting, the timeouts, and the debug log. A scripted fetch / requestUrl
 * stands in for the network.
 */

const h = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", async (orig) => ({ ...(await orig<typeof import("obsidian")>()), requestUrl: h.requestUrl }));

const SCHEMA = { type: "object", properties: { x: { type: "string" } } };
const enc = new TextEncoder();

const baseCfg = (over: Record<string, unknown> = {}) => ({
  baseUrl: "http://host:11434/v1",
  apiKey: "",
  chatModel: "qwen",
  embeddingModel: "",
  endpointMode: "chat",
  temperature: 0.3,
  maxOutputTokens: 1000,
  timeoutMs: 5000,
  maxRepairIterations: 2,
  responseFormat: "json_object",
  suppressThinking: false,
  stream: false,
  ...over,
});

interface Setup {
  provider?: "ollama" | "openai";
  enabled?: boolean;
  debug?: boolean;
  ollama?: Record<string, unknown>;
  key?: string;
  folder?: string;
}

function make(o: Setup = {}) {
  const files = new Map<string, string>();
  const adapter = {
    exists: vi.fn(async (p: string) => files.has(p)),
    write: vi.fn(async (p: string, t: string) => void files.set(p, t)),
  };
  const app: any = {
    loadLocalStorage: vi.fn(() => o.key ?? ""),
    vault: { adapter, createFolder: vi.fn(async () => {}) },
  };
  const settings: any = { enabled: o.enabled ?? true, debug: o.debug ?? false, provider: o.provider ?? "ollama", ollama: baseCfg(o.ollama) };
  const usage: any[] = [];
  const svc = new AiProviderService(() => settings, app, () => o.folder ?? "", (e) => void usage.push(e));
  return { svc, app, adapter, files, settings, usage };
}

/** A fetch Response for the buffered paths. */
const buffered = (text: string, status = 200) => ({ status, text: async () => text });
/** A fetch Response whose body streams the given chunks. */
function streaming(chunks: string[], over: Record<string, unknown> = {}) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "text/event-stream" },
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }) }) },
    ...over,
  };
}
const sse = (delta: string, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta }, ...extra }] })}\n`;
const ndjson = (o: unknown) => JSON.stringify(o) + "\n";
const chatEnvelope = (content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ choices: [{ message: { content }, ...extra }] });

const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
const sentBody = (call = 0) => JSON.parse(fetchMock().mock.calls[call][1].body);
const sentUrl = (call = 0) => fetchMock().mock.calls[call][0] as string;
const chat = (svc: AiProviderService) => svc.chatJson("SYS", "USER", "Story", SCHEMA);

beforeEach(() => {
  (globalThis as any).fetch = vi.fn(async () => buffered(chatEnvelope("hello")));
  h.requestUrl.mockReset();
  Notice.instances.length = 0;
  Platform.isMobile = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as any).fetch;
  Platform.isMobile = false;
});

describe("which provider is active", () => {
  it("OpenAI uses the built-in profile with the device's key", () => {
    const { svc, app } = make({ provider: "openai", key: "sk-1" });
    const { active, provider } = svc.resolveActive();
    expect(provider).toBe("openai");
    expect(active).toMatchObject({ baseUrl: OPENAI_BASE_URL, chatModel: OPENAI_MODEL_ID, apiKey: "sk-1" });
    expect(app.loadLocalStorage).toHaveBeenCalledWith("cci-ai-apikey-openai");
  });

  it("Ollama uses the saved config with the device's key", () => {
    const { active, provider } = make({ key: "k2", ollama: { chatModel: "llama" } }).svc.resolveActive();
    expect(provider).toBe("ollama");
    expect(active).toMatchObject({ chatModel: "llama", apiKey: "k2" });
  });

  it("a device with no stored key sends none", () => {
    expect(make().svc.resolveActive().active.apiKey).toBe("");
  });
});

describe("testConnection", () => {
  it.each([[200, true], [404, true], [499, true], [500, false], [199, false]])("HTTP %i means %s", async (status, ok) => {
    fetchMock().mockResolvedValue(buffered("", status));
    expect(await make().svc.testConnection()).toBe(ok);
  });

  it("asks the models endpoint with GET, sending the key only when there is one", async () => {
    await make({ ollama: { baseUrl: "http://h/v1/" } }).svc.testConnection();
    expect(sentUrl()).toBe("http://h/v1/models");
    expect(fetchMock().mock.calls[0][1]).toMatchObject({ method: "GET", headers: {} });
    await make({ key: "abc" }).svc.testConnection();
    expect(fetchMock().mock.calls[1][1].headers).toEqual({ Authorization: "Bearer abc" });
  });
});

describe("the request that is sent", () => {
  it("refuses when AI is switched off", async () => {
    await expect(chat(make({ enabled: false }).svc)).rejects.toThrow("AI is disabled in settings.");
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("chat endpoint on a local server: classic max_tokens, JSON mode, temperature, both messages", async () => {
    await chat(make().svc);
    expect(sentUrl()).toBe("http://host:11434/v1/chat/completions");
    expect(sentBody()).toEqual({
      model: "qwen",
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });
    expect(fetchMock().mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("OpenAI proper asks for max_completion_tokens and usage in the stream", async () => {
    fetchMock().mockResolvedValue(streaming([sse("ok"), "data: [DONE]\n"]));
    await chat(make({ provider: "openai", key: "sk" }).svc);
    const body = sentBody();
    expect(body).toMatchObject({ max_completion_tokens: 8000, stream: true, stream_options: { include_usage: true } });
    expect(body.max_tokens).toBeUndefined();
    expect(fetchMock().mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk" });
  });

  it("a streaming local server gets stream: true but no usage option", async () => {
    fetchMock().mockResolvedValue(streaming([sse("ok"), "data: [DONE]\n"]));
    await chat(make({ ollama: { stream: true } }).svc);
    expect(sentBody()).toMatchObject({ stream: true });
    expect(sentBody().stream_options).toBeUndefined();
  });

  it.each([
    ["json_object", { type: "json_object" }],
    ["json_schema", { type: "json_schema", json_schema: { name: "Story", schema: SCHEMA, strict: true } }],
  ])("response format %s", async (mode, expected) => {
    await chat(make({ ollama: { responseFormat: mode } }).svc);
    expect(sentBody().response_format).toEqual(expected);
  });

  it("response format none sends none", async () => {
    await chat(make({ ollama: { responseFormat: "none" } }).svc);
    expect(sentBody()).not.toHaveProperty("response_format");
  });

  it("appends /no_think to the system prompt when thinking is suppressed", async () => {
    await chat(make({ ollama: { suppressThinking: true } }).svc);
    expect(sentBody().messages[0].content).toBe("SYS\n/no_think");
  });

  it("Responses API: input, max_output_tokens and response_format", async () => {
    fetchMock().mockResolvedValue(buffered(JSON.stringify({ output_text: "hi" })));
    await chat(make({ ollama: { endpointMode: "responses" } }).svc);
    expect(sentUrl()).toBe("http://host:11434/v1/responses");
    expect(sentBody()).toEqual({
      model: "qwen",
      input: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
      temperature: 0.3,
      max_output_tokens: 1000,
      response_format: { type: "json_object" },
    });
    await chat(make({ ollama: { endpointMode: "responses", responseFormat: "none" } }).svc);
    expect(sentBody(1)).not.toHaveProperty("response_format");
  });

  it("Ollama native: bare host (a pasted /v1 is dropped), options, format json, think off when suppressed", async () => {
    fetchMock().mockResolvedValue(buffered(JSON.stringify({ message: { content: "hi" } })));
    await chat(make({ ollama: { endpointMode: "ollama", baseUrl: "http://host:11434/v1/", suppressThinking: true } }).svc);
    expect(sentUrl()).toBe("http://host:11434/api/chat");
    expect(sentBody()).toMatchObject({ model: "qwen", options: { temperature: 0.3, num_predict: 1000 }, format: "json" });
    expect(sentBody().think).toBe(false);
    await chat(make({ ollama: { endpointMode: "ollama", baseUrl: "http://host:11434", responseFormat: "none" } }).svc);
    expect(sentUrl(1)).toBe("http://host:11434/api/chat");
    expect(sentBody(1)).not.toHaveProperty("format");
    expect(sentBody(1).think).toBeUndefined();
  });

  it("Ollama native in streaming mode asks for no usage option", async () => {
    fetchMock().mockResolvedValue(streaming([ndjson({ message: { content: "x" } }), ndjson({ done: true })]));
    await chat(make({ ollama: { endpointMode: "ollama", stream: true } }).svc);
    expect(sentBody().stream).toBe(true);
    expect(sentBody().stream_options).toBeUndefined();
  });
});

describe("reading a buffered answer", () => {
  const answer = async (env: unknown) => {
    fetchMock().mockResolvedValue(buffered(typeof env === "string" ? env : JSON.stringify(env)));
    return chat(make().svc);
  };

  it("takes the text from every envelope shape providers use", async () => {
    expect(await answer({ choices: [{ message: { content: "a" } }] })).toBe("a");
    expect(await answer({ choices: [{ message: { content: ["x", { text: "y" }, { nope: 1 }, null] } }] })).toBe("xy");
    expect(await answer({ choices: [{ message: { content: [] }, text: "legacy" }] })).toBe("legacy");
    expect(await answer({ output_text: "resp" })).toBe("resp");
    expect(await answer({ output: [{ content: ["p", { text: "q" }, { z: 1 }] }, { content: "r" }, { content: 5 }, null] })).toBe("pqr");
    expect(await answer({ message: { content: "ollama" } })).toBe("ollama");
    expect(await answer({ response: "generate" })).toBe("generate");
    expect(await answer({ text: "plain" })).toBe("plain");
  });

  it("an Responses answer with empty parts falls through to the other fields", async () => {
    expect(await answer({ output: [{ content: [] }], text: "fallback" })).toBe("fallback");
  });

  it("an empty completion explains why: token limit, reasoning only, or unknown", async () => {
    await expect(answer({ choices: [{ message: { content: "" }, finish_reason: "length" }] })).rejects.toThrow("Hit the max-tokens limit");
    await expect(answer({ choices: [{ message: { content: "", reasoning: "thinking..." } }] })).rejects.toThrow("emitted 11 chars of reasoning but no answer");
    await expect(answer({ choices: [{ message: { content: "  ", reasoning: 5 } }] })).rejects.toThrow("Check the model log for errors.");
    await expect(answer({})).rejects.toThrow("returned an empty completion");
  });

  it("mobile: a response without text is an empty body", async () => {
    Platform.isMobile = true;
    h.requestUrl.mockResolvedValue({ status: 200 });
    await expect(chat(make().svc)).rejects.toThrow("returned an empty body");
  });

  it("HTTP errors carry the status and the start of the body", async () => {
    fetchMock().mockResolvedValue(buffered("x".repeat(400), 500));
    await expect(chat(make().svc)).rejects.toThrow(`AI provider HTTP 500: ${"x".repeat(300)}`);
    fetchMock().mockResolvedValue(buffered("", 401));
    await expect(chat(make().svc)).rejects.toThrow("AI provider HTTP 401: (empty body)");
  });

  it("an empty body, or one that is not JSON, is reported as such", async () => {
    await expect(answer("  ")).rejects.toThrow("returned an empty body");
    await expect(answer("<html>nope</html>")).rejects.toThrow("non-JSON envelope");
  });

  it("a timeout is explained with the way to fix it on iOS; other errors pass through", async () => {
    fetchMock().mockRejectedValue(new Error("The request timed out."));
    await expect(chat(make().svc)).rejects.toThrow('Enable "Stream responses (SSE)"');
    fetchMock().mockRejectedValue(new Error("connection refused"));
    await expect(chat(make().svc)).rejects.toThrow(/^connection refused$/);
    fetchMock().mockRejectedValue("a string");
    await expect(chat(make().svc)).rejects.toThrow("a string");
    fetchMock().mockRejectedValue({});
    await expect(chat(make().svc)).rejects.toThrow("[object Object]");
  });
});

describe("usage", () => {
  it("is reported from an OpenAI-shaped answer, cached tokens counted apart", async () => {
    fetchMock().mockResolvedValue(buffered(chatEnvelope("ok", {}).replace("}]}", '}],"usage":{"prompt_tokens":100,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":40}}}')));
    const { svc, usage } = make();
    await chat(svc);
    expect(usage).toEqual([expect.objectContaining({ provider: "ollama", inputTokens: 60, cachedInputTokens: 40, outputTokens: 7 })]);
    expect(typeof usage[0].ts).toBe("number");
  });

  it("is reported from Ollama's counts", async () => {
    fetchMock().mockResolvedValue(buffered(JSON.stringify({ message: { content: "ok" }, prompt_eval_count: 12, eval_count: 5 })));
    const { svc, usage } = make();
    await chat(svc);
    expect(usage).toEqual([expect.objectContaining({ inputTokens: 12, cachedInputTokens: 0, outputTokens: 5 })]);
  });

  it("is not reported when there are no counts or they are not numbers", async () => {
    const empty = make();
    fetchMock().mockResolvedValue(buffered(JSON.stringify({ message: { content: "ok" }, usage: { prompt_tokens: "x" }, prompt_eval_count: NaN })));
    await chat(empty.svc);
    fetchMock().mockResolvedValue(buffered(JSON.stringify({ message: { content: "ok" }, usage: "weird" })));
    await chat(empty.svc);
    expect(empty.usage).toEqual([]);
  });
});

describe("timeouts on the buffered path", () => {
  it("desktop: aborts at the configured time with a message that says how to raise it", async () => {
    vi.useFakeTimers();
    fetchMock().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const p = expect(chat(make({ ollama: { timeoutMs: 2000 } }).svc)).rejects.toThrow("AI request timed out after 2s");
    await vi.advanceTimersByTimeAsync(2000);
    await p;
  });

  it("desktop: no timeout configured means no abort timer, and a missing time reads as 0 s", async () => {
    await expect(chat(make({ ollama: { timeoutMs: 0 } }).svc)).resolves.toBe("hello");
    fetchMock().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(chat(make({ ollama: { timeoutMs: 0 } }).svc)).rejects.toThrow("timed out after 0s");
  });

  it("mobile: goes through requestUrl and races a timer", async () => {
    Platform.isMobile = true;
    h.requestUrl.mockResolvedValue({ status: 200, text: chatEnvelope("mob") });
    expect(await chat(make().svc)).toBe("mob");
    expect(h.requestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: "http://host:11434/v1/chat/completions", method: "POST", throw: false }));
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("mobile: a slow request is cut off by the timer", async () => {
    vi.useFakeTimers();
    Platform.isMobile = true;
    h.requestUrl.mockReturnValue(new Promise(() => {}));
    const p = expect(chat(make({ ollama: { timeoutMs: 3000 } }).svc)).rejects.toThrow("AI request timed out after 3s");
    await vi.advanceTimersByTimeAsync(3000);
    await p;
  });

  it("mobile: with no timeout configured the request is simply awaited", async () => {
    Platform.isMobile = true;
    h.requestUrl.mockResolvedValue({ status: 200, text: chatEnvelope("mob") });
    expect(await chat(make({ ollama: { timeoutMs: 0 } }).svc)).toBe("mob");
  });
});

describe("streaming on desktop (OpenAI-style SSE)", () => {
  const stream = (chunks: string[], o: Setup = {}, over: Record<string, unknown> = {}) => {
    fetchMock().mockResolvedValue(streaming(chunks, over));
    return make({ ...o, ollama: { stream: true, ...o.ollama } });
  };

  it("joins the deltas and stops at [DONE]", async () => {
    const { svc } = stream([sse("你"), sse("好"), "data: [DONE]\n", sse("ignored")]);
    expect(await chat(svc)).toBe("你好");
  });

  it("copes with lines split across chunks, blank and comment lines, and malformed JSON", async () => {
    const { svc } = stream([': keep-alive\n\ndata: {"choices":[{"delta":{"con', 'tent":"a"}}]}\ndata: {oops}\nevent: x\n', sse("b")]);
    expect(await chat(svc)).toBe("ab");
  });

  it("a stream that ends without [DONE] still returns what it got", async () => {
    expect(await chat(stream([sse("x", { finish_reason: "stop" })]).svc)).toBe("x");
  });

  it("an empty stream explains: token limit versus unknown", async () => {
    await expect(chat(stream([sse("", { finish_reason: "length" })]).svc)).rejects.toThrow("Hit the max-tokens limit");
    await expect(chat(stream([]).svc)).rejects.toThrow("Check the model log for errors.");
    await expect(chat(stream(["data: {}\n"]).svc)).rejects.toThrow("empty streamed completion");
  });

  it("reports usage from the stream", async () => {
    const { svc, usage } = stream([sse("a"), `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n`, "data: [DONE]\n"]);
    await chat(svc);
    expect(usage).toEqual([expect.objectContaining({ inputTokens: 3, outputTokens: 2 })]);
  });

  it("a non-2xx response carries the status and body, even when the body cannot be read", async () => {
    await expect(chat(stream([], {}, { ok: false, status: 429, statusText: "Too Many", text: async () => "slow down" }).svc)).rejects.toThrow("AI provider HTTP 429: slow down");
    await expect(chat(stream([], {}, { ok: false, status: 502, statusText: "Bad", text: async () => { throw new Error("x"); } }).svc)).rejects.toThrow("AI provider HTTP 502: (empty body)");
  });

  it("a response without a readable body is reported", async () => {
    await expect(chat(stream([], {}, { body: null }).svc)).rejects.toThrow("Streaming response has no body reader.");
  });

  it("a response with no content-type header still logs and works", async () => {
    expect(await chat(stream([sse("a"), "data: [DONE]\n"], {}, { headers: { get: () => null } }).svc)).toBe("a");
  });

  it("aborts at the timeout and says so; with no timeout nothing is armed", async () => {
    vi.useFakeTimers();
    fetchMock().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))));
    const p = expect(chat(make({ ollama: { stream: true, timeoutMs: 1500 } }).svc)).rejects.toThrow("AI request timed out after 2s");
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    fetchMock().mockResolvedValue(streaming([sse("z"), "data: [DONE]\n"]));
    await expect(chat(make({ ollama: { stream: true, timeoutMs: 0 } }).svc)).resolves.toBe("z");
  });

  it("other failures pass through unchanged", async () => {
    fetchMock().mockRejectedValue(new Error("Load failed"));
    await expect(chat(make({ ollama: { stream: true } }).svc)).rejects.toThrow("Load failed");
    fetchMock().mockRejectedValue(undefined);
    await expect(chat(make({ ollama: { stream: true } }).svc)).rejects.toBeUndefined();
  });

  it("long streams log their progress every ten chunks", async () => {
    const chunks = Array.from({ length: 12 }, (_, i) => sse(String(i % 10)));
    expect((await chat(stream([...chunks, "data: [DONE]\n"], { debug: true }).svc)).length).toBe(12);
  });
});

describe("streaming Ollama on desktop (NDJSON)", () => {
  const stream = (chunks: string[], o: Setup = {}, over: Record<string, unknown> = {}) => {
    fetchMock().mockResolvedValue(streaming(chunks, over));
    return make({ ...o, ollama: { stream: true, endpointMode: "ollama", ...o.ollama } });
  };

  it("joins the pieces, reports usage from the done line and stops there", async () => {
    const { svc, usage } = stream([ndjson({ message: { content: "你" } }), ndjson({ message: { content: "好" } }), ndjson({ done: true, prompt_eval_count: 4, eval_count: 2 }), ndjson({ message: { content: "late" } })]);
    expect(await chat(svc)).toBe("你好");
    expect(usage).toEqual([expect.objectContaining({ inputTokens: 4, outputTokens: 2 })]);
  });

  it("splits lines across chunks and skips blank and malformed ones; non-string pieces are ignored", async () => {
    const { svc } = stream(['{"message":{"cont', 'ent":"a"}}\n\n{bad}\n', ndjson({ message: { content: 5 } }), ndjson({ message: { content: "b" } })]);
    expect(await chat(svc)).toBe("ab");
  });

  it("a stream that ends without done returns the content; an empty one is an error", async () => {
    expect(await chat(stream([ndjson({ message: { content: "x" } })]).svc)).toBe("x");
    await expect(chat(stream([]).svc)).rejects.toThrow("Ollama returned an empty completion.");
  });

  it("sends the key only when there is one", async () => {
    await chat(stream([ndjson({ message: { content: "x" } })], { key: "tok" }).svc);
    expect(fetchMock().mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok" });
    await chat(stream([ndjson({ message: { content: "x" } })]).svc);
    expect(fetchMock().mock.calls[1][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("non-2xx and bodyless responses are reported", async () => {
    await expect(chat(stream([], {}, { ok: false, status: 404, statusText: "NF", text: async () => "no model" }).svc)).rejects.toThrow("Ollama HTTP 404: no model");
    await expect(chat(stream([], {}, { ok: false, status: 500, statusText: "E", text: async () => { throw new Error("x"); } }).svc)).rejects.toThrow("Ollama HTTP 500: (empty body)");
    await expect(chat(stream([], {}, { body: undefined }).svc)).rejects.toThrow("Ollama streaming response has no body reader.");
  });

  it("long streams log their progress", async () => {
    const lines = Array.from({ length: 12 }, () => ndjson({ message: { content: "a" } }));
    expect((await chat(stream([...lines, ndjson({ done: true })], { debug: true }).svc)).length).toBe(12);
  });

  it("failures pass through", async () => {
    fetchMock().mockRejectedValue(new Error("Load failed"));
    await expect(chat(make({ ollama: { stream: true, endpointMode: "ollama" } }).svc)).rejects.toThrow("Load failed");
    fetchMock().mockRejectedValue(null);
    await expect(chat(make({ ollama: { stream: true, endpointMode: "ollama" } }).svc)).rejects.toBeNull();
  });
});

describe("streaming on mobile (requestUrl)", () => {
  beforeEach(() => void (Platform.isMobile = true));

  describe("OpenAI-style SSE", () => {
    const run = (text: string, status = 200, o: Setup = {}) => {
      h.requestUrl.mockResolvedValue({ status, text });
      return make({ ...o, ollama: { stream: true, ...o.ollama } });
    };

    it("reads the whole buffered stream", async () => {
      const { svc, usage } = run(sse("你") + "\n" + sse("好", { finish_reason: "stop" }) + `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n` + "data: [DONE]\n" + sse("late"));
      expect(await chat(svc)).toBe("你好");
      expect(usage).toHaveLength(1);
      expect(fetchMock()).not.toHaveBeenCalled();
      expect(h.requestUrl.mock.calls[0][0]).toMatchObject({ method: "POST", throw: false });
    });

    it("skips lines that are not data, and malformed ones", async () => {
      expect(await chat(run(`: ping\nevent: x\ndata: {bad}\n${sse("a")}`).svc)).toBe("a");
    });

    it("errors with the status and body, and explains an empty answer", async () => {
      await expect(chat(run("rate limited", 429).svc)).rejects.toThrow("AI provider HTTP 429: rate limited");
      await expect(chat(run("", 500).svc)).rejects.toThrow("AI provider HTTP 500: (empty body)");
      await expect(chat(run(sse("", { finish_reason: "length" })).svc)).rejects.toThrow("Hit the max-tokens limit");
      await expect(chat(run("data: [DONE]\n").svc)).rejects.toThrow("Check the model log for errors.");
    });

    it("a failing requestUrl is rethrown", async () => {
      h.requestUrl.mockRejectedValue(new Error("net down"));
      await expect(chat(make({ ollama: { stream: true } }).svc)).rejects.toThrow("net down");
      h.requestUrl.mockRejectedValue(undefined);
      await expect(chat(make({ ollama: { stream: true } }).svc)).rejects.toBeUndefined();
    });

    it("a response with no text at all is an empty answer", async () => {
      h.requestUrl.mockResolvedValue({ status: 200 });
      await expect(chat(make({ debug: true, ollama: { stream: true } }).svc)).rejects.toThrow();
    });
  });

  describe("Ollama NDJSON", () => {
    const run = (text: string, status = 200, o: Setup = {}) => {
      h.requestUrl.mockResolvedValue({ status, text });
      return make({ ...o, ollama: { stream: true, endpointMode: "ollama", ...o.ollama } });
    };

    it("reads the lines, reports usage at done and ignores what follows", async () => {
      const { svc, usage } = run(ndjson({ message: { content: "你" } }) + "\n" + ndjson({ message: { content: 7 } }) + "{bad}\n" + ndjson({ message: { content: "好" } }) + ndjson({ done: true, prompt_eval_count: 5, eval_count: 3 }) + ndjson({ message: { content: "late" } }));
      expect(await chat(svc)).toBe("你好");
      expect(usage).toEqual([expect.objectContaining({ inputTokens: 5, outputTokens: 3 })]);
    });

    it("errors on a bad status or an empty answer", async () => {
      await expect(chat(run("model not found", 404).svc)).rejects.toThrow("Ollama HTTP 404: model not found");
      await expect(chat(run("", 500).svc)).rejects.toThrow("Ollama HTTP 500: (empty body)");
      await expect(chat(run(ndjson({ done: true })).svc)).rejects.toThrow("empty completion from the chunked response");
    });

    it("a failing requestUrl is rethrown", async () => {
      h.requestUrl.mockRejectedValue(new Error("net down"));
      await expect(chat(make({ ollama: { stream: true, endpointMode: "ollama" } }).svc)).rejects.toThrow("net down");
      h.requestUrl.mockRejectedValue(undefined);
      await expect(chat(make({ ollama: { stream: true, endpointMode: "ollama" } }).svc)).rejects.toBeUndefined();
    });

    it("a response with no text at all is an empty answer", async () => {
      h.requestUrl.mockResolvedValue({ status: 200 });
      await expect(chat(make({ ollama: { stream: true, endpointMode: "ollama" } }).svc)).rejects.toThrow();
    });
  });
});

describe("the debug log", () => {
  it("is silent unless switched on", async () => {
    await chat(make().svc);
    expect(Notice.instances).toHaveLength(0);
  });

  it("shows a progress notice, then hides it after a success, and writes a log file with the steps", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    const hide = vi.spyOn(Notice.prototype, "hide");
    const { svc, files, app } = make({ debug: true, folder: "Debug/Logs" });
    await chat(svc);
    expect(Notice.instances[0].message).toContain("[CCI AI");
    expect(Notice.instances[0].duration).toBe(0);
    await vi.advanceTimersByTimeAsync(4000);
    expect(hide).toHaveBeenCalledTimes(1);
    const [path, text] = [...files.entries()][0];
    expect(path).toBe("Debug/Logs/_cci-debug-2026-10-10T12-00-00.md");
    expect(text).toContain("# CCI AI debug — Buffered POST");
    expect(text).toContain("DONE");
    expect(app.vault.createFolder).toHaveBeenCalledWith("Debug/Logs");
  });

  it("a failure shows FAIL, hides after eight seconds and is in the log", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    fetchMock().mockResolvedValue(buffered("boom", 500));
    const hide = vi.spyOn(Notice.prototype, "hide");
    const { svc, files } = make({ debug: true });
    await expect(chat(svc)).rejects.toThrow("HTTP 500");
    expect(Notice.instances[0].message).toContain("FAIL");
    await vi.advanceTimersByTimeAsync(8000);
    expect(hide).toHaveBeenCalledTimes(1);
    expect([...files.values()][0]).toContain("- FAIL");
  });

  it("streaming paths attach the request body and raw response to the log", async () => {
    Platform.isMobile = true;
    h.requestUrl.mockResolvedValue({ status: 200, text: sse("a") + "data: [DONE]\n" });
    const { svc, files } = make({ debug: true, ollama: { stream: true } });
    await chat(svc);
    const text = [...files.values()][0];
    expect(text).toContain("## Request body");
    expect(text).toContain("## Raw HTTP response body");
    expect(text).toContain("## Concatenated content");
  });

  it("writes into the vault root without making a folder, and an existing folder is left alone", async () => {
    const root = make({ debug: true, folder: "" });
    await chat(root.svc);
    expect(root.app.vault.createFolder).not.toHaveBeenCalled();
    expect([...root.files.keys()][0]).toMatch(/^\/?_cci-debug-/);
    const existing = make({ debug: true, folder: "Logs" });
    existing.files.set("Logs", "");
    await chat(existing.svc);
    expect(existing.app.vault.createFolder).not.toHaveBeenCalled();
  });

  it("a log that cannot be written never disturbs the request, nor does a folder race", async () => {
    const a = make({ debug: true, folder: "Logs" });
    a.app.vault.createFolder.mockRejectedValue(new Error("exists"));
    await expect(chat(a.svc)).resolves.toBe("hello");
    const b = make({ debug: true });
    b.adapter.write.mockRejectedValue(new Error("disk full"));
    await expect(chat(b.svc)).resolves.toBe("hello");
  });

});
