import { describe, expect, it } from "vitest";
import {
  mannWhitneyOneSided,
  normalApproxPValue,
  isSignificant,
  SIGNIFICANCE_P,
  type MannWhitneyResult,
} from "./significance";

/** C(n, k), used only to size the brute-force enumeration below. */
function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

/**
 * Every way to split distinct ranks 1..(n1+n2) into a "recent" group of
 * size n1 and a "baseline" group of size n2, computed fresh here (not by
 * calling exactUDistribution in significance.ts) so this is a real,
 * independent cross-check of the module's exact path.
 */
function allRecentRankSums(n1: number, n2: number): number[] {
  const n = n1 + n2;
  const ranks = Array.from({ length: n }, (_, i) => i + 1);
  const sums: number[] = [];
  const combo: number[] = [];
  function backtrack(start: number) {
    if (combo.length === n1) {
      sums.push(combo.reduce((a, b) => a + b, 0));
      return;
    }
    for (let i = start; i < n; i += 1) {
      combo.push(ranks[i]);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return sums;
}

function bruteForcePValue(n1: number, n2: number, uObs: number, alternative: "greater" | "less"): number {
  const rankSums = allRecentRankSums(n1, n2);
  const us = rankSums.map((r) => r - (n1 * (n1 + 1)) / 2);
  const hits = us.filter((u) => (alternative === "greater" ? u >= uObs : u <= uObs)).length;
  expect(rankSums.length).toBe(choose(n1 + n2, n1)); // sanity on the enumeration itself
  return hits / rankSums.length;
}

describe("mannWhitneyOneSided — exact path cross-checked against brute force", () => {
  const cases: [number, number][] = [
    [2, 3],
    [3, 3],
    [4, 2],
    [5, 5],
    [6, 4],
    [6, 6],
  ];

  it("matches brute-force enumeration for several small n1,n2 <= 6, both directions", () => {
    for (const [n1, n2] of cases) {
      // Distinct integer values 1..n1+n2 split by a fixed mixing permutation
      // (not sorted into two blocks), so this is not just re-testing the
      // single most/least extreme split the next test covers, and the split
      // always has exactly n1/n2 elements regardless of how n1 and n2 compare.
      const n = n1 + n2;
      const all = Array.from({ length: n }, (_, i) => i + 1);
      const order = [...all].sort((a, b) => ((a * 7) % n) - ((b * 7) % n) || a - b);
      const recent = order.slice(0, n1);
      const baseline = order.slice(n1);
      expect(recent.length).toBe(n1);
      expect(baseline.length).toBe(n2);
      for (const alternative of ["greater", "less"] as const) {
        const result = mannWhitneyOneSided(recent, baseline, alternative);
        expect(result.method).toBe("exact");
        expect(result.insufficient).toBeUndefined();
        const expectedP = bruteForcePValue(n1, n2, result.u, alternative);
        expect(result.p).toBeCloseTo(expectedP, 9);
      }
    }
  });

  it("fully separated samples give p = 1 / C(n1+n2, n1) on the side they are separated toward", () => {
    // recent strictly above baseline: only one of C(6,3)=20 assignments puts
    // all three highest ranks in "recent".
    const recent = [10, 11, 12];
    const baseline = [1, 2, 3];
    const greater = mannWhitneyOneSided(recent, baseline, "greater");
    expect(greater.method).toBe("exact");
    expect(greater.u).toBe(9); // n1*n2, the maximum possible U
    expect(greater.p).toBeCloseTo(1 / choose(6, 3), 10);

    // The opposite side is just as extreme in the other direction.
    const less = mannWhitneyOneSided(baseline, recent, "less");
    expect(less.u).toBe(0);
    expect(less.p).toBeCloseTo(1 / choose(6, 3), 10);
  });

  it("direction is respected: the side the data actually separates toward gets the small p", () => {
    const recent = [10, 11, 12, 13, 14];
    const baseline = [1, 2, 3, 4, 5];
    const greater = mannWhitneyOneSided(recent, baseline, "greater");
    const less = mannWhitneyOneSided(recent, baseline, "less");
    expect(greater.p).toBeLessThan(0.01);
    expect(less.p).toBeGreaterThan(0.99);
  });
});

describe("mannWhitneyOneSided — ties route to the normal approximation", () => {
  it("falls back to normal even for tiny samples once there is a tie", () => {
    const result = mannWhitneyOneSided([1, 2], [2, 3], "less");
    expect(result.method).toBe("normal");
    expect(result.p).toBeGreaterThanOrEqual(0);
    expect(result.p).toBeLessThanOrEqual(1);
  });

  it("the tie-corrected normal p matches a hand-derived value for a known small tie case", () => {
    // recent=[1,2], baseline=[2,3]: ranks 1, 2.5, 2.5, 4 (one tie group of 2).
    // rRecent = 1 + 2.5 = 3.5; U_recent = 3.5 - 2*3/2 = 0.5.
    // meanU = 2*2/2 = 2; tieCorrection = 2^3-2 = 6; N=4.
    // variance = (4/12)*(5 - 6/12) = (1/3)*4.5 = 1.5; sigma = sqrt(1.5).
    const result = mannWhitneyOneSided([1, 2], [2, 3], "less");
    expect(result.u).toBeCloseTo(0.5, 6);
    const sigma = Math.sqrt(1.5);
    const zLess = (0.5 - 2 + 0.5) / sigma;
    const expectedPLess = 0.5 * (1 + erfRef(zLess / Math.SQRT2));
    expect(result.p).toBeCloseTo(expectedPLess, 4);

    const greaterResult = mannWhitneyOneSided([1, 2], [2, 3], "greater");
    const zGreater = (0.5 - 2 - 0.5) / sigma;
    const expectedPGreater = 1 - 0.5 * (1 + erfRef(zGreater / Math.SQRT2));
    expect(greaterResult.p).toBeCloseTo(expectedPGreater, 4);
  });
});

/** Independent erf implementation (different polynomial form) so the normal-path test is not just re-running significance.ts's own erf. */
function erfRef(x: number): number {
  // Numerical integration of the Gaussian density via Simpson's rule — slow
  // but has nothing in common with the A&S rational approximation used in
  // significance.ts, so agreement is a real cross-check.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const n = 2000;
  const h = ax / n;
  let sum = Math.exp(0) + Math.exp(-ax * ax); // f(0) + f(ax), t=0 endpoint and t=ax endpoint
  for (let i = 1; i < n; i += 1) {
    const t = i * h;
    sum += (i % 2 === 0 ? 2 : 4) * Math.exp(-t * t);
  }
  const integral = (h / 3) * sum;
  return sign * ((2 / Math.sqrt(Math.PI)) * integral);
}

describe("normalApproxPValue agrees with the exact method for moderate, tie-free n", () => {
  it("is within 0.02 of the exact p for n1=n2=15 (both still inside the exact range)", () => {
    const n1 = 15;
    const n2 = 15;
    // A deterministic, tie-free, partially-overlapping split (not the extreme case).
    const recent = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31];
    const baseline = Array.from({ length: n2 }, (_, i) => i * 2); // 0,2,4,...,28 — overlaps recent's range
    for (const alternative of ["greater", "less"] as const) {
      const exact = mannWhitneyOneSided(recent, baseline, alternative);
      expect(exact.method).toBe("exact");
      const normalP = normalApproxPValue(n1, n2, exact.u, Array(n1 + n2).fill(1), alternative);
      expect(Math.abs(normalP - exact.p)).toBeLessThan(0.02);
    }
  });
});

describe("isSignificant", () => {
  const sig = (p: number, n1: number, n2: number): MannWhitneyResult => ({ u: 0, p, n1, n2, method: "exact" });

  it("is false with 'not enough data' below minN on either side, regardless of p", () => {
    expect(isSignificant(sig(0.001, 4, 10)).significant).toBe(false);
    expect(isSignificant(sig(0.001, 4, 10)).reason).toBe("not enough data");
    expect(isSignificant(sig(0.001, 10, 4)).significant).toBe(false);
  });

  it("is false with 'not enough data' when the result itself is insufficient (an empty side)", () => {
    expect(isSignificant({ u: 0, p: 1, n1: 0, n2: 6, method: "exact", insufficient: true }).significant).toBe(false);
  });

  it("is true when p is below the threshold and both sides meet minN", () => {
    const result = isSignificant(sig(0.03, 6, 6));
    expect(result.significant).toBe(true);
    expect(result.reason).toContain("0.03");
  });

  it("is false when p is at or above the threshold", () => {
    const result = isSignificant(sig(0.2, 6, 6));
    expect(result.significant).toBe(false);
  });

  it("respects a custom p threshold and minN", () => {
    expect(isSignificant(sig(0.08, 6, 6), 0.05).significant).toBe(false);
    expect(isSignificant(sig(0.08, 6, 6), 0.1).significant).toBe(true);
    expect(isSignificant(sig(0.03, 3, 3), SIGNIFICANCE_P, 3).significant).toBe(true);
  });
});
