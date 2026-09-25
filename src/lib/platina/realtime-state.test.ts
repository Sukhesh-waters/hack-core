import { describe, expect, it } from "vitest";
import { MAX_SUBSCRIBE_ATTEMPTS, nextLiveState } from "./realtime-state";

describe("nextLiveState", () => {
  it("goes live on a successful join and resets the counter", () => {
    expect(nextLiveState({ status: "SUBSCRIBED", attempts: 2 })).toEqual({
      state: "live",
      attempts: 0,
      detail: null,
    });
  });

  it("retries a failed join, keeping the reason", () => {
    const out = nextLiveState({
      status: "CHANNEL_ERROR",
      attempts: 0,
      reason: "unauthorized",
    });
    expect(out).toEqual({ state: "reconnecting", attempts: 1, detail: "unauthorized" });
  });

  it("stops claiming a transport after the retry budget, and says why", () => {
    let attempts = 0;
    let state = "reconnecting";
    let detail: string | null = null;
    for (let i = 0; i < MAX_SUBSCRIBE_ATTEMPTS; i++) {
      const out = nextLiveState({ status: "TIMED_OUT", attempts, reason: "no route" });
      attempts = out.attempts;
      state = out.state;
      detail = out.detail;
    }
    // The bug this replaces: "Reconnecting" forever, with no reason anywhere.
    expect(state).toBe("polling");
    expect(detail).toBe("no route");
  });

  it("falls back to the raw status when the transport gives no message", () => {
    expect(nextLiveState({ status: "CHANNEL_ERROR", attempts: 0 }).detail).toBe(
      "CHANNEL_ERROR",
    );
  });

  it("treats a deliberate close as polling, not as a failure to report", () => {
    expect(nextLiveState({ status: "CLOSED", attempts: 1 })).toEqual({
      state: "polling",
      attempts: 1,
      detail: null,
    });
  });

  it("respects a caller-supplied retry budget", () => {
    expect(nextLiveState({ status: "CHANNEL_ERROR", attempts: 0, maxAttempts: 1 }).state).toBe(
      "polling",
    );
  });
});

describe("refresh policy", () => {
  it("polls slowly while live, fast without realtime, never while hidden", async () => {
    const { pollIntervalMs, POLL_WHILE_LIVE_MS, POLL_WITHOUT_LIVE_MS } = await import("./realtime-state");
    expect(pollIntervalMs("live", true)).toBe(POLL_WHILE_LIVE_MS);
    expect(pollIntervalMs("polling", true)).toBe(POLL_WITHOUT_LIVE_MS);
    expect(pollIntervalMs("reconnecting", true)).toBe(POLL_WITHOUT_LIVE_MS);
    expect(pollIntervalMs("live", false)).toBeNull();
    expect(POLL_WHILE_LIVE_MS).toBeGreaterThan(POLL_WITHOUT_LIVE_MS);
  });

  it("catches up on return only when something was missed or the data is old", async () => {
    const { refreshOnVisible } = await import("./realtime-state");
    expect(refreshOnVisible({ state: "live", missedSignal: true, msSinceLastRefresh: 1_000 })).toBe(true);
    expect(refreshOnVisible({ state: "live", missedSignal: false, msSinceLastRefresh: 5_000 })).toBe(false);
    expect(refreshOnVisible({ state: "polling", missedSignal: false, msSinceLastRefresh: 25_000 })).toBe(true);
  });
});

describe("the e2e convergence window still proves realtime", () => {
  it("is shorter than the safety poll while live", async () => {
    const { POLL_WHILE_LIVE_MS } = await import("./realtime-state");
    // e2e/platina/realtime-convergence.spec.ts waits 25 s.
    expect(POLL_WHILE_LIVE_MS).toBeGreaterThan(25_000 * 4);
  });
});
