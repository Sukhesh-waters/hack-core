import { afterEach, describe, expect, it } from "vitest";
import {
  getCircuitState,
  isCallAllowed,
  recordFailure,
  recordSuccess,
  resetAllCircuits,
} from "./circuit-breaker";

afterEach(() => resetAllCircuits());

describe("circuit-breaker", () => {
  it("starts in closed state — calls allowed", () => {
    expect(getCircuitState("posts")).toBe("closed");
    expect(isCallAllowed("posts")).toBe(true);
  });

  it("stays closed after fewer than threshold failures", () => {
    recordFailure("posts");
    recordFailure("posts");
    expect(getCircuitState("posts")).toBe("closed");
    expect(isCallAllowed("posts")).toBe(true);
  });

  it("opens after threshold consecutive failures", () => {
    recordFailure("posts");
    recordFailure("posts");
    recordFailure("posts");
    expect(getCircuitState("posts")).toBe("open");
    expect(isCallAllowed("posts")).toBe(false);
  });

  it("success resets failure counter to closed", () => {
    recordFailure("posts");
    recordFailure("posts");
    recordSuccess("posts");
    expect(getCircuitState("posts")).toBe("closed");
    // Two more failures shouldn't open (counter was reset)
    recordFailure("posts");
    recordFailure("posts");
    expect(getCircuitState("posts")).toBe("closed");
  });

  it("transitions open → half_open after reset timeout", () => {
    const now = 1_000_000;
    recordFailure("posts", undefined, now);
    recordFailure("posts", undefined, now);
    recordFailure("posts", undefined, now);
    expect(getCircuitState("posts")).toBe("open");

    // Before timeout: still blocked
    expect(isCallAllowed("posts", undefined, now + 100_000)).toBe(false);

    // After timeout: allowed (half_open probe)
    expect(isCallAllowed("posts", undefined, now + 300_001)).toBe(true);
    expect(getCircuitState("posts")).toBe("half_open");
  });

  it("half_open probe success closes the circuit", () => {
    const now = 1_000_000;
    recordFailure("posts", undefined, now);
    recordFailure("posts", undefined, now);
    recordFailure("posts", undefined, now);

    // Transition to half_open
    isCallAllowed("posts", undefined, now + 300_001);
    // Probe succeeds
    recordSuccess("posts");
    expect(getCircuitState("posts")).toBe("closed");
    expect(isCallAllowed("posts")).toBe(true);
  });

  it("half_open probe failure re-opens the circuit", () => {
    const now = 1_000_000;
    recordFailure("posts", undefined, now);
    recordFailure("posts", undefined, now);
    recordFailure("posts", undefined, now);

    // Transition to half_open
    isCallAllowed("posts", undefined, now + 300_001);
    // Probe fails
    recordFailure("posts", undefined, now + 300_002);
    expect(getCircuitState("posts")).toBe("open");
  });

  it("isolates circuits per actor key", () => {
    recordFailure("posts");
    recordFailure("posts");
    recordFailure("posts");
    expect(getCircuitState("posts")).toBe("open");
    expect(getCircuitState("reels")).toBe("closed");
    expect(isCallAllowed("reels")).toBe(true);
  });

  it("respects custom threshold and timeout", () => {
    const config = { failureThreshold: 2, resetTimeoutMs: 60_000 };
    const now = 1_000_000;

    recordFailure("custom", config, now);
    expect(getCircuitState("custom")).toBe("closed");
    recordFailure("custom", config, now);
    expect(getCircuitState("custom")).toBe("open");

    // Custom 60s timeout
    expect(isCallAllowed("custom", config, now + 59_999)).toBe(false);
    expect(isCallAllowed("custom", config, now + 60_001)).toBe(true);
  });
});
