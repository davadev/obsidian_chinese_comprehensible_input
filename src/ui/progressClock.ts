/**
 * A bar that fills while an answer is awaited. The request reports no progress, so this is a clock, not a measurement: it
 * rises quickly at first and slows towards 95%, so it never reaches the end before the answer does, and it shows the
 * seconds so a slow answer still looks alive. Returns the function that stops it; the caller must call that when the
 * screen is replaced or closed so no timer outlives it.
 */
export function startProgressClock(parent: HTMLElement): () => void {
  const wrap = parent.createDiv({ cls: "cci-explain-progress" });
  const bar = wrap.createEl("progress");
  bar.max = 100;
  bar.value = 0;
  const label = wrap.createSpan({ cls: "cci-explain-muted", text: "0 s" });
  const started = Date.now();
  const tick = window.setInterval(() => {
    const seconds = (Date.now() - started) / 1000;
    bar.value = 95 * (1 - Math.exp(-seconds / 22));
    label.setText(`${Math.floor(seconds)} s`);
  }, 250);
  return () => window.clearInterval(tick);
}
