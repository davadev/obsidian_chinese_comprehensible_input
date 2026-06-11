import { Notice, Platform, requestUrl, RequestUrlParam } from "obsidian";
import { AiSettings } from "../settings/types";

class DebugSession {
  private notice: Notice | null = null;
  private t0 = Date.now();
  constructor(private enabled: boolean, label: string) {
    if (!this.enabled) return;
    this.notice = new Notice(`[CCI AI] ${label}`, 0);
  }
  step(msg: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`[CCI AI ${elapsed}s] ${msg}`);
    if (this.notice) this.notice.setMessage(`[CCI AI +${elapsed}s] ${msg}`);
  }
  done(msg: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`[CCI AI ${elapsed}s] DONE — ${msg}`);
    if (this.notice) {
      this.notice.setMessage(`[CCI AI ${elapsed}s] ${msg}`);
      setTimeout(() => this.notice?.hide(), 4000);
      this.notice = null;
    }
  }
  fail(msg: string): void {
    const elapsed = ((Date.now() - this.t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.error(`[CCI AI ${elapsed}s] FAIL — ${msg}`);
    if (this.notice) {
      this.notice.setMessage(`[CCI AI ${elapsed}s] FAIL: ${msg}`);
      setTimeout(() => this.notice?.hide(), 8000);
      this.notice = null;
    }
  }
}

interface SimpleResponse { status: number; text: string }

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
  constructor(private getSettings: () => AiSettings) {}

  async testConnection(): Promise<boolean> {
    const s = this.getSettings();
    const url = joinUrl(s.baseUrl, "/models");
    const resp = await this.tryRequest({ url, method: "GET", headers: this.headers(s) });
    return resp.status >= 200 && resp.status < 500;
  }

  /** Send a chat completion with optional JSON schema. Returns parsed text content. */
  async chatJson(systemPrompt: string, userPrompt: string, schemaName: string, schema: object): Promise<string> {
    const s = this.getSettings();
    if (!s.enabled) throw new Error("AI is disabled in settings.");

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
            max_tokens: s.maxOutputTokens,
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
    const wantStream = s.stream && typeof fetch === "function";
    const body = wantStream ? { ...baseBody, stream: true } : baseBody;

    // eslint-disable-next-line no-console
    console.log(
      "[CCI AI] POST", url,
      "stream:", wantStream,
      "platform:", Platform.isMobile ? "mobile" : "desktop",
      "body:", body
    );

    if (wantStream) {
      return s.endpointMode === "ollama"
        ? await this.chatJsonStreamOllama(url, body, s)
        : await this.chatJsonStream(url, body, s);
    }

    const dbg = new DebugSession(s.debug, `Buffered POST → ${url}`);
    dbg.step("Issuing requestUrl/fetch (no streaming)…");
    let resp;
    try {
      resp = await this.tryRequest({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(s) },
        body: JSON.stringify(body),
      });
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
    // eslint-disable-next-line no-console
    console.log("[CCI AI] HTTP", resp.status, "response text:", resp.text);

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
    let json: unknown;
    try {
      json = JSON.parse(resp.text);
    } catch (err) {
      const msg = `AI provider returned non-JSON envelope: ${(err as Error).message}. First 300 chars: ${resp.text.slice(0, 300)}`;
      dbg.fail(msg);
      throw new Error(msg);
    }
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
  private async chatJsonStreamOllamaViaRequestUrl(url: string, body: object, s: AiSettings): Promise<string> {
    const dbg = new DebugSession(s.debug, `Ollama via requestUrl → ${url}`);
    try {
      dbg.step("Issuing requestUrl (stream:true keeps chunks flowing — bypasses iOS 60s idle timer).");
      const r = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(s) },
        body: JSON.stringify(body),
        throw: false,
      });
      dbg.step(`HTTP ${r.status}. body length=${r.text?.length ?? 0}.`);
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
          const json = JSON.parse(line);
          const piece = json?.message?.content;
          if (typeof piece === "string") content += piece;
          if (json?.done) break;
        } catch {
          // ignore — partial lines or non-JSON keep-alive
        }
      }
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
  private async chatJsonStreamOllama(url: string, body: object, s: AiSettings): Promise<string> {
    if (Platform.isMobile) {
      return await this.chatJsonStreamOllamaViaRequestUrl(url, body, s);
    }
    const dbg = new DebugSession(s.debug, `Ollama /api/chat → ${url}`);
    try {
      dbg.step("Issuing fetch (Ollama native)…");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const auth = this.headers(s);
      if (auth.Authorization) headers.Authorization = auth.Authorization;
      const res = await fetch(url, {
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
      // eslint-disable-next-line no-constant-condition
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
            const json = JSON.parse(line);
            const piece = json?.message?.content;
            if (typeof piece === "string") content += piece;
            if (json?.done) {
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
  private async chatJsonStreamSSEViaRequestUrl(url: string, body: object, s: AiSettings): Promise<string> {
    const dbg = new DebugSession(s.debug, `SSE via requestUrl → ${url}`);
    try {
      dbg.step("Issuing requestUrl with stream:true (SSE, chunked transfer keeps iOS alive).");
      const r = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers(s) },
        body: JSON.stringify(body),
        throw: false,
      });
      dbg.step(`HTTP ${r.status}. body length=${r.text?.length ?? 0}.`);
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
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
          const finish = json?.choices?.[0]?.finish_reason;
          if (finish) lastFinish = finish;
        } catch {
          // ignore malformed lines / keep-alive comments
        }
      }
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

  private async chatJsonStream(url: string, body: object, s: AiSettings): Promise<string> {
    if (Platform.isMobile) {
      return await this.chatJsonStreamSSEViaRequestUrl(url, body, s);
    }
    const dbg = new DebugSession(s.debug, `Streaming POST → ${url}`);
    // Two-stage timeout: only attach AbortSignal when we've received
    // the first byte. iOS WKWebView's fetch on Tailscale URLs has been
    // observed to reject with "Load failed" in <1 s when an
    // AbortSignal is passed at construct time, even though
    // similar-notes' equivalent fetch (no signal) works on the same
    // iPhone. So we mirror similar-notes' "no signal" pattern for the
    // initial connect, then rely on the per-chunk read loop + the
    // user's own cancel for the long-running part.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bodyStr = JSON.stringify(body);
    try {
      dbg.step(`Issuing fetch… (body ${bodyStr.length} B, headers minimal)`);
      // Minimal headers only — matches joybro/obsidian-similar-notes
      // pattern that works on iOS over Tailscale. Authorization only
      // when apiKey is set.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const auth = this.headers(s);
      if (auth.Authorization) headers.Authorization = auth.Authorization;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: bodyStr,
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
      // eslint-disable-next-line no-constant-condition
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
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") content += delta;
            const finish = json?.choices?.[0]?.finish_reason;
            if (finish) lastFinish = finish;
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
      if (timer) clearTimeout(timer);
    }
  }

  private headers(s: AiSettings): Record<string, string> {
    const h: Record<string, string> = {};
    if (s.apiKey) h["Authorization"] = `Bearer ${s.apiKey}`;
    return h;
  }

  private async tryRequest(p: RequestUrlParam): Promise<SimpleResponse> {
    const timeoutMs = this.getSettings().timeoutMs;

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
        ? setTimeout(() => ac.abort(), timeoutMs)
        : null;
    try {
      const res = await fetch(p.url, {
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
      if (timer) clearTimeout(timer);
    }
  }

  private timeoutGuard(ms: number): Promise<never> {
    return new Promise<never>((_, rej) =>
      setTimeout(
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

function extractFinishReason(json: any): string {
  return json?.choices?.[0]?.finish_reason ?? "";
}

function extractReasoning(json: any): string {
  const r = json?.choices?.[0]?.message?.reasoning;
  return typeof r === "string" ? r : "";
}

function buildResponseFormat(
  mode: "json_object" | "json_schema" | "none",
  schemaName: string,
  schema: object
): unknown | null {
  if (mode === "none") return null;
  if (mode === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: { name: schemaName, schema, strict: true },
  };
}

function joinUrl(base: string, path: string): string {
  if (base.endsWith("/")) base = base.slice(0, -1);
  if (!path.startsWith("/")) path = "/" + path;
  return base + path;
}

function extractText(json: any): string {
  // OpenAI-style chat completions
  const choice = json?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  // Some providers return `message.content` as an array of parts.
  if (Array.isArray(json?.choices?.[0]?.message?.content)) {
    const parts: string[] = [];
    for (const seg of json.choices[0].message.content) {
      if (typeof seg?.text === "string") parts.push(seg.text);
      else if (typeof seg === "string") parts.push(seg);
    }
    if (parts.length) return parts.join("");
  }
  // Legacy `choices[0].text` (older completions API).
  if (typeof json?.choices?.[0]?.text === "string") return json.choices[0].text;
  // OpenAI Responses API.
  if (typeof json?.output_text === "string") return json.output_text;
  if (Array.isArray(json?.output)) {
    const parts: string[] = [];
    for (const it of json.output) {
      const c = it?.content;
      if (Array.isArray(c)) {
        for (const seg of c) {
          if (typeof seg?.text === "string") parts.push(seg.text);
          else if (typeof seg === "string") parts.push(seg);
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
