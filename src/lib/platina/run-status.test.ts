import { describe, expect, it } from "vitest";
import {
  canTransition,
  DEFAULT_STALE_AFTER_MS,
  freshnessState,
  isTerminal,
  RUN_STATUSES,
  RUN_TRANSITIONS,
} from "./run-status";

describe("audit-run state machine", () => {
  it("walks the happy path queued → running → validating → completed", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "validating")).toBe(true);
    expect(canTransition("validating", "completed")).toBe(true);
  });

  it("allows degradation and failure from active states", () => {
    expect(canTransition("running", "degraded")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("validating", "degraded")).toBe(true);
    expect(canTransition("validating", "failed")).toBe(true);
    expect(canTransition("queued", "failed")).toBe(true);
  });

  it("forbids skipping states and going backwards", () => {
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("queued", "validating")).toBe(false);
    expect(canTransition("running", "queued")).toBe(false);
    expect(canTransition("validating", "running")).toBe(false);
  });

  it("locks terminal states — a finished run never reopens", () => {
    for (const terminal of ["completed", "degraded", "failed"] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(RUN_TRANSITIONS[terminal]).toEqual([]);
      for (const status of RUN_STATUSES) {
        expect(canTransition(terminal, status)).toBe(false);
      }
    }
  });

  it("covers every declared status in the transition map", () => {
    for (const status of RUN_STATUSES) {
      expect(RUN_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe("freshness", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("is unknown when a source has never succeeded", () => {
    expect(freshnessState(null, now)).toBe("unknown");
  });

  it("is fresh inside the staleness window", () => {
    const recent = new Date(now.getTime() - 5 * 60_000);
    expect(freshnessState(recent, now)).toBe("fresh");
  });

  it("is stale beyond the window", () => {
    const old = new Date(now.getTime() - DEFAULT_STALE_AFTER_MS - 1000);
    expect(freshnessState(old, now)).toBe("stale");
  });
});
