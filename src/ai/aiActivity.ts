/**
 * What an AI request is really doing, as far as the plugin can see. The request itself reports no percentage, so these
 * are only the events that are facts: a request was sent, the answer started to arrive (and how much of it has), the
 * answer is complete. `AiProviderService.observe` publishes them; the dialogs turn them into one honest line.
 */
export type AiActivity = { kind: "sending" } | { kind: "receiving"; chars: number } | { kind: "received" };

export type AiActivityListener = (activity: AiActivity) => void;
