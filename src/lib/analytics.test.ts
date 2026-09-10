import { describe, expect, it } from "vitest";
import {
  buildTrendSeries,
  formatBarWidths,
  normalizeForSparkline,
} from "./analytics";
import { MIN_BASELINE_N } from "./scoring";

describe("buildTrendSeries", () => {
  it("min-N gate: below baseline, returns insufficient_baseline with no points", () => {
    const result = buildTrendSeries(
      [
        { bucket: "2026-06-01T00:00:00Z", posts: 2, avgEngagement: 0.09 },
        { bucket: "2026-06-08T00:00:00Z", posts: 1, avgEngagement: 0.05 },
      ],
      3, // below MIN_BASELINE_N
    );
    expect(result.status).toBe("insufficient_baseline");
    if (result.status === "insufficient_baseline") {
      expect(result.sampleSize).toBe(3);
    }
    // No points/engagement numbers should be reachable from this branch.
    expect(result).not.toHaveProperty("points");
  });

  it("zero-post workspace: insufficient_baseline, not a crash or fabricated series", () => {
    const result = buildTrendSeries([], 0);
    expect(result).toEqual({ status: "insufficient_baseline", sampleSize: 0 });
  });

  it("at or above baseline: returns a ready series with plotted points", () => {
    const result = buildTrendSeries(
      [
        { bucket: "2026-06-01T00:00:00Z", posts: 10, avgEngagement: 0.04 },
        { bucket: "2026-06-08T00:00:00Z", posts: 12, avgEngagement: 0.06 },
      ],
      MIN_BASELINE_N,
    );
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.sampleSize).toBe(MIN_BASELINE_N);
      expect(result.points).toEqual([
        { bucket: "2026-06-01T00:00:00Z", avgEngagement: 0.04 },
        { bucket: "2026-06-08T00:00:00Z", avgEngagement: 0.06 },
      ]);
    }
  });

  it("drops buckets with null avgEngagement instead of fabricating a zero", () => {
    const result = buildTrendSeries(
      [
        { bucket: "2026-06-01T00:00:00Z", posts: 15, avgEngagement: null },
        { bucket: "2026-06-08T00:00:00Z", posts: 10, avgEngagement: 0.07 },
      ],
      MIN_BASELINE_N,
    );
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.points).toHaveLength(1);
      expect(result.points[0].bucket).toBe("2026-06-08T00:00:00Z");
    }
  });
});

describe("normalizeForSparkline", () => {
  it("normalizes to 0..1 range", () => {
    const result = normalizeForSparkline([0.02, 0.04, 0.06]);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(1);
  });

  it("flat series (all identical) renders a level line, not a fabricated slope", () => {
    expect(normalizeForSparkline([0.05, 0.05, 0.05])).toEqual([0.5, 0.5, 0.5]);
  });

  it("empty series returns empty", () => {
    expect(normalizeForSparkline([])).toEqual([]);
  });

  it("single point normalizes flat", () => {
    expect(normalizeForSparkline([0.05])).toEqual([0.5]);
  });
});

describe("formatBarWidths", () => {
  it("scales widths relative to the top format, floored at 4%", () => {
    const result = formatBarWidths([
      { format: "reel", count: 10, avgEngagement: 0.08 },
      { format: "post", count: 5, avgEngagement: 0.02 },
      { format: "story", count: 1, avgEngagement: 0 },
    ]);
    expect(result[0].widthPct).toBe(100);
    expect(result[1].widthPct).toBe(25);
    expect(result[2].widthPct).toBe(4);
  });

  it("all-null engagement: every bar floors at 4%, none fabricated tall", () => {
    const result = formatBarWidths([
      { format: "reel", count: 2, avgEngagement: null },
      { format: "post", count: 1, avgEngagement: null },
    ]);
    expect(result.every((f) => f.widthPct === 4)).toBe(true);
  });

  it("empty input returns empty", () => {
    expect(formatBarWidths([])).toEqual([]);
  });
});
