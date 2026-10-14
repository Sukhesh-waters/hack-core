import { describe, expect, it, vi } from "vitest";
import {
  FALSIFIER_METRIC_IDS,
  FALSIFIER_METRICS,
  ScaleMismatchError,
  aggregateMetric,
  assertFalsifiableClaim,
  compareMeasurements,
  measureMetric,
  subjectKeyFor,
  validateFalsifier,
  type FalsifierClaim,
  type FalsifierMetricDef,
  type FalsifierMetricId,
  type MeasureDeps,
  type Measurement,
  type Observation,
} from "./falsifier-metrics";

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);
const obs = (value: number, ageDays: number): Observation => ({ value, observedAt: daysAgo(ageDays) });

// ---------------------------------------------------------------------------
// Registry completeness
// ---------------------------------------------------------------------------

describe("registry completeness", () => {
  it("FALSIFIER_METRIC_IDS and FALSIFIER_METRICS agree", () => {
    expect(Object.keys(FALSIFIER_METRICS).sort()).toEqual([...FALSIFIER_METRIC_IDS].sort());
  });

  it("every metric has a label, plane, non-empty segment and windows, minN >= 1, scaleVersion >= 1", () => {
    for (const id of FALSIFIER_METRIC_IDS) {
      const def = FALSIFIER_METRICS[id];
      expect(def.label.length, `${id}: label`).toBeGreaterThan(0);
      expect(["A", "B"], `${id}: plane`).toContain(def.plane);
      expect(def.segment.length, `${id}: segment`).toBeGreaterThan(0);
      expect(def.windows.length, `${id}: windows`).toBeGreaterThan(0);
      expect(def.minN, `${id}: minN`).toBeGreaterThanOrEqual(1);
      expect(def.scaleVersion, `${id}: scaleVersion`).toBeGreaterThanOrEqual(1);
      expect(def.unit.length, `${id}: unit`).toBeGreaterThan(0);
    }
  });

  it("every window is a positive integer", () => {
    for (const id of FALSIFIER_METRIC_IDS) {
      for (const w of FALSIFIER_METRICS[id].windows) {
        expect(Number.isInteger(w), `${id}: ${w}`).toBe(true);
        expect(w).toBeGreaterThan(0);
      }
    }
  });

  it("does not declare active_ads: no code path writes that metric today", () => {
    expect((FALSIFIER_METRIC_IDS as readonly string[]).includes("active_ads")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// aggregateMetric
// ---------------------------------------------------------------------------

describe("aggregateMetric", () => {
  it("median: measured once minN observations fall inside the window", () => {
    const def = FALSIFIER_METRICS.engagement_index; // median, minN 5
    const rows = [1.2, 0.8, 1.5, 0.9, 1.1].map((v, i) => obs(v, i));
    expect(aggregateMetric(def, rows, 30, NOW)).toEqual({ status: "measured", value: 1.1, n: 5 });
  });

  it("median: insufficient below minN even with some observations present", () => {
    const def = FALSIFIER_METRICS.engagement_index;
    const rows = [1.2, 0.8].map((v, i) => obs(v, i));
    expect(aggregateMetric(def, rows, 30, NOW)).toEqual({ status: "insufficient", n: 2 });
  });

  it("not_measured when there are no observations at all — never a fabricated 0", () => {
    const def = FALSIFIER_METRICS.engagement_index;
    expect(aggregateMetric(def, [], 30, NOW)).toEqual({ status: "not_measured" });
  });

  it("median uses the median, not the mean: one viral outlier does not dominate", () => {
    const def = FALSIFIER_METRICS.engagement_index;
    const rows = [1, 1, 1, 1, 18.29].map((v, i) => obs(v, i)); // mirrors the Bruker-post finding noted in interest.ts
    const result = aggregateMetric(def, rows, 30, NOW);
    expect(result).toMatchObject({ status: "measured", value: 1 });
  });

  it("observations outside the window are not counted", () => {
    const def = FALSIFIER_METRICS.engagement_index;
    const rows = [1, 1, 1, 1, 1].map((v, i) => obs(v, i)).concat([obs(99, 45)]);
    expect(aggregateMetric(def, rows, 30, NOW)).toEqual({ status: "measured", value: 1, n: 5 });
  });

  it("count: event_participants counts proofs, gated at minN 1", () => {
    const def = FALSIFIER_METRICS.event_participants;
    expect(aggregateMetric(def, [obs(1, 1), obs(1, 2)], 30, NOW)).toEqual({ status: "measured", value: 2, n: 2 });
    expect(aggregateMetric(def, [], 30, NOW)).toEqual({ status: "not_measured" });
  });

  it("latest: a creative metric reads the most recent capture, not an average of its history", () => {
    const def = FALSIFIER_METRICS.creative_engagement_rate;
    const rows = [obs(0.01, 20), obs(0.05, 2), obs(0.02, 10)];
    expect(aggregateMetric(def, rows, 30, NOW)).toEqual({ status: "measured", value: 0.05, n: 3 });
  });

  it("sum: totals every observation in the window", () => {
    const def: FalsifierMetricDef = { ...FALSIFIER_METRICS.creative_leads, aggregation: "sum", minN: 1 };
    const rows = [obs(3, 1), obs(4, 10), obs(2, 20)];
    expect(aggregateMetric(def, rows, 30, NOW)).toEqual({ status: "measured", value: 9, n: 3 });
  });

  it("ratio_of_medians: topic_momentum compares the recent window to the baseline window right after it", () => {
    const def = FALSIFIER_METRICS.topic_momentum; // windows [30], baseline fixed at BASELINE_DAYS (90) after
    const recent = [1.4, 1.6, 1.5, 1.5, 1.5].map((v, i) => obs(v, i)); // ages 0-4: within [0,30]
    const baseline = [1.0, 1.0, 1.0, 1.0, 1.0].map((v, i) => obs(v, 31 + i)); // ages 31-35: within (30,120]
    expect(aggregateMetric(def, [...recent, ...baseline], 30, NOW)).toEqual({ status: "measured", value: 1.5, n: 10 });
  });

  it("ratio_of_medians: insufficient when the baseline leg is empty, even if recent alone clears minN", () => {
    const def = FALSIFIER_METRICS.topic_momentum;
    const recent = [1, 1, 1, 1, 1].map((v, i) => obs(v, i));
    expect(aggregateMetric(def, recent, 30, NOW)).toEqual({ status: "insufficient", n: 5 });
  });

  it("ratio_of_medians: insufficient when the combined n is below minN", () => {
    const def = FALSIFIER_METRICS.topic_momentum;
    const rows = [obs(1, 1), obs(1, 2), obs(1, 40)];
    expect(aggregateMetric(def, rows, 30, NOW)).toEqual({ status: "insufficient", n: 3 });
  });

  it("ratio_of_medians: insufficient (never a divide-by-zero fabrication) when the baseline median is 0", () => {
    const def = FALSIFIER_METRICS.topic_momentum;
    const recent = [1, 1, 1, 1, 1].map((v, i) => obs(v, i));
    const baseline = [0, 0, 0, 0, 0].map((v, i) => obs(v, 31 + i));
    expect(aggregateMetric(def, [...recent, ...baseline], 30, NOW)).toEqual({ status: "insufficient", n: 10 });
  });
});

// ---------------------------------------------------------------------------
// compareMeasurements
// ---------------------------------------------------------------------------

describe("compareMeasurements", () => {
  const base: Measurement = {
    metric: "engagement_index",
    scaleVersion: 1,
    windowDays: 30,
    segment: { brand: "b1", topic: "pfas analysis" },
    value: 1.2,
    n: 8,
  };

  it("computes delta and ratio on matching scales", () => {
    expect(compareMeasurements(base, { ...base, value: 1.5, n: 9 })).toEqual({ delta: 0.3, ratio: 1.25 });
  });

  it("ratio is null when the earlier value is 0 (never a divide by zero)", () => {
    expect(compareMeasurements({ ...base, value: 0 }, { ...base, value: 1 })).toEqual({ delta: 1, ratio: null });
  });

  it("throws ScaleMismatchError on a different metric", () => {
    expect(() => compareMeasurements(base, { ...base, metric: "ad_days_running" })).toThrow(ScaleMismatchError);
  });

  it("throws ScaleMismatchError on a different scale version", () => {
    expect(() => compareMeasurements(base, { ...base, scaleVersion: 2 })).toThrow(ScaleMismatchError);
  });

  it("throws ScaleMismatchError on a different window", () => {
    expect(() => compareMeasurements(base, { ...base, windowDays: 90 })).toThrow(ScaleMismatchError);
  });

  it("throws ScaleMismatchError on a different segment", () => {
    expect(() => compareMeasurements(base, { ...base, segment: { brand: "b2", topic: "pfas analysis" } })).toThrow(
      ScaleMismatchError,
    );
  });
});

// ---------------------------------------------------------------------------
// validateFalsifier
// ---------------------------------------------------------------------------

describe("validateFalsifier", () => {
  const valid: Record<FalsifierMetricId, FalsifierClaim> = {
    engagement_index: { metric: "engagement_index", subject: { brand: "b1", topic: "pfas analysis" }, direction: "above", threshold: 1, window_days: 30 },
    topic_momentum: { metric: "topic_momentum", subject: { topic: "pfas analysis" }, direction: "below", threshold: 1, window_days: 30 },
    ad_days_running: { metric: "ad_days_running", subject: { brand: "comp1", topic: "pfas analysis" }, direction: "above", threshold: 30, window_days: 90 },
    event_participants: { metric: "event_participants", subject: { eventId: "evt1" }, direction: "above", threshold: 0, window_days: 30 },
    creative_engagement_rate: { metric: "creative_engagement_rate", subject: { creativeId: "c1" }, direction: "below", threshold: 0.01, window_days: 30 },
    creative_ctr: { metric: "creative_ctr", subject: { creativeId: "c1" }, direction: "below", threshold: 0.01, window_days: 30 },
    creative_leads: { metric: "creative_leads", subject: { creativeId: "c1" }, direction: "above", threshold: 10, window_days: 30 },
  };

  it.each(FALSIFIER_METRIC_IDS)("accepts a well-formed falsifier for %s", (id) => {
    expect(validateFalsifier(valid[id])).toEqual({ ok: true });
  });

  it("rejects a metric this system does not measure", () => {
    const result = validateFalsifier({ ...valid.engagement_index, metric: "made_up_metric" });
    expect(result.ok).toBe(false);
  });

  it("rejects a window_days the metric doesn't declare", () => {
    const result = validateFalsifier({ ...valid.topic_momentum, window_days: 90 });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("30") });
  });

  it("rejects a direction that is neither above nor below", () => {
    const result = validateFalsifier({ ...valid.engagement_index, direction: "sideways" as FalsifierClaim["direction"] });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-finite threshold", () => {
    expect(validateFalsifier({ ...valid.engagement_index, threshold: NaN }).ok).toBe(false);
    expect(validateFalsifier({ ...valid.engagement_index, threshold: Infinity }).ok).toBe(false);
  });

  it("rejects a subject missing a required segment key", () => {
    const result = validateFalsifier({ ...valid.engagement_index, subject: { topic: "pfas analysis" } });
    expect(result.ok).toBe(false);
  });

  it("rejects when an injected resolver says the subject is not in this workspace", () => {
    const result = validateFalsifier(valid.engagement_index, { resolvesSubjectKey: () => false });
    expect(result.ok).toBe(false);
  });

  it("accepts when the injected resolver confirms the subject", () => {
    expect(validateFalsifier(valid.engagement_index, { resolvesSubjectKey: () => true })).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// measureMetric (with fake deps)
// ---------------------------------------------------------------------------

describe("measureMetric", () => {
  function fakeDeps(overrides: Partial<MeasureDeps> = {}): MeasureDeps {
    const entries = FALSIFIER_METRIC_IDS.map((id) => [id, overrides[id] ?? vi.fn().mockResolvedValue([])] as const);
    return Object.fromEntries(entries) as MeasureDeps;
  }

  it("asks its reader for from = now - windowDays, for a plain single-window metric", async () => {
    const reader = vi.fn().mockResolvedValue([{ value: 1, observedAt: NOW }]);
    const deps = fakeDeps({ engagement_index: reader });
    await measureMetric(deps, "ws1", "engagement_index", { brand: "b1", topic: "pfas analysis" }, 30, NOW);
    expect(reader).toHaveBeenCalledWith("ws1", { brand: "b1", topic: "pfas analysis" }, new Date(NOW.getTime() - 30 * DAY), NOW);
  });

  it("asks for extra lookback to cover the baseline leg of a ratio_of_medians metric", async () => {
    const reader = vi.fn().mockResolvedValue([]);
    const deps = fakeDeps({ topic_momentum: reader });
    await measureMetric(deps, "ws1", "topic_momentum", { topic: "pfas analysis" }, 30, NOW);
    expect(reader).toHaveBeenCalledWith("ws1", { topic: "pfas analysis" }, new Date(NOW.getTime() - (30 + 90) * DAY), NOW);
  });

  it("aggregates whatever the injected deps return", async () => {
    const reader = vi.fn().mockResolvedValue([1.2, 0.8, 1.5, 0.9, 1.1].map((v, i) => obs(v, i)));
    const deps = fakeDeps({ engagement_index: reader });
    const result = await measureMetric(deps, "ws1", "engagement_index", { brand: "b1", topic: "pfas analysis" }, 30, NOW);
    expect(result).toEqual({ status: "measured", value: 1.1, n: 5 });
  });

  it("throws for an unknown metric id rather than silently returning not_measured", async () => {
    const deps = fakeDeps();
    await expect(measureMetric(deps, "ws1", "nope" as FalsifierMetricId, {}, 30, NOW)).rejects.toThrow();
  });

  it("throws for a window the metric doesn't declare", async () => {
    const deps = fakeDeps();
    await expect(measureMetric(deps, "ws1", "topic_momentum", { topic: "pfas analysis" }, 90, NOW)).rejects.toThrow();
  });

  it("throws when the segment is missing a required key", async () => {
    const deps = fakeDeps();
    await expect(measureMetric(deps, "ws1", "engagement_index", { topic: "pfas analysis" }, 30, NOW)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B1 — subjectKeyFor, assertFalsifiableClaim
// ---------------------------------------------------------------------------

describe("subjectKeyFor (B1)", () => {
  it("stable key order regardless of the segment object's own key order", () => {
    expect(subjectKeyFor({ topic: "pfas analysis", brand: "Acme" })).toBe("brand:Acme|topic:pfas analysis");
    expect(subjectKeyFor({ brand: "Acme", topic: "pfas analysis" })).toBe("brand:Acme|topic:pfas analysis");
  });

  it("includes only the segment keys actually present", () => {
    expect(subjectKeyFor({ topic: "pfas analysis" })).toBe("topic:pfas analysis");
    expect(subjectKeyFor({ brand: "Acme" })).toBe("brand:Acme");
    expect(subjectKeyFor({ creativeId: "c1" })).toBe("creative:c1");
    expect(subjectKeyFor({ eventId: "e1" })).toBe("event:e1");
    expect(subjectKeyFor({})).toBe("");
  });
});

describe("assertFalsifiableClaim (B1 — the 'no insight without a testable falsifier' guard)", () => {
  const registryValid: FalsifierClaim = { metric: "topic_momentum", subject: { topic: "x" }, direction: "below", threshold: 1, window_days: 30 };
  const notRegistered: FalsifierClaim = { ...registryValid, metric: "not_a_real_metric" as FalsifierMetricId };

  it("passes a claim with a registry-valid metric", () => {
    expect(() => assertFalsifiableClaim("claim", registryValid)).not.toThrow();
  });

  it("throws for a claim with no falsifier at all", () => {
    expect(() => assertFalsifiableClaim("claim", null)).toThrow(/falsifier/i);
    expect(() => assertFalsifiableClaim("claim", undefined)).toThrow(/falsifier/i);
  });

  it("throws for a claim whose falsifier names a metric outside the registry", () => {
    expect(() => assertFalsifiableClaim("claim", notRegistered)).toThrow();
  });

  it("never requires a falsifier for fact, measured, compacted or legacy (null) kind", () => {
    for (const kind of ["fact", "measured", "compacted", null, undefined] as const) {
      expect(() => assertFalsifiableClaim(kind, null)).not.toThrow();
    }
  });
});
