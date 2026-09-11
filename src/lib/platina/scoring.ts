/**
 * Lead-quality weighted score. Conversion rate, not volume.
 * Deliberately does not use the word "magnitude".
 */

export const DEFAULT_MIN_N = 20;

export type OutcomePoint = {
  conversionRate: number;
  recordedAt: Date;
};

export type QualityScore =
  | { status: "insufficient_baseline"; sampleSize: number }
  | {
      status: "scored";
      qualityScore: number;
      direction: "up" | "down" | "flat";
    };

export function scoreLeadQuality(
  value: number,
  baseline: OutcomePoint[],
  minN = DEFAULT_MIN_N,
): QualityScore {
  if (baseline.length < minN) {
    return { status: "insufficient_baseline", sampleSize: baseline.length };
  }
  const mean =
    baseline.reduce((sum, p) => sum + p.conversionRate, 0) / baseline.length;
  const variance =
    baseline.reduce((sum, p) => sum + (p.conversionRate - mean) ** 2, 0) /
    baseline.length;
  const std = Math.sqrt(variance);
  if (std === 0) {
    return { status: "scored", qualityScore: 0, direction: "flat" };
  }
  const z = (value - mean) / std;
  const direction = z > 0.5 ? "up" : z < -0.5 ? "down" : "flat";
  return { status: "scored", qualityScore: z, direction };
}

export function conversionRate(leads: number, qualified: number): number | null {
  if (leads <= 0) return null;
  return qualified / leads;
}
