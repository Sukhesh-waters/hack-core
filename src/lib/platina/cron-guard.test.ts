import { describe, expect, it } from "vitest";
import { BURST_WINDOW_MS, CRON_EVENT, HOUR, MINUTE, isReplayedTick } from "./cron-guard";

const job = (runId: string, minGapMs = 4 * MINUTE) => ({
  jobId: "platina-scan-coordinator",
  eventName: CRON_EVENT,
  runId,
  minGapMs,
});

describe("isReplayedTick", () => {
  it("runs the first tick after start-up and skips the replays behind it", () => {
    const store = new Map();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    expect(isReplayedTick(job("r1"), t0, store)).toBe(false);
    expect(isReplayedTick(job("r2"), t0 + 200, store)).toBe(true);
    expect(isReplayedTick(job("r3"), t0 + 2 * MINUTE, store)).toBe(true);
  });

  it("defaults to BURST_WINDOW_MS (15 min) so start-up bursts are blocked without locking out the day", () => {
    const store = new Map();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    const daily = (runId: string) => ({ jobId: "platina-brand-refresh", eventName: CRON_EVENT, runId });
    expect(isReplayedTick(daily("r1"), t0, store)).toBe(false);
    expect(isReplayedTick(daily("r2"), t0 + 5 * MINUTE, store)).toBe(true);
    expect(isReplayedTick(daily("r3"), t0 + BURST_WINDOW_MS + 1, store)).toBe(false);
  });

  it("lets the next on-time tick through once the gap has passed", () => {
    const store = new Map();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    isReplayedTick(job("r1"), t0, store);
    expect(isReplayedTick(job("r2"), t0 + 5 * MINUTE, store)).toBe(false);
  });

  it("never skips the same run when it is re-invoked for its next step", () => {
    const store = new Map();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    isReplayedTick(job("r1"), t0, store);
    expect(isReplayedTick(job("r1"), t0 + 30_000, store)).toBe(false);
  });

  it("never skips an event-triggered run", () => {
    const store = new Map();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    isReplayedTick(job("r1", 20 * HOUR), t0, store);
    expect(
      isReplayedTick(
        { ...job("r2", 20 * HOUR), eventName: "platina/interest.extract.requested" },
        t0 + MINUTE,
        store,
      ),
    ).toBe(false);
  });

  it("keeps jobs independent", () => {
    const store = new Map();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 0);
    isReplayedTick(job("r1"), t0, store);
    expect(isReplayedTick({ ...job("r2"), jobId: "platina-alert-sweep" }, t0, store)).toBe(false);
  });
});
