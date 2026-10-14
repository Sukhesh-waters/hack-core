/**
 * Significance test (Metacognitive Brain plan B3, "apophenia" rung). Pure.
 *
 * Prevents treating noise as a trend: a "rising" topic's recent-vs-baseline
 * median over 5–20 raw observations can move just from sampling luck. This
 * runs a one-sided Mann–Whitney U test between the recent window and the
 * baseline window before any such claim is written. Exact when both samples
 * are tie-free and small (≤20 each — the null distribution is enumerated by
 * dynamic programming over all C(n1+n2, n1) rank assignments); a
 * tie-corrected, continuity-corrected normal approximation otherwise. Below
 * the CLAUDE.md min-N gate the answer is "not enough data" — never a
 * computed p-value standing in for one.
 */

import { BASELINE_DAYS, MIN_INTEREST_N, RECENT_DAYS } from "./measurement-scales";

const EXACT_MAX_N = 20;
const DAY_MS = 86_400_000;

export type MannWhitneyResult = {
  /** U for the "recent" sample (ties contribute 0.5 each; see rankSumRecent). */
  u: number;
  p: number;
  n1: number;
  n2: number;
  method: "exact" | "normal";
  insufficient?: true;
};

/**
 * Rank-sums the pooled, sorted values of `recent` and `baseline` (average
 * rank within a tie group, 1-based), and returns the recent sample's rank
 * sum plus each tie group's size (size 1 = no tie). U_recent follows from
 * the rank sum: `u = rRecent - n1 * (n1 + 1) / 2`.
 */
function rankSumRecent(recent: number[], baseline: number[]): { rRecent: number; tieSizes: number[] } {
  const tagged = [
    ...recent.map((v) => ({ v, isRecent: true })),
    ...baseline.map((v) => ({ v, isRecent: false })),
  ].sort((a, b) => a.v - b.v);

  let rRecent = 0;
  const tieSizes: number[] = [];
  let i = 0;
  while (i < tagged.length) {
    let j = i;
    while (j + 1 < tagged.length && tagged[j + 1].v === tagged[i].v) j += 1;
    const avgRank = (i + j + 2) / 2; // 1-based positions i+1..j+1, averaged
    for (let k = i; k <= j; k += 1) {
      if (tagged[k].isRecent) rRecent += avgRank;
    }
    tieSizes.push(j - i + 1);
    i = j + 1;
  }
  return { rRecent, tieSizes };
}

/**
 * Exact null distribution of U (no ties): `dist[u]` is the number of ways,
 * out of C(n1+n2, n1) distinct-rank assignments, that the recent sample gets
 * U = u. Standard Mann–Whitney recursion
 * `f(n1, n2, U) = f(n1-1, n2, U-n2) + f(n1, n2-1, U)`, built bottom-up so no
 * recursion depth is a concern at n1, n2 ≤ 20 (dist has at most 401 entries).
 */
function exactUDistribution(n1: number, n2: number): number[] {
  const dp: Float64Array[][] = [];
  for (let a = 0; a <= n1; a += 1) {
    dp[a] = [];
    for (let b = 0; b <= n2; b += 1) dp[a][b] = new Float64Array(a * b + 1);
  }
  for (let b = 0; b <= n2; b += 1) dp[0][b][0] = 1;
  for (let a = 0; a <= n1; a += 1) dp[a][0][0] = 1;
  for (let a = 1; a <= n1; a += 1) {
    for (let b = 1; b <= n2; b += 1) {
      const arr = dp[a][b];
      const prevA = dp[a - 1][b]; // f(a-1, b, ·)
      const prevB = dp[a][b - 1]; // f(a, b-1, ·)
      for (let u = 0; u <= a * b; u += 1) {
        let val = 0;
        const idx = u - b;
        if (idx >= 0 && idx < prevA.length) val += prevA[idx];
        if (u < prevB.length) val += prevB[u];
        arr[u] = val;
      }
    }
  }
  return Array.from(dp[n1][n2]);
}

function exactPValue(n1: number, n2: number, uObs: number, alternative: "greater" | "less"): number {
  const dist = exactUDistribution(n1, n2);
  const total = dist.reduce((a, b) => a + b, 0);
  let tail = 0;
  if (alternative === "greater") {
    for (let u = Math.round(uObs); u <= n1 * n2; u += 1) tail += dist[u] ?? 0;
  } else {
    for (let u = 0; u <= Math.round(uObs); u += 1) tail += dist[u] ?? 0;
  }
  return Math.min(1, tail / total);
}

