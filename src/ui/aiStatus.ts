import type { AiActivity, AiActivityListener } from "../ai/aiActivity";

/** What the dialog knows right now. `request` counts the requests sent since the dialog started working. */
interface AiStatusState {
  request: number;
  phase: "waiting" | "receiving" | "checking";
  chars: number;
}

/**
 * One line that says only what is known: the request is out and the clock is running, or the answer is arriving and
 * this much of it is here, or it is here and being checked. No percentage and no promised duration, because neither is
 * known. Where the answer does not stream (phones, a server that does not stream) the line stays at "waiting" with the
 * seconds, which is the whole truth there.
 */
export function describeAiStatus(state: AiStatusState, provider: "openai" | "ollama", seconds: number): string {
  const who = provider === "openai" ? "OpenAI" : "your Ollama server";
  const which = state.request > 1 ? `Request ${state.request}` : "Request";
  if (state.phase === "receiving") return `${which}: ${who} is answering… ${state.chars} characters so far.`;
  if (state.phase === "checking") return `${which}: the answer is here, checking it…`;
  return `${which} sent to ${who}. Waiting for the answer… ${seconds} s`;
}

/**
 * Shows the status line (with a pulsing dot) in `parent` and keeps it current from the service's activity events and a
 * one-second clock. Returns the function that stops it; the caller must call that when the screen is replaced or closed,
 * so no timer or listener outlives it.
 */
export function startAiStatus(
  parent: HTMLElement,
  ai: { observe(listener: AiActivityListener): () => void },
  provider: "openai" | "ollama"
): () => void {
  const wrap = parent.createDiv({ cls: "cci-ai-status" });
  wrap.setAttribute("aria-live", "polite");
  wrap.createSpan({ cls: "cci-ai-status-dot" });
  const label = wrap.createSpan({ cls: "cci-explain-muted" });
  const state: AiStatusState = { request: 1, phase: "waiting", chars: 0 };
  /** A request finished, so the next one sent is another request, not a retry of the same one. */
  let finished = false;
  let sentAt = Date.now();
  const paint = () => label.setText(describeAiStatus(state, provider, Math.floor((Date.now() - sentAt) / 1000)));
  const off = ai.observe((a: AiActivity) => {
    if (a.kind === "sending") {
      if (finished) state.request++;
      finished = false;
      state.phase = "waiting";
      state.chars = 0;
      sentAt = Date.now();
    } else if (a.kind === "receiving") {
      state.phase = "receiving";
      state.chars = a.chars;
    } else {
      state.phase = "checking";
      finished = true;
    }
    paint();
  });
  paint();
  const tick = window.setInterval(paint, 1000);
  return () => {
    window.clearInterval(tick);
    off();
  };
}
