import { normalizePath } from "obsidian";

/**
 * Crash protection state.
 *
 * A plugin that crashes Obsidian during load can make a vault unusable: the
 * user cannot reach Settings to disable it because the app dies first. So each
 * launch increments a counter before doing anything risky, and a launch that
 * survives 30 seconds resets it. Enough consecutive failures and the plugin
 * disables itself, which is recoverable through Community plugins.
 *
 * WHY ITS OWN FILE, AND NOT data.json
 *
 * The counter used to live in the main data blob, so every launch parsed
 * ~4.8 MB, wrote ~3.2 MB back, then parsed the same file again — and the
 * 30-second reset repeated the parse and the write. Three parses and two
 * multi-megabyte writes, all before Obsidian shows the ribbon icon, to store
 * one integer that is 0 before and 0 after. On a synced vault it also
 * re-uploaded the blob on every launch of every device. This file is ~30 bytes.
 *
 * WHY NOT localStorage, WHICH WOULD BE FASTER STILL
 *
 * The increment has to be DURABLE before the risky work runs, or the mechanism
 * cannot see the crash it exists to catch. `localStorage.setItem` returns
 * before its backing store is flushed, so a crash in that window loses the
 * increment — exactly the case this guards. An awaited adapter write does not
 * have that hole, so the write stays awaited; only its size changed.
 */
export interface CrashState {
  counter: number;
  autoDisabled: boolean;
}

export const CRASH_STATE_FILE = "crash-state.json";

export type CrashAction = "clear-auto-disable" | "trip-threshold" | "proceed";

export interface CrashDecision {
  action: CrashAction;
  /** State to persist before acting. Always write this, then act. */
  next: CrashState;
}

/** Minimal slice of Obsidian's DataAdapter this module needs. */
export interface CrashStateAdapter {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const DEFAULT_CRASH_STATE: CrashState = { counter: 0, autoDisabled: false };

/**
 * Where the state file lives.
 *
 * `manifest.dir` is optional in Obsidian's API (obsidian.d.ts), so falling back
 * to the config dir keeps this from resolving to "undefined/crash-state.json"
 * on any install where it is unset.
 */
export function crashStatePath(
  manifest: { dir?: string; id: string },
  configDir: string
): string {
  const dir = manifest.dir ?? `${configDir}/plugins/${manifest.id}`;
  return normalizePath(`${dir}/${CRASH_STATE_FILE}`);
}

/**
 * What to do with the state we just read. Pure — no I/O, no side effects — so
 * every branch of a mechanism that can disable the plugin is directly testable.
 *
 * `counter` is the count of launches that have NOT yet proven themselves. The
 * comparison is `> threshold` on the incremented value, matching the behaviour
 * this replaced.
 */
export function decideOnLoad(state: CrashState, threshold: number): CrashDecision {
  if (state.autoDisabled) {
    // Cleared on the way past so a deliberate re-enable starts fresh.
    return { action: "clear-auto-disable", next: { counter: 0, autoDisabled: false } };
  }
  const counter = state.counter + 1;
  if (counter > threshold) {
    return { action: "trip-threshold", next: { counter: 0, autoDisabled: true } };
  }
  return { action: "proceed", next: { counter, autoDisabled: false } };
}

/** Shape-check a parsed file so a hand-edited or truncated one cannot inject
 *  NaN into the counter and break the comparison silently. */
function coerce(raw: unknown): CrashState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CRASH_STATE };
  const o = raw as Record<string, unknown>;
  const counter = typeof o.counter === "number" && Number.isFinite(o.counter) && o.counter >= 0
    ? Math.floor(o.counter)
    : 0;
  return { counter, autoDisabled: o.autoDisabled === true };
}

/**
 * Read the state, failing OPEN.
 *
 * Missing, unreadable, corrupt — all resolve to a zeroed state so the plugin
 * still loads. A broken crash-state file must never be able to stop startup,
 * which is the same posture the previous try/catch had.
 */
export async function readCrashState(
  adapter: CrashStateAdapter,
  path: string
): Promise<CrashState> {
  try {
    if (!(await adapter.exists(path))) return { ...DEFAULT_CRASH_STATE };
    return coerce(JSON.parse(await adapter.read(path)));
  } catch (e) {
    console.warn("CCI crash-state read failed; treating as clean", e);
    return { ...DEFAULT_CRASH_STATE };
  }
}

/**
 * Persist the state, failing OPEN.
 *
 * Returns whether the write landed. A false means the counter did not advance,
 * so a genuine crash loop would go uncounted — the same exposure the previous
 * implementation had when `saveData` threw, and still preferable to refusing
 * to load.
 */
export async function writeCrashState(
  adapter: CrashStateAdapter,
  path: string,
  state: CrashState
): Promise<boolean> {
  try {
    await adapter.write(path, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn("CCI crash-state write failed", e);
    return false;
  }
}
