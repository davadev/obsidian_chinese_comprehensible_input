/**
 * Pure helpers for scripts/model-eval.mjs: the harness that runs the plugin's real prompts against candidate OpenAI
 * models so a model migration (#115) is decided on evidence. Kept apart from the network code so it can be unit tested.
 */

/**
 * Request-body patches. The product code builds the body, so these are applied to it on the way out (a fetch
 * wrapper) to try parameter combinations the code does not send yet, without editing the shipped code first.
 * `set` adds or overwrites fields, `drop` removes them.
 */
export const VARIANTS = {
  default: { set: {}, drop: [] },
  "effort-none": { set: { reasoning_effort: "none" }, drop: [] },
  "effort-low": { set: { reasoning_effort: "low" }, drop: [] },
  "no-temperature": { set: {}, drop: ["temperature"] },
  "effort-none-no-temperature": { set: { reasoning_effort: "none" }, drop: ["temperature"] },
  "json-schema": { set: {}, drop: [], jsonSchema: true },
};

export function applyVariant(body, variantName, schema) {
  const v = VARIANTS[variantName];
  if (!v) throw new Error(`Unknown variant "${variantName}". Known: ${Object.keys(VARIANTS).join(", ")}`);
  const out = { ...body, ...v.set };
  for (const k of v.drop) delete out[k];
  if (v.jsonSchema) out.response_format = { type: "json_schema", json_schema: { name: "Eval", schema, strict: true } };
  return out;
}

/**
 * `id:input:output[:cached]` (USD per 1M tokens), e.g. `gpt-6-luna:0.10:0.50:0.01`.
 * Pricing is not in the API, so the person starting the run supplies it from the pricing page.
 */
export function parseModelSpec(spec) {
  const [id, input, output, cached] = String(spec).trim().split(":");
  const num = (v, name) => {
    const n = Number(v);
    if (v === undefined || v === "" || !Number.isFinite(n) || n < 0) {
      throw new Error(`Bad ${name} price in "${spec}". Expected id:input:output[:cached] in USD per 1M tokens.`);
    }
    return n;
  };
  if (!id) throw new Error(`Missing model id in "${spec}".`);
  return { id, input: num(input, "input"), output: num(output, "output"), cached: cached === undefined ? 0 : num(cached, "cached") };
}

export function costUsd(price, usage) {
  return (usage.inputTokens * price.input + usage.cachedInputTokens * price.cached + usage.outputTokens * price.output) / 1_000_000;
}

/** Which target words (by exact surface) are missing from the text. */
export function missingTargets(text, targets) {
  return targets.filter((t) => !text.includes(t));
}

/** Strict-enough parse of the model's story JSON: the keys the plugin's schema demands, a non-empty body. */
export function checkStoryJson(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!obj || typeof obj !== "object") return { ok: false, reason: "not an object" };
  if (typeof obj.textChinese !== "string" || obj.textChinese.trim() === "") return { ok: false, reason: "no textChinese" };
  return { ok: true, story: obj };
}

/** The first line of an error, with anything that looks like a key removed. */
export function safeError(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…").split("\n")[0].slice(0, 400);
}

export function markdownTable(rows) {
  const head = ["model", "variant", "task", "result", "target words", "tokens in/out", "cost", "secs"];
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map((r) => line(head.map((h) => String(r[h] ?? "")))) ].join("\n");
}
