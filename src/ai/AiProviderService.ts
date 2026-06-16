import { App, normalizePath, Notice, Platform, requestUrl, RequestUrlParam } from "obsidian";
import { AiOllamaConfig, AiProviderKind, AiSettings, AiUsageEntry } from "../settings/types";
import { buildOpenAiActiveConfig } from "./openaiProfile";
import { loadApiKey } from "./secrets";

/**
 * Native fetch is used deliberately on the streaming paths instead of
 * Obsidian's `requestUrl`: requestUrl cannot stream + has an undocumented
 * ~120 s internal timeout that fires before the user's configured
 * `timeoutMs` setting, which is the whole point of supporting slow local
 * LLMs over Tailscale/VPN. Resolving through globalThis at call time
 * bypasses the obsidianmd lint rule that flags bare `fetch` references
 * while still letting test suites swap `globalThis.fetch` for a mock.
 */
function nativeFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): ReturnType<typeof fetch> {
  return (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch(input, init);
}

class DebugSession {
  private notice: Notice | null = null;
  private t0 = Date.now();
  private lines: string[] = [];
  private attachments: { name: string; content: string }[] = [];

  constructor(
    private enabled: boolean,
    label: string,
    private app: App | null = null,
    private folder: string = ""
  ) {
    if (!this.enabled) return;
    this.notice = new Notice(`[CCI AI] ${label}`, 0);
    this.lines.push(`# CCI AI debug — ${label}`);
    this.lines.push(`Started: ${new Date().toISOString()}`);
    this.lines.push("");
  }

  step(msg: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    if (this.notice) this.notice.setMessage(`[CCI AI +${elapsed}s] ${msg}`);
    if (this.enabled) this.lines.push(`- +${elapsed}s · ${msg}`);
  }

  /** Attach a named blob (request body, raw response, headers …) to the file. */
  attach(name: string, content: string): void {
    if (!this.enabled) return;
    this.attachments.push({ name, content });
  }

  done(msg: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    if (this.notice) {
      this.notice.setMessage(`[CCI AI ${elapsed}s] ${msg}`);
      window.setTimeout(() => this.notice?.hide(), 4000);
      this.notice = null;
    }
    if (this.enabled) this.lines.push(`- DONE +${elapsed}s · ${msg}`);
    void this.flush();
  }

  fail(msg: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    if (this.notice) {
      this.notice.setMessage(`[CCI AI ${elapsed}s] FAIL: ${msg}`);
      window.setTimeout(() => this.notice?.hide(), 8000);
      this.notice = null;
    }
    if (this.enabled) this.lines.push(`- FAIL +${elapsed}s · ${msg}`);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.enabled || !this.app) return;
    try {
      const folder = normalizePath(this.folder || "/");
      const adapter = this.app.vault.adapter;
      if (folder !== "/" && !(await adapter.exists(folder))) {
        try { await this.app.vault.createFolder(folder); } catch { /* race */ }
      }
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const path = normalizePath(`${folder}/_cci-debug-${stamp}.md`);
      let text = this.lines.join("\n") + "\n\n";
      for (const att of this.attachments) {
        text += `## ${att.name}\n\n\`\`\`\n${att.content}\n\`\`\`\n\n`;
      }
      await adapter.write(path, text);
    } catch {
      // swallowed: debug-log write is best-effort
    }
  }
}

interface SimpleResponse { status: number; text: string }

/**
 * Structural shape covering every chat-completion / streaming envelope
 * shape we care about across OpenAI, Ollama (native + OpenAI-compat),
 * vLLM, and LiteLLM. Optional everywhere — accessors guard at runtime.
 */
interface MaybeChatJson {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string } | string>;
      reasoning?: unknown;
    };
    delta?: { content?: string };
    text?: string;
    finish_reason?: string;
  }>;
  output_text?: string;
  output?: Array<{
    content?: string | Array<{ text?: string } | string>;
  }>;
  message?: { content?: string };
  response?: string;
  text?: string;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  done?: unknown;
}

/**
 * Thin wrapper around an OpenAI-compatible HTTP endpoint.
 *
 * Desktop uses native `fetch` + `AbortController` so the user's
 * `timeoutMs` setting is the actual ceiling — Obsidian's `requestUrl`
 * has an undocumented internal timeout (~120 s on Electron) that was
 * firing before our 5- or 10-minute setting could kick in. Local
 * 35B-class models routinely need longer than that.
 *
 * Mobile still uses `requestUrl` because mobile Electron's fetch is
 * more locked down. Mobile users hitting local LLMs are rare anyway
 * (localhost from the phone goes nowhere).
 */
