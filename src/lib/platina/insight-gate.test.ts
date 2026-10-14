import { describe, expect, it } from "vitest";
import { NOT_ENOUGH_DATA_REASON, NOT_SIGNIFICANT_REASON, gateInsight, type GateInput } from "./insight-gate";

const base: GateInput = {
  interrogation: { ok: true, value: { headline: "h", what: "w", why: ["e1"], how: "how", kind: "claim", falsifier: null, confidence: "medium" } },
  falsifier: { metric: "topic_momentum" },
  testability: { n: 10, minN: 5 },
  significance: { significant: true, reason: "p=0.02 is below the 0.1 significance level" },
  resolveState: "agreed",
};

describe("gateInsight — passes with no reasons", () => {
  it("passes when schema is valid, there is enough data and the trend is significant", () => {
    expect(gateInsight(base)).toEqual({ pass: true, reasons: [] });
  });

  it("passes with no testability/significance at all (a fact: nothing to test)", () => {
    expect(gateInsight({ ...base, falsifier: null, testability: null, significance: undefined })).toEqual({
      pass: true,
      reasons: [],
    });
  });
});

describe("gateInsight — schema validity (B1's own verdict)", () => {
  it("refuses when the interrogation itself failed validation", () => {
    const result = gateInsight({
      ...base,
      interrogation: { ok: false, reason: "The claim could not be tested: it cites no evidence from the input." },
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("The claim could not be tested: it cites no evidence from the input.");
  });
});

describe("gateInsight — testability (min-N)", () => {
  it("refuses when the segment has fewer observations than the metric's minN", () => {
    const result = gateInsight({ ...base, testability: { n: 2, minN: 5 } });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual([NOT_ENOUGH_DATA_REASON]);
  });

  it("passes at exactly minN", () => {
    expect(gateInsight({ ...base, testability: { n: 5, minN: 5 } }).pass).toBe(true);
  });

  it("is skipped (never a reason) when there is nothing to test (testability: null)", () => {
    expect(gateInsight({ ...base, testability: null }).pass).toBe(true);
  });
});

describe("gateInsight — significance (apophenia)", () => {
  it("refuses a trend that does not clear the significance test", () => {
    const result = gateInsight({
      ...base,
      significance: { significant: false, reason: "not clearly different from usual: p=0.4 is at or above 0.1" },
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual([NOT_SIGNIFICANT_REASON]);
  });

  it("uses the 'not enough data' wording when the significance test itself was below min-N", () => {
    const result = gateInsight({ ...base, significance: { significant: false, reason: "not enough data" } });
    expect(result.reasons).toEqual([NOT_ENOUGH_DATA_REASON]);
  });

  it("is skipped (never a reason) when the caller omits it (not a trend claim)", () => {
    expect(gateInsight({ ...base, significance: undefined }).pass).toBe(true);
  });
});

describe("gateInsight — multiple reasons, and the agreement-state invariant", () => {
  it("reports every failing check, not just the first", () => {
    const result = gateInsight({
      ...base,
      testability: { n: 1, minN: 5 },
      significance: { significant: false, reason: "not clearly different from usual: p=0.5 is at or above 0.1" },
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual([NOT_ENOUGH_DATA_REASON, NOT_SIGNIFICANT_REASON]);
  });

  it("a refusal holds regardless of resolveState — 'agreed' never overrides it", () => {
    const failing = { ...base, testability: { n: 1, minN: 5 } };
    for (const resolveState of ["agreed", "qualified", "contested", "refuted"] as const) {
      expect(gateInsight({ ...failing, resolveState }).pass).toBe(false);
    }
  });

  it("a pass holds regardless of resolveState too — the gate does not read it either way", () => {
    for (const resolveState of ["agreed", "qualified", "contested", "refuted"] as const) {
      expect(gateInsight({ ...base, resolveState }).pass).toBe(true);
    }
  });
});
