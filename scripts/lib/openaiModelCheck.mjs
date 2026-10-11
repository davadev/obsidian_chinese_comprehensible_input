/**
 * Pure decision logic for scripts/check-openai-model.mjs (#116), kept apart from the network calls so it can be
 * pinned by src/tests/openaiModelCheck.test.ts.
 *
 * Levels: "pass" and "skip" exit 0 quietly, "warn" exits 0 but is surfaced as a workflow warning, "fail" exits 1
 * and opens the tracking issue.
 */

/** A shutdown this close is a fail: a fix release needs review time we would not have. */
export const FAIL_WITHIN_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads the hardcoded model id out of src/ai/openaiProfile.ts, so the model name lives in exactly one place. */
export function parseModelId(source) {
  const m = /export\s+const\s+OPENAI_MODEL_ID\s*=\s*"([^"]+)"/.exec(source);
  return m ? m[1] : null;
}

/**
 * Classifies the answer to GET /v1/models/{id}.
 * `shutdown_date` is optional in the OpenAPI schema, so absent and null both mean "no announcement".
 */
export function classifyModel({ status, body, now }) {
  if (status === 404) {
    return { level: "fail", message: "The model no longer exists (HTTP 404). Every OpenAI user's story generation is broken." };
  }
  if (status === 401 || status === 403) {
    return { level: "fail", message: `OpenAI rejected the API key (HTTP ${status}); replace the OPENAI_API_KEY secret.` };
  }
  if (status !== 200) {
    return { level: "fail", message: `Unexpected response from OpenAI (HTTP ${status}).` };
  }
  const raw = body && typeof body === "object" ? body.shutdown_date : undefined;
  if (raw === undefined || raw === null) {
    return { level: "pass", message: "No shutdown announced." };
  }
  const at = Date.parse(String(raw));
  if (!Number.isFinite(at)) {
    return { level: "fail", message: `Unreadable shutdown_date "${String(raw)}".` };
  }
  const days = Math.ceil((at - now) / DAY_MS);
  if (days <= FAIL_WITHIN_DAYS) {
    return { level: "fail", message: `Shutdown announced for ${raw} (${days} days away).` };
  }
  return { level: "warn", message: `Shutdown announced for ${raw} (${days} days away).` };
}

/**
 * Classifies the model list. Absence is only a warning: it is the earliest signal that a model is on its way out,
 * but the model stays callable (and `shutdown_date` stays null) for a long time after it leaves the catalog.
 */
export function classifyCatalog({ status, body, modelId }) {
  if (status !== 200) {
    return { level: "warn", message: `Could not read the model catalog (HTTP ${status}).` };
  }
  const data = body && Array.isArray(body.data) ? body.data : [];
  const listed = data.some((m) => m && m.id === modelId);
  return listed
    ? { level: "pass", message: "Listed in the current model catalog." }
    : { level: "warn", message: "No longer listed in the current model catalog: plan a migration (#115)." };
}

const RANK = { pass: 0, skip: 0, warn: 1, fail: 2 };

/** The worst of several results. */
export function worst(results) {
  return results.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
}
