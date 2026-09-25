/**
 * The live-transport state machine (core spine R6). Pure, so the header pill's
 * honesty is a test rather than a hope.
 *
 * The rule: the pill never claims a transport that is not connected, and it
 * never sits on "Reconnecting" forever. After a bounded number of failed
 * joins it settles on "Polling" and keeps the reason, which the tooltip and
 * the health page show. Polling runs in every state, so correctness never
 * depends on any of this.
 */
export type PlatinaLiveState = "live" | "reconnecting" | "polling";

export type SubscribeStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED";

/** Failed joins before the pill stops claiming a transport it cannot get. */
export const MAX_SUBSCRIBE_ATTEMPTS = 3;

export function nextLiveState(input: {
  status: SubscribeStatus;
  attempts: number;
  reason?: string | null;
  maxAttempts?: number;
}): { state: PlatinaLiveState; attempts: number; detail: string | null } {
  const max = input.maxAttempts ?? MAX_SUBSCRIBE_ATTEMPTS;

  if (input.status === "SUBSCRIBED") {
    // Connected: the counter resets, so a later blip gets its full retries.
    return { state: "live", attempts: 0, detail: null };
  }

  if (input.status === "CLOSED") {
    // A deliberate close (navigation, unmount) is not a failure.
    return { state: "polling", attempts: input.attempts, detail: null };
  }

  const attempts = input.attempts + 1;
  const detail = input.reason ?? input.status;
  return {
    state: attempts >= max ? "polling" : "reconnecting",
    attempts,
    detail,
  };
}

// ---------------------------------------------------------------------------
// Refresh policy (render cost)
// ---------------------------------------------------------------------------

/**
 * Every refresh re-runs ALL of the page's server queries (~70 ms per database
 * round trip, 1-4 rounds per page). Measured 2026-09-22: the header pill
 * refreshed every 20 s on every page even while the realtime channel was
 * live and even in background tabs, and each broadcast in a burst (an audit
 * run emits several) triggered its own refresh.
 *
 * The policy: poll fast only when realtime cannot be trusted; poll slowly as
 * a safety net while it is live; never poll a hidden tab (catch up when it
 * becomes visible); coalesce a burst of signals into one refresh.
 */
export const POLL_WHILE_LIVE_MS = 120_000;
export const POLL_WITHOUT_LIVE_MS = 20_000;
/** Signals closer together than this become one refresh. */
export const SIGNAL_COALESCE_MS = 800;

export function pollIntervalMs(state: PlatinaLiveState, visible: boolean): number | null {
  if (!visible) return null;
  return state === "live" ? POLL_WHILE_LIVE_MS : POLL_WITHOUT_LIVE_MS;
}

/**
 * On becoming visible: refresh only if a signal arrived while hidden, or the
 * last refresh is older than the poll interval that would have applied.
 */
export function refreshOnVisible(input: {
  state: PlatinaLiveState;
  missedSignal: boolean;
  msSinceLastRefresh: number;
}): boolean {
  if (input.missedSignal) return true;
  return input.msSinceLastRefresh >= (pollIntervalMs(input.state, true) ?? POLL_WITHOUT_LIVE_MS);
}
