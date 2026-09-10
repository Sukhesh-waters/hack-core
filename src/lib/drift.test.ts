import { describe, expect, it } from "vitest";
import { computeDrift, DRIFT_MIN_N, summarizeDriftAcrossClients } from "./drift";

describe("computeDrift", () => {
  it("below DRIFT_MIN_N returns insufficient_data", () => {
    const result = computeDrift({ total: DRIFT_MIN_N - 1, flagged: 0 });
    expect(result).toEqual({
      status: "insufficient_data",
      sampleSize: DRIFT_MIN_N - 1,
    });
  });

  it("zero flagged rate is steady with no callout", () => {
    const result = computeDrift({ total: 20, flagged: 0 });
    expect(result).toMatchObject({
      status: "scored",
      flaggedRate: 0,
      magnitude: 0,
      narrative: "steady",
      thresholdCallout: false,
    });
  });

  it("crossing the warn threshold (20%) is drifting with a callout", () => {
    const result = computeDrift({ total: 20, flagged: 4 }); // 20%
    expect(result).toMatchObject({
      flaggedRate: 0.2,
      magnitude: 20,
      narrative: "drifting",
      thresholdCallout: true,
    });
  });

  it("just below the warn threshold is still steady", () => {
    const result = computeDrift({ total: 20, flagged: 3 }); // 15%
    expect(result).toMatchObject({ narrative: "steady", thresholdCallout: false });
  });

  it("crossing the alert threshold (40%) needs attention", () => {
    const result = computeDrift({ total: 20, flagged: 8 }); // 40%
    expect(result).toMatchObject({
      flaggedRate: 0.4,
      narrative: "needs attention",
      thresholdCallout: true,
    });
  });
});

describe("summarizeDriftAcrossClients (V3 Marketing OS overview)", () => {
  it("all clients below DRIFT_MIN_N: no worst narrative, everyone insufficient", () => {
    const summary = summarizeDriftAcrossClients([
      { clientName: "Acme", result: computeDrift({ total: 2, flagged: 0 }) },
      { clientName: "Beta", result: computeDrift({ total: 0, flagged: 0 }) },
    ]);
    expect(summary).toEqual({
      worstNarrative: null,
      worstClientName: null,
      scoredCount: 0,
      insufficientCount: 2,
    });
  });

  it("picks the highest-severity client as worst, ignoring insufficient ones", () => {
    const summary = summarizeDriftAcrossClients([
      { clientName: "Steady Co", result: computeDrift({ total: 20, flagged: 0 }) },
      {
        clientName: "Needs Attention Co",
        result: computeDrift({ total: 20, flagged: 8 }), // 40%
      },
      { clientName: "Too New", result: computeDrift({ total: 1, flagged: 0 }) },
      {
        clientName: "Drifting Co",
        result: computeDrift({ total: 20, flagged: 4 }), // 20%
      },
    ]);
    expect(summary).toEqual({
      worstNarrative: "needs attention",
      worstClientName: "Needs Attention Co",
      scoredCount: 3,
      insufficientCount: 1,
    });
  });

  it("empty input is safe (no clients yet)", () => {
    expect(summarizeDriftAcrossClients([])).toEqual({
      worstNarrative: null,
      worstClientName: null,
      scoredCount: 0,
      insufficientCount: 0,
    });
  });

  it("ties keep the first client encountered", () => {
    const summary = summarizeDriftAcrossClients([
      { clientName: "First", result: computeDrift({ total: 20, flagged: 8 }) },
      { clientName: "Second", result: computeDrift({ total: 20, flagged: 8 }) },
    ]);
    expect(summary.worstClientName).toBe("First");
  });
});