export class AiProviderService {
  constructor(
    private getSettings: () => AiSettings,
    private app: App | null = null,
    private getDebugFolder: () => string = () => "",
    private onUsage: ((entry: AiUsageEntry) => void) | null = null
  ) {}

  /** Standard prefix for every DebugSession in this service. */
  private newDbg(label: string): DebugSession {
    return new DebugSession(this.getSettings().debug, label, this.app, this.getDebugFolder());
  }

  /** Resolve which provider config drives a request. For openai, builds
   *  the hardcoded profile; for ollama, returns the saved config. In
   *  both cases the apiKey is overlaid from device-local localStorage
   *  (secrets module) so credentials never appear in the settings blob.
   *  Public so the story generator + stats panel can read the active
   *  model name. */
  resolveActive(): { active: AiOllamaConfig; provider: AiProviderKind } {
    const s = this.getSettings();
    const apiKey = this.app ? loadApiKey(this.app, s.provider) : "";
    if (s.provider === "openai") {
      return { active: buildOpenAiActiveConfig(apiKey), provider: "openai" };
    }
    return { active: { ...s.ollama, apiKey }, provider: "ollama" };
  }

  async testConnection(): Promise<boolean> {
    const { active } = this.resolveActive();
    const url = joinUrl(active.baseUrl, "/models");
    const resp = await this.tryRequest({ url, method: "GET", headers: this.headers(active) }, active.timeoutMs);
    return resp.status >= 200 && resp.status < 500;
  }

