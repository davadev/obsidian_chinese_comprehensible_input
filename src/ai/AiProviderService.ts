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

    const resp = await this.tryRequest({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers(s) },
      body: JSON.stringify(body),
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`AI provider HTTP ${resp.status}: ${resp.text.slice(0, 300)}`);
    }
    const json = JSON.parse(resp.text);
    return extractText(json);
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
  // Chat completions style
  const choice = json?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  // Responses style
  if (Array.isArray(json?.output)) {
    const parts: string[] = [];
    for (const it of json.output) {
      const c = it?.content;
      if (Array.isArray(c)) {
        for (const seg of c) {
          if (typeof seg?.text === "string") parts.push(seg.text);
          else if (typeof seg === "string") parts.push(seg);
        }
      }
    }
    if (parts.length) return parts.join("");
  }
  if (typeof json?.text === "string") return json.text;
  return JSON.stringify(json);
}
