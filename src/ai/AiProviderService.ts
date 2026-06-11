import { requestUrl, RequestUrlParam } from "obsidian";
import { AiSettings } from "../settings/types";

/**
 * Thin wrapper around an OpenAI-compatible HTTP endpoint.
 * Uses Obsidian's `requestUrl` so it works on mobile (no Node `fetch` quirks).
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

    const body =
      s.endpointMode === "responses"
        ? {
            model: s.chatModel,
            input: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: s.temperature,
            max_output_tokens: s.maxOutputTokens,
            response_format: {
              type: "json_schema",
              json_schema: { name: schemaName, schema, strict: true },
            },
          }
        : {
            model: s.chatModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: s.temperature,
            max_tokens: s.maxOutputTokens,
            response_format: {
              type: "json_schema",
              json_schema: { name: schemaName, schema, strict: true },
            },
          };

    // eslint-disable-next-line no-console
    console.log("[CCI AI] POST", url, "body:", body);
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
      throw new Error("AI provider returned an empty completion. Check `max_tokens` and the model log.");
    }
    return out;
  }

  private headers(s: AiSettings): Record<string, string> {
    const h: Record<string, string> = {};
    if (s.apiKey) h["Authorization"] = `Bearer ${s.apiKey}`;
    return h;
  }

  private async tryRequest(p: RequestUrlParam) {
    return await requestUrl({ ...p, throw: false });
  }
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
