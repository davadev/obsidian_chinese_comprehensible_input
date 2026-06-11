import { Platform, requestUrl, RequestUrlParam } from "obsidian";
import { AiSettings } from "../settings/types";

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

    const path = s.endpointMode === "responses" ? "/responses" : "/chat/completions";
    const url = joinUrl(s.baseUrl, path);

    // qwen3 + similar thinking models burn the completion-token budget
    // on a reasoning trace before they ever start emitting structured
    // output. Append `/no_think` to the system prompt to skip it.
    // No-op on models that don't recognise the directive.
    const sys = s.suppressThinking ? `${systemPrompt}\n/no_think` : systemPrompt;

    const responseFormat = buildResponseFormat(s.responseFormat, schemaName, schema);

    const baseBody = s.endpointMode === "responses"
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
    // concatenate `choices[0].delta.content` across chunks. Falls
    // back to non-streaming if the user disabled it OR the runtime
    // doesn't expose ReadableStream.body.
    const wantStream = s.stream && typeof fetch === "function" && !Platform.isMobile;
    const body = wantStream ? { ...baseBody, stream: true } : baseBody;

    // eslint-disable-next-line no-console
    console.log("[CCI AI] POST", url, "stream:", wantStream, "body:", body);

    if (wantStream) {
      return await this.chatJsonStream(url, body, s);
    }

    const resp = await this.tryRequest({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers(s) },
      body: JSON.stringify(body),
    });
    // eslint-disable-next-line no-console
    console.log("[CCI AI] HTTP", resp.status, "response text:", resp.text);

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`AI provider HTTP ${resp.status}: ${resp.text.slice(0, 300) || "(empty body)"}`);
    }
    if (!resp.text || resp.text.trim() === "") {
      throw new Error("AI provider returned an empty body. The model may not be reachable or may have crashed.");
    }
    let json: unknown;
    try {
      json = JSON.parse(resp.text);
    } catch (err) {
      throw new Error(
        `AI provider returned non-JSON envelope: ${(err as Error).message}. First 300 chars: ${resp.text.slice(0, 300)}`
      );
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
      throw new Error(`AI provider returned an empty completion. ${hint}`);
    }
    return out;
  }

  /**
   * Streaming POST. Parses Server-Sent Events from an OpenAI-compatible
   * `stream: true` chat completion. Each `data: {…}\n\n` chunk has
   * `choices[0].delta.content` (token-level deltas) — concatenated here.
   * The connection stays active byte-by-byte so Tailscale / VPN idle
   * timeouts don't kill it while the model is generating.
   */
  private async chatJsonStream(url: string, body: object, s: AiSettings): Promise<string> {
    const ac = new AbortController();
    const timer = s.timeoutMs > 0 ? setTimeout(() => ac.abort(), s.timeoutMs) : null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.headers(s) },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`AI provider HTTP ${res.status}: ${errText.slice(0, 300) || "(empty body)"}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming response has no body reader.");
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let lastFinish = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return content;
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
      // eslint-disable-next-line no-console
      console.log("[CCI AI] stream done. finish_reason:", lastFinish, "content length:", content.length);
      if (!content || content.trim() === "") {
        const hint =
          lastFinish === "length"
            ? "Hit the max-tokens limit. Increase `Max output tokens` in Settings → AI provider."
            : "Check the model log for errors.";
        throw new Error(`AI provider returned an empty streamed completion. ${hint}`);
      }
      return content;
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw new Error(
          `AI request timed out after ${Math.round(s.timeoutMs / 1000)}s. Bump 'Timeout (ms)' in Settings → AI provider for slow local models.`
        );
      }
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
