/**
 * Direction/magnitude scoring: z-score of a post's metric against the
 * account's own freshness-weighted baseline (constitution: baseline engine
 * reads first-party rows only — enforced upstream in src/db/queries/posts.ts).
 */

export const MIN_BASELINE_N = 20;
export const FRESHNESS_HALF_LIFE_DAYS = 90;

export type BaselinePoint = { value: number; postedAt: Date };

export type PostScore =
  | { status: "insufficient_baseline"; sampleSize: number }
  | {
      status: "scored";
      zScore: number;
      direction: "up" | "down" | "flat";
      magnitude: number;
    };

export function freshnessWeight(
  postedAt: Date,
  now: Date = new Date(),
): number {
  const ageDays = Math.max(
    0,
    (now.getTime() - postedAt.getTime()) / 86_400_000,
  );
  return Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

export function scoreAgainstBaseline(
  value: number,
  baseline: BaselinePoint[],
  now: Date = new Date(),
): PostScore {
  if (baseline.length < MIN_BASELINE_N) {
    return { status: "insufficient_baseline", sampleSize: baseline.length };
  }

  const weights = baseline.map((point) => freshnessWeight(point.postedAt, now));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const mean =
    baseline.reduce((sum, point, i) => sum + point.value * weights[i], 0) /
    weightSum;
  const variance =
    baseline.reduce(
      (sum, point, i) => sum + weights[i] * (point.value - mean) ** 2,
      0,
    ) / weightSum;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return { status: "scored", zScore: 0, direction: "flat", magnitude: 0 };
  }

  const zScore = (value - mean) / stdDev;
  const direction = zScore > 0.5 ? "up" : zScore < -0.5 ? "down" : "flat";
  // Magnitude: |z| normalized to 0..1, saturating at 3 standard deviations.
  const magnitude = Math.min(Math.abs(zScore), 3) / 3;
  return { status: "scored", zScore, direction, magnitude };
}

export function computeEngagementRate(row: {
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}): number | null {
  if (!row.reach || row.reach <= 0) return null;
  const interactions =
    (row.likes ?? 0) +
    (row.comments ?? 0) +
    (row.shares ?? 0) +
    (row.saves ?? 0);
  return interactions / row.reach;
}
