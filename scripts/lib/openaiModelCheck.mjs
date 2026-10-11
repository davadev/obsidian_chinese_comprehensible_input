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

/**
 * Reads the hardcoded model ids out of src/ai/openaiProfile.ts, so the names live in exactly one place. The default
 * is what every user gets; the legacy one is the previous default kept as an opt-in fallback.
 */
export function parseModelIds(source) {
  const read = (name) => {
    const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*"([^"]+)"`).exec(source);
    return m ? m[1] : null;
  };
  return { default: read("OPENAI_MODEL_ID"), legacy: read("OPENAI_LEGACY_MODEL_ID") };
}

/** A fallback going away is worth knowing about but must not fail the run or open an issue: users are not on it by default. */
export function capAtWarn(result) {
  return result.level === "fail" ? { level: "warn", message: result.message } : result;
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