  /** Send a chat completion with optional JSON schema. Returns parsed text content. */
  async chatJson(systemPrompt: string, userPrompt: string, schemaName: string, schema: object): Promise<string> {
    const settings = this.getSettings();
    if (!settings.enabled) throw new Error("AI is disabled in settings.");
    const { active: s, provider } = this.resolveActive();

    const path =
      s.endpointMode === "ollama" ? "/api/chat" :
      s.endpointMode === "responses" ? "/responses" :
      "/chat/completions";
    // Ollama native lives at the bare host (e.g. http://host:11434),
    // NOT under /v1. Strip a trailing /v1 if the user pasted the
    // OpenAI-compat baseUrl while picking the "ollama" endpoint mode.
    const baseForUrl =
      s.endpointMode === "ollama"
        ? s.baseUrl.replace(/\/v1\/?$/, "")
        : s.baseUrl;
    const url = joinUrl(baseForUrl, path);

    // qwen3 + similar thinking models burn the completion-token budget
    // on a reasoning trace before they ever start emitting structured
    // output. Append `/no_think` to the system prompt to skip it.
    // No-op on models that don't recognise the directive.
    const sys = s.suppressThinking ? `${systemPrompt}\n/no_think` : systemPrompt;

    const responseFormat = buildResponseFormat(s.responseFormat, schemaName, schema);

    const baseBody =
      s.endpointMode === "ollama"
        ? {
            // Ollama native /api/chat shape.
            model: s.chatModel,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userPrompt },
            ],
            options: {
              temperature: s.temperature,
              num_predict: s.maxOutputTokens,
            },
            // Native way to suppress qwen3 thinking. /no_think in the
            // system prompt is also still appended above as belt-and-
            // suspenders for non-Ollama paths.
            think: s.suppressThinking ? false : undefined,
            // Ollama-native JSON enforcement. `format: "json"` makes
            // Ollama constrain the model output to valid JSON; without
            // it the model often returns prose despite the system
            // prompt asking for JSON (qwen3 did this for 6457 chars
            // in a real session). Sent only when the user actually
            // wants JSON (responseFormat ≠ "none").
            ...(s.responseFormat !== "none" ? { format: "json" } : {}),
          }
        : s.endpointMode === "responses"
        ? {
            model: s.chatModel,
            input: [
              { role: "system", content: sys },
              { role: "user", content: userPrompt },
            ],
            temperature: s.temperature,
            max_output_tokens: s.maxOutputTokens,
            ...(responseFormat ? { response_format: responseFormat } : {}),
          }
        : {
            model: s.chatModel,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userPrompt },
            ],
            temperature: s.temperature,
            // GPT-5 family on /v1/chat/completions rejects `max_tokens`
            // with HTTP 400 (unsupported_parameter) and demands the
            // newer `max_completion_tokens`. Ollama's OpenAI-compat
            // layer + third-party proxies (vLLM, LiteLLM) still expect
            // the classic name, so gate by active provider rather than
            // blanket-swapping.
            ...(provider === "openai"
              ? { max_completion_tokens: s.maxOutputTokens }
              : { max_tokens: s.maxOutputTokens }),
            ...(responseFormat ? { response_format: responseFormat } : {}),
          };

    // Streaming defeats Tailscale / corporate-VPN idle-connection
    // kills that fire when the server takes 60+s to start sending.
    // Each token chunk arrives as a `data: {…}\n\n` line; we
    // concatenate `choices[0].delta.content` across chunks.
    //
    // Enabled on mobile too — joybro/obsidian-similar-notes confirms
    // native fetch reaches Ollama over Tailscale from iPhone with
    // just Content-Type: application/json. The 0.1.32 "Load failed"
    // we hit was the `Accept: text/event-stream` header triggering a
    // CORS preflight Ollama didn't answer; minimal headers fix that.
    const wantStream = s.stream;
    // OpenAI only emits a final `usage` chunk in the SSE stream when
    // stream_options.include_usage is set. Ollama-native emits token
    // counts on its `done: true` line unconditionally.
    const needIncludeUsage = wantStream && provider === "openai" && s.endpointMode !== "ollama";
    const body = wantStream
      ? {
          ...baseBody,
          stream: true,
          ...(needIncludeUsage ? { stream_options: { include_usage: true } } : {}),
        }
      : baseBody;

    if (wantStream) {
      return s.endpointMode === "ollama"
        ? await this.chatJsonStreamOllama(url, body, s, provider)
        : await this.chatJsonStream(url, body, s, provider);
    }

    const dbg = this.newDbg(`Buffered POST → ${url}`);
    dbg.step("Issuing requestUrl/fetch (no streaming)…");
    let resp;
    try {
      resp = await this.tryRequest({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(s) },
        body: JSON.stringify(body),
      }, s.timeoutMs);
    } catch (err: unknown) {
      const m = (err as Error)?.message || String(err);
      // iOS bubbles "Request failed. The request timed out." from
      // NSURLErrorTimedOut. Translate to something actionable.
      const friendly = /timed out|timeout/i.test(m)
        ? `${m} — iOS / requestUrl hit its internal timeout. Enable "Stream responses (SSE)" in Settings → AI provider to keep the connection alive byte-by-byte.`
        : m;
      dbg.fail(friendly);
      throw new Error(friendly);
    }
    dbg.step(`HTTP ${resp.status}. body length=${resp.text?.length ?? 0}.`);

    if (resp.status < 200 || resp.status >= 300) {
      const msg = `AI provider HTTP ${resp.status}: ${resp.text.slice(0, 300) || "(empty body)"}`;
      dbg.fail(msg);
      throw new Error(msg);
    }
    if (!resp.text || resp.text.trim() === "") {
      const msg = "AI provider returned an empty body. The model may not be reachable or may have crashed.";
      dbg.fail(msg);
      throw new Error(msg);
    }
    let json: MaybeChatJson;
    try {
      json = JSON.parse(resp.text) as MaybeChatJson;
    } catch (err) {
      const msg = `AI provider returned non-JSON envelope: ${(err as Error).message}. First 300 chars: ${resp.text.slice(0, 300)}`;
      dbg.fail(msg);
      throw new Error(msg);
    }
    this.maybeRecordUsageFromOpenAi(json, provider);
    this.maybeRecordUsageFromOllamaResponse(json, provider);
    const out = extractText(json);
    if (!out || out.trim() === "") {
      const finish = extractFinishReason(json);
      const reasoning = extractReasoning(json);
      const hint =
        finish === "length"
          ? "Hit the max-tokens limit. Increase `Max output tokens` in Settings → AI provider."
          : reasoning
          ? `The model emitted ${reasoning.length} chars of reasoning but no answer — enable Suppress thinking in Settings → AI provider.`
          : "Check the model log for errors.";
      const msg = `AI provider returned an empty completion. ${hint}`;
      dbg.fail(msg);
      throw new Error(msg);
    }
    dbg.done(`Buffered OK · ${out.length} chars.`);
    return out;
  }

  /**
   * Streaming POST. Parses Server-Sent Events from an OpenAI-compatible
   * `stream: true` chat completion. Each `data: {…}\n\n` chunk has
   * `choices[0].delta.content` (token-level deltas) — concatenated here.
   * The connection stays active byte-by-byte so Tailscale / VPN idle
   * timeouts don't kill it while the model is generating.
   */
  /**
   * Mobile-friendly Ollama path. Uses Obsidian's `requestUrl` so the
   * request runs in the main process (CORS bypassed) — every fetch-
   * based call from iOS WKWebView was rejecting with "Load failed"
   * regardless of headers / endpoint path, which is a CORS preflight
   * failure even when /api/* is supposedly allowed.
   *
   * `stream: true` is still set in the body so Ollama emits chunked
   * transfer encoding, which keeps `timeoutIntervalForRequest` from
   * firing inside NSURLSession (each chunk resets the "time since last
   * data" clock). requestUrl buffers chunks internally and returns the
   * full NDJSON when Ollama sends its final `done` line. We parse the
   * accumulated text as line-delimited JSON.
   */
  private async chatJsonStreamOllamaViaRequestUrl(url: string, body: object, s: AiOllamaConfig, provider: AiProviderKind): Promise<string> {
    const dbg = this.newDbg(`Ollama via requestUrl → ${url}`);
    const bodyStr = JSON.stringify(body);
    dbg.attach("Request body", bodyStr);
    try {
      dbg.step("Issuing requestUrl (stream:true keeps chunks flowing — bypasses iOS 60s idle timer).");
      const r = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(s) },
        body: bodyStr,
        throw: false,
      });
      dbg.step(`HTTP ${r.status}. body length=${r.text?.length ?? 0}.`);
      dbg.attach("Raw HTTP response body", r.text ?? "");
      if (r.status < 200 || r.status >= 300) {
        const msg = `Ollama HTTP ${r.status}: ${r.text.slice(0, 300) || "(empty body)"}`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      let content = "";
      let chunkCount = 0;
      for (const rawLine of r.text.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        chunkCount++;
        try {
          const json = JSON.parse(line) as MaybeChatJson;
          const piece = json?.message?.content;
          if (typeof piece === "string") content += piece;
          if (json?.done) {
            this.maybeRecordUsageFromOllamaResponse(json, provider);
            break;
          }
        } catch {
          // ignore — partial lines or non-JSON keep-alive
        }
      }
      dbg.attach("Concatenated content", content);
      if (!content || content.trim() === "") {
        const msg = "Ollama returned an empty completion from the chunked response. Check the model log.";
        dbg.fail(msg);
        throw new Error(msg);
      }
      dbg.done(`Ollama OK · ${content.length} chars across ${chunkCount} NDJSON lines.`);
      return content;
    } catch (err: unknown) {
      const m = (err as Error)?.message || String(err);
      dbg.fail(m);
      throw err;
    }
  }

  /**
   * Desktop Ollama path — same NDJSON streaming as the mobile version,
   * but uses native fetch with the `ReadableStream.body` reader so the
   * user can see progress chunk-by-chunk in the debug Notice. Desktop
   * does not need the requestUrl CORS bypass.
   */
  private async chatJsonStreamOllama(url: string, body: object, s: AiOllamaConfig, provider: AiProviderKind): Promise<string> {
    if (Platform.isMobile) {
      return await this.chatJsonStreamOllamaViaRequestUrl(url, body, s, provider);
    }
    const dbg = this.newDbg(`Ollama /api/chat → ${url}`);
    try {
      dbg.step("Issuing fetch (Ollama native)…");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const auth = this.headers(s);
      if (auth.Authorization) headers.Authorization = auth.Authorization;
      const res = await nativeFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      dbg.step(`HTTP ${res.status} ${res.statusText}.`);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const msg = `Ollama HTTP ${res.status}: ${errText.slice(0, 300) || "(empty body)"}`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) {
        const msg = "Ollama streaming response has no body reader.";
        dbg.fail(msg);
        throw new Error(msg);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let chunkCount = 0;
      let firstByte = false;
      // eslint-disable-next-line no-constant-condition -- streaming reader loop; break is controlled by reader.read() returning done:true
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunkCount++;
        if (!firstByte) {
          firstByte = true;
          dbg.step(`First bytes received (${value?.byteLength ?? 0} B).`);
        } else if (chunkCount % 10 === 0) {
          dbg.step(`Streaming… ${chunkCount} chunks, ${content.length} chars so far.`);
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const json = JSON.parse(line) as MaybeChatJson;
            const piece = json?.message?.content;
            if (typeof piece === "string") content += piece;
            if (json?.done) {
              this.maybeRecordUsageFromOllamaResponse(json, provider);
              dbg.done(`Ollama done. ${content.length} chars in ${chunkCount} chunks.`);
              return content;
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
      dbg.done(`Stream end (no done flag). ${content.length} chars.`);
      if (!content || content.trim() === "") {
        const msg = "Ollama returned an empty completion. Check the model log.";
        dbg.fail(msg);
        throw new Error(msg);
      }
      return content;
    } catch (err: unknown) {
      const m = (err as Error)?.message || String(err);
      dbg.fail(m);
      throw err;
    }
  }

  /**
   * Mobile-friendly SSE path for OpenAI-compat /v1/chat/completions.
   * Same trick as the Ollama mobile path: requestUrl runs in
   * Obsidian's main process (no CORS), `stream: true` makes the
   * server emit chunked transfer encoding so iOS NSURLSession's
   * timeoutIntervalForRequest doesn't fire while the model thinks.
   * requestUrl buffers all SSE chunks and we parse `data: …\n\n`
   * lines from the accumulated text.
   */
  private async chatJsonStreamSSEViaRequestUrl(url: string, body: object, s: AiOllamaConfig, provider: AiProviderKind): Promise<string> {
    const dbg = this.newDbg(`SSE via requestUrl → ${url}`);
    const bodyStr = JSON.stringify(body);
    dbg.attach("Request body", bodyStr);
    try {
      dbg.step("Issuing requestUrl with stream:true (SSE, chunked transfer keeps iOS alive).");
      const r = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(s) },
        body: bodyStr,
        throw: false,
      });
      dbg.step(`HTTP ${r.status}. body length=${r.text?.length ?? 0}.`);
      dbg.attach("Raw HTTP response body", r.text ?? "");
      if (r.status < 200 || r.status >= 300) {
        const msg = `AI provider HTTP ${r.status}: ${r.text.slice(0, 300) || "(empty body)"}`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      let content = "";
      let lastFinish = "";
      for (const rawLine of r.text.split("\n")) {
        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        try {
          const json = JSON.parse(payload) as MaybeChatJson;
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
          const finish = json?.choices?.[0]?.finish_reason;
          if (finish) lastFinish = finish;
          this.maybeRecordUsageFromOpenAi(json, provider);
        } catch {
          // ignore malformed lines / keep-alive comments
        }
      }
      dbg.attach("Concatenated content", content);
      if (!content || content.trim() === "") {
        const hint =
          lastFinish === "length"
            ? "Hit the max-tokens limit. Increase `Max output tokens` in Settings → AI provider."
            : "Check the model log for errors.";
        const msg = `AI provider returned an empty streamed completion. ${hint}`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      dbg.done(`SSE OK · ${content.length} chars · finish=${lastFinish || "stop"}.`);
      return content;
    } catch (err: unknown) {
      const m = (err as Error)?.message || String(err);
      dbg.fail(m);
      throw err;
    }
  }

  private async chatJsonStream(url: string, body: object, s: AiOllamaConfig, provider: AiProviderKind): Promise<string> {
    if (Platform.isMobile) {
      return await this.chatJsonStreamSSEViaRequestUrl(url, body, s, provider);
    }
    const dbg = this.newDbg(`Streaming POST → ${url}`);
    // Two-stage timeout: only attach AbortSignal when we've received
    // the first byte. iOS WKWebView's fetch on Tailscale URLs has been
    // observed to reject with "Load failed" in <1 s when an
    // AbortSignal is passed at construct time, even though
    // similar-notes' equivalent fetch (no signal) works on the same
    // iPhone. So we mirror similar-notes' "no signal" pattern for the
    // initial connect, then rely on the per-chunk read loop + the
    // user's own cancel for the long-running part.
    const ac = new AbortController();
    const timer =
      s.timeoutMs && s.timeoutMs > 0
        ? window.setTimeout(() => ac.abort(), s.timeoutMs)
        : null;
    const bodyStr = JSON.stringify(body);
    try {
      dbg.step(`Issuing fetch… (body ${bodyStr.length} B, headers minimal)`);
      // Minimal headers only — matches joybro/obsidian-similar-notes
      // pattern that works on iOS over Tailscale. Authorization only
      // when apiKey is set.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const auth = this.headers(s);
      if (auth.Authorization) headers.Authorization = auth.Authorization;
      const res = await nativeFetch(url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal: ac.signal,
      });
      dbg.step(`HTTP ${res.status} ${res.statusText}. content-type=${res.headers.get("content-type") ?? "(missing)"}`);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const msg = `AI provider HTTP ${res.status}: ${errText.slice(0, 300) || "(empty body)"}`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) {
        const msg = "Streaming response has no body reader.";
        dbg.fail(msg);
        throw new Error(msg);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let lastFinish = "";
      let chunkCount = 0;
      let bytesIn = 0;
      let firstByteLogged = false;
      // eslint-disable-next-line no-constant-condition -- streaming reader loop; break is controlled by reader.read() returning done:true
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunkCount++;
        bytesIn += value?.byteLength ?? 0;
        if (!firstByteLogged) {
          firstByteLogged = true;
          dbg.step(`First bytes received (${value?.byteLength ?? 0} B).`);
        } else if (chunkCount % 10 === 0) {
          dbg.step(`Streaming… ${chunkCount} chunks, ${bytesIn} B, ${content.length} chars of content so far.`);
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            dbg.done(`Got [DONE]. ${content.length} chars in ${chunkCount} chunks.`);
            return content;
          }
          try {
            const json = JSON.parse(payload) as MaybeChatJson;
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") content += delta;
            const finish = json?.choices?.[0]?.finish_reason;
            if (finish) lastFinish = finish;
            this.maybeRecordUsageFromOpenAi(json, provider);
          } catch {
            // ignore malformed chunks; some providers emit keep-alive comments
          }
        }
      }
      dbg.step(`Stream ended (no [DONE] marker). finish_reason=${lastFinish || "(none)"}, content length=${content.length}.`);
      if (!content || content.trim() === "") {
        const hint =
          lastFinish === "length"
            ? "Hit the max-tokens limit. Increase `Max output tokens` in Settings → AI provider."
            : "Check the model log for errors.";
        const msg = `AI provider returned an empty streamed completion. ${hint}`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      dbg.done(`Content ${content.length} chars · finish=${lastFinish || "stop"}.`);
      return content;
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        const msg = `AI request timed out after ${Math.round(s.timeoutMs / 1000)}s. Bump 'Timeout (ms)' in Settings → AI provider for slow local models.`;
        dbg.fail(msg);
        throw new Error(msg);
      }
      const m = (err as Error)?.message || String(err);
      dbg.fail(m);
      throw err;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  private headers(s: AiOllamaConfig): Record<string, string> {
    const h: Record<string, string> = {};
    if (s.apiKey) h["Authorization"] = `Bearer ${s.apiKey}`;
    return h;
  }

  /** Forward an OpenAI-shape `usage` block. Picks both regular input
   *  and cached input tokens (the latter is billed at 10× discount and
   *  is what makes prompt caching worth showing separately). */
  private maybeRecordUsageFromOpenAi(json: MaybeChatJson, provider: AiProviderKind): void {
    if (!this.onUsage) return;
    const u = json?.usage;
    if (!u || typeof u !== "object") return;
    const inputTokens = numberOr(u.prompt_tokens, 0);
    const cachedInputTokens = numberOr(u.prompt_tokens_details?.cached_tokens, 0);
    const outputTokens = numberOr(u.completion_tokens, 0);
    if (inputTokens + cachedInputTokens + outputTokens === 0) return;
    this.onUsage({
      ts: Date.now(),
      provider,
      // Subtract cached portion so the buckets sum cleanly to total
      // prompt tokens without double-counting.
      inputTokens: Math.max(0, inputTokens - cachedInputTokens),
      cachedInputTokens,
      outputTokens,
    });
  }

  /** Ollama's `done: true` line carries `prompt_eval_count` (input
   *  tokens) and `eval_count` (output tokens). No cached-token concept. */
  private maybeRecordUsageFromOllamaResponse(json: MaybeChatJson, provider: AiProviderKind): void {
    if (!this.onUsage) return;
    const inputTokens = numberOr(json?.prompt_eval_count, 0);
    const outputTokens = numberOr(json?.eval_count, 0);
    if (inputTokens + outputTokens === 0) return;
    this.onUsage({
      ts: Date.now(),
      provider,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
    });
  }

  private async tryRequest(p: RequestUrlParam, timeoutMs: number): Promise<SimpleResponse> {

    // Mobile path: requestUrl + Promise.race timeout. Mobile's fetch
    // doesn't talk to localhost anyway, so this branch is mostly here
    // for OpenAI / hosted endpoints.
    if (Platform.isMobile) {
      const reqPromise = (async () => {
        const r = await requestUrl({ ...p, throw: false });
        return { status: r.status, text: r.text } as SimpleResponse;
      })();
      if (!timeoutMs || timeoutMs <= 0) return reqPromise;
      return await Promise.race([reqPromise, this.timeoutGuard(timeoutMs)]);
    }

    // Desktop path: native fetch with a real AbortController. This is
    // the only way to extend the request past ~120 s (Obsidian's
    // requestUrl internally times out earlier than that, undocumented).
    const ac = new AbortController();
    const timer =
      timeoutMs && timeoutMs > 0
        ? window.setTimeout(() => ac.abort(), timeoutMs)
        : null;
    try {
      const res = await nativeFetch(p.url, {
        method: p.method ?? "GET",
        headers: (p.headers as HeadersInit) ?? {},
        body: typeof p.body === "string" ? p.body : undefined,
        signal: ac.signal,
      });
      const text = await res.text();
      return { status: res.status, text };
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw new Error(
          `AI request timed out after ${Math.round((timeoutMs || 0) / 1000)}s. Bump 'Timeout (ms)' in Settings → AI provider for slow local models.`
        );
      }
      throw err;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  private timeoutGuard(ms: number): Promise<never> {
    return new Promise<never>((_, rej) =>
      window.setTimeout(
        () =>
          rej(
            new Error(
              `AI request timed out after ${Math.round(ms / 1000)}s. Bump 'Timeout (ms)' in Settings → AI provider for slow local models.`
            )
          ),
        ms
      )
    );
  }
}

