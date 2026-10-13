import { describe, expect, it } from "vitest";
import { BASELINE_DAYS, MIN_INTEREST_N, RECENT_DAYS } from "./measurement-scales";
import * as interestReExports from "./interest";

describe("measurement-scales (coastline rule, Brain plan B0)", () => {
  it("declares the current scale", () => {
    expect(MIN_INTEREST_N).toBe(5);
    expect(RECENT_DAYS).toBe(30);
    expect(BASELINE_DAYS).toBe(90);
  });

  it("interest.ts re-exports the exact same values — a guard against the two drifting apart", () => {
    expect(interestReExports.MIN_INTEREST_N).toBe(MIN_INTEREST_N);
    expect(interestReExports.RECENT_DAYS).toBe(RECENT_DAYS);
    expect(interestReExports.BASELINE_DAYS).toBe(BASELINE_DAYS);
  });
});
