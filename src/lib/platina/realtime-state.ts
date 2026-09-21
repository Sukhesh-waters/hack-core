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
