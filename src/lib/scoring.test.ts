import { describe, expect, it } from "vitest";
import {
  computeEngagementRate,
  freshnessWeight,
  MIN_BASELINE_N,
  scoreAgainstBaseline,
  type BaselinePoint,
} from "./scoring";

const NOW = new Date("2026-07-04T00:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function points(values: number[], ageDays = 10): BaselinePoint[] {
  return values.map((value) => ({ value, postedAt: daysAgo(ageDays) }));
}

describe("minimum-N gate (constitution rule)", () => {
  it("refuses to score below MIN_BASELINE_N — no fabricated numbers", () => {
    const baseline = points(Array(MIN_BASELINE_N - 1).fill(5));
    expect(scoreAgainstBaseline(5, baseline, NOW)).toEqual({
      status: "insufficient_baseline",
      sampleSize: MIN_BASELINE_N - 1,
    });
  });

  it("scores at exactly MIN_BASELINE_N", () => {
    const baseline = points([...Array(MIN_BASELINE_N)].map((_, i) => i));
    expect(scoreAgainstBaseline(10, baseline, NOW).status).toBe("scored");
  });
});

describe("direction + magnitude", () => {
  const baseline = points([
    1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5,
  ]);

  it("clear outlier above baseline scores up", () => {
    const score = scoreAgainstBaseline(9, baseline, NOW);
    expect(score).toMatchObject({ status: "scored", direction: "up" });
    if (score.status === "scored") expect(score.magnitude).toBeGreaterThan(0.5);
  });

  it("clear outlier below baseline scores down", () => {
    expect(scoreAgainstBaseline(-3, baseline, NOW)).toMatchObject({
      status: "scored",
      direction: "down",
    });
  });

  it("value at the mean scores flat with ~zero magnitude", () => {
    const score = scoreAgainstBaseline(3, baseline, NOW);
    expect(score).toMatchObject({ status: "scored", direction: "flat" });
    if (score.status === "scored") expect(score.magnitude).toBeLessThan(0.1);
  });

  it("zero-variance baseline scores flat instead of dividing by zero", () => {
    expect(
      scoreAgainstBaseline(7, points(Array(25).fill(7)), NOW),
    ).toMatchObject({ status: "scored", direction: "flat", magnitude: 0 });
  });
});

describe("freshness decay", () => {
  it("halves the weight every FRESHNESS_HALF_LIFE_DAYS", () => {
    expect(freshnessWeight(daysAgo(0), NOW)).toBeCloseTo(1, 5);
    expect(freshnessWeight(daysAgo(90), NOW)).toBeCloseTo(0.5, 5);
    expect(freshnessWeight(daysAgo(180), NOW)).toBeCloseTo(0.25, 5);
  });

  it("discounts stale baseline points: a value matching recent posts reads flat, not down", () => {
    const baseline = [
      ...points(Array(20).fill(10), 5),
      ...points(Array(20).fill(100), 360),
    ];
    const score = scoreAgainstBaseline(10, baseline, NOW);
    expect(score.status).toBe("scored");
    if (score.status === "scored") expect(score.direction).not.toBe("down");
  });
});

describe("computeEngagementRate", () => {
  it("sums interactions over reach", () => {
    expect(
      computeEngagementRate({
        reach: 1000,
        likes: 80,
        comments: 10,
        shares: 5,
        saves: 5,
      }),
    ).toBeCloseTo(0.1, 5);
  });

  it("treats missing interaction counts as zero", () => {
    expect(computeEngagementRate({ reach: 100, likes: 10 })).toBeCloseTo(
      0.1,
      5,
    );
  });

  it("returns null without positive reach — unscorable, not zero", () => {
    expect(computeEngagementRate({ likes: 10 })).toBeNull();
    expect(computeEngagementRate({ reach: 0, likes: 10 })).toBeNull();
  });
});