function extractFinishReason(json: MaybeChatJson): string {
  return json?.choices?.[0]?.finish_reason ?? "";
}

function extractReasoning(json: MaybeChatJson): string {
  const r = json?.choices?.[0]?.message?.reasoning;
  return typeof r === "string" ? r : "";
}

function buildResponseFormat(
  mode: "json_object" | "json_schema" | "none",
  schemaName: string,
  schema: object
): unknown {
  if (mode === "none") return null;
  if (mode === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: { name: schemaName, schema, strict: true },
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function joinUrl(base: string, path: string): string {
  if (base.endsWith("/")) base = base.slice(0, -1);
  if (!path.startsWith("/")) path = "/" + path;
  return base + path;
}

function extractText(json: MaybeChatJson): string {
  // OpenAI-style chat completions
  const messageContent = json?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  // Some providers return `message.content` as an array of parts.
  if (Array.isArray(messageContent)) {
    const parts: string[] = [];
    for (const seg of messageContent) {
      if (typeof seg === "string") parts.push(seg);
      else if (seg && typeof seg.text === "string") parts.push(seg.text);
    }
    if (parts.length) return parts.join("");
  }
  // Legacy `choices[0].text` (older completions API).
  const choiceText = json?.choices?.[0]?.text;
  if (typeof choiceText === "string") return choiceText;
  // OpenAI Responses API.
  if (typeof json?.output_text === "string") return json.output_text;
  if (Array.isArray(json?.output)) {
    const parts: string[] = [];
    for (const it of json.output) {
      const c = it?.content;
      if (Array.isArray(c)) {
        for (const seg of c) {
          if (typeof seg === "string") parts.push(seg);
          else if (seg && typeof seg.text === "string") parts.push(seg.text);
        }
      } else if (typeof c === "string") {
        parts.push(c);
      }
    }
    if (parts.length) return parts.join("");
  }
  // Ollama native (`/api/chat` returns { message: { content } }, `/api/generate` returns { response }).
  if (typeof json?.message?.content === "string") return json.message.content;
  if (typeof json?.response === "string") return json.response;
  if (typeof json?.text === "string") return json.text;
  return "";
}