/** Abramowitz & Stegun 7.1.26 (max error 1.5e-7) — no external stats dependency. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Tie-corrected, continuity-corrected normal approximation to the one-sided
 * Mann–Whitney p-value. Exported (beyond the slice's minimal contract) so
 * tests can cross-check it against the exact method on the same U where
 * both are computable, and so the normal branch has no logic duplicated
 * between this file and its own tests.
 */
export function normalApproxPValue(
  n1: number,
  n2: number,
  uRecent: number,
  tieSizes: number[],
  alternative: "greater" | "less",
): number {
  const n = n1 + n2;
  const meanU = (n1 * n2) / 2;
  const tieCorrection = tieSizes.reduce((sum, t) => sum + (t ** 3 - t), 0);
  const variance = n > 1 ? (n1 * n2) / 12 * (n + 1 - tieCorrection / (n * (n - 1))) : 0;
  const sigma = Math.sqrt(Math.max(variance, 1e-12));
  const z = alternative === "greater" ? (uRecent - meanU - 0.5) / sigma : (uRecent - meanU + 0.5) / sigma;
  const p = alternative === "greater" ? 1 - normalCdf(z) : normalCdf(z);
  return Math.min(1, Math.max(0, p));
}

/**
 * One-sided Mann–Whitney U test: does `recent` tend to be stochastically
 * `alternative` than `baseline`? `u` is always U for the recent sample, so
 * `"greater"` with a large `u` and `"less"` with a small `u` both mean "yes".
 * An empty side can never be tested — `{ p: 1, insufficient: true }`, never a
 * p-value computed from nothing.
 */
export function mannWhitneyOneSided(
  recent: number[],
  baseline: number[],
  alternative: "greater" | "less",
): MannWhitneyResult {
  const n1 = recent.length;
  const n2 = baseline.length;
  if (n1 === 0 || n2 === 0) {
    return { u: 0, p: 1, n1, n2, method: "exact", insufficient: true };
  }

  const { rRecent, tieSizes } = rankSumRecent(recent, baseline);
  const uRecent = rRecent - (n1 * (n1 + 1)) / 2;
  const hasTies = tieSizes.some((t) => t > 1);

  if (!hasTies && n1 <= EXACT_MAX_N && n2 <= EXACT_MAX_N) {
    const uObs = Math.round(uRecent);
    return { u: uObs, p: exactPValue(n1, n2, uObs, alternative), n1, n2, method: "exact" };
  }

  const p = normalApproxPValue(n1, n2, uRecent, tieSizes, alternative);
  return { u: Math.round(uRecent * 100) / 100, p, n1, n2, method: "normal" };
}

/** p below this is "significant" (brief D-level default; a config value, not a law of nature). */
export const SIGNIFICANCE_P = 0.1;

/**
 * Whether a `mannWhitneyOneSided` result counts as significant: `false` with
 * reason `"not enough data"` below `minN` on either side (CLAUDE.md's min-N
 * gate), regardless of how small `p` came out. `minN` defaults to
 * MIN_INTEREST_N (5) per side — the same floor interest.ts already uses.
 */
export function isSignificant(
  result: MannWhitneyResult,
  p: number = SIGNIFICANCE_P,
  minN: number = MIN_INTEREST_N,
): { significant: boolean; reason: string } {
  if (result.insufficient || result.n1 < minN || result.n2 < minN) {
    return { significant: false, reason: "not enough data" };
  }
  if (result.p < p) {
    return { significant: true, reason: `p=${result.p} is below the ${p} significance level` };
  }
  return { significant: false, reason: `not clearly different from usual: p=${result.p} is at or above ${p}` };
}

/**
 * Splits dated observations into the RECENT_DAYS/BASELINE_DAYS windows
 * `mannWhitneyOneSided` expects (ages measured from `now`, the same ruler
 * `interest.ts topicMomentum` and `falsifier-metrics.ts`'s `ratio_of_medians`
 * aggregation already use — measurement-scales.ts, the "coastline" rule).
 * Shared by market-insights.ts (B3's measured-insight significance check)
 * and the B3 gate's own significance check on a `topic_momentum` claim, so
 * both read the recent/baseline split off the same two numbers.
 */
export function splitRecentBaseline(
  observations: { value: number; observedAt: Date }[],
  now: Date,
  recentDays: number = RECENT_DAYS,
  baselineDays: number = BASELINE_DAYS,
): { recent: number[]; baseline: number[] } {
  const age = (o: { observedAt: Date }) => (now.getTime() - new Date(o.observedAt).getTime()) / DAY_MS;
  const recent: number[] = [];
  const baseline: number[] = [];
  for (const o of observations) {
    const a = age(o);
    if (a >= 0 && a <= recentDays) recent.push(o.value);
    else if (a > recentDays && a <= recentDays + baselineDays) baseline.push(o.value);
  }
  return { recent, baseline };
}
