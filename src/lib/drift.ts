/**
 * Brand Drift has zero backing computation anywhere in this codebase. This
 * slice defines it as: how often a client's recent content needed a
 * compliance intervention — flaggedRate over their last N content rows —
 * because complianceStatus/complianceReport is the only compliance-adjacent
 * signal that already exists and directly reflects deviation from brand
 * rules. This is this codebase's own interpretation, not spec-mandated;
 * swap it out later if a real brand-voice-drift pipeline is built.
 */

export const DRIFT_WINDOW_N = 20; // mirrors MIN_BASELINE_N's sample-gate convention
export const DRIFT_MIN_N = 5; // below this, no magnitude is shown at all
export const DRIFT_WARN_THRESHOLD = 0.2; // 1-in-5 flagged — worth a look
export const DRIFT_ALERT_THRESHOLD = 0.4; // 2-in-5 flagged — needs attention

export type DriftNarrative = "steady" | "drifting" | "needs attention";

export type DriftResult =
  | { status: "insufficient_data"; sampleSize: number }
  | {
      status: "scored";
      sampleSize: number;
      flaggedRate: number;
      magnitude: number; // 0-100, for the gauge ring
      narrative: DriftNarrative;
      thresholdCallout: boolean;
    };

export function computeDrift(input: {
  total: number;
  flagged: number;
}): DriftResult {
  if (input.total < DRIFT_MIN_N) {
    return { status: "insufficient_data", sampleSize: input.total };
  }
  const flaggedRate = input.flagged / input.total;
  const narrative: DriftNarrative =
    flaggedRate < DRIFT_WARN_THRESHOLD
      ? "steady"
      : flaggedRate < DRIFT_ALERT_THRESHOLD
        ? "drifting"
        : "needs attention";
  return {
    status: "scored",
    sampleSize: input.total,
    flaggedRate,
    magnitude: Math.round(flaggedRate * 100),
    narrative,
    thresholdCallout: flaggedRate >= DRIFT_WARN_THRESHOLD,
  };
}

/** Worst-first ranking for narratives — used to pick a single "worst" client
 *  to headline the Marketing OS overview glance without averaging away a
 *  real problem client. Higher = worse. */
const NARRATIVE_SEVERITY: Record<DriftNarrative, number> = {
  steady: 0,
  drifting: 1,
  "needs attention": 2,
};

/**
 * V3 (Marketing OS overview): summarize per-client drift results into one
 * glance-card shape. Pure — takes each client's already-computed
 * `DriftResult` (via computeDrift, which already enforces DRIFT_MIN_N), so
 * this function itself never fabricates a magnitude for an insufficient-data
 * client; it only counts them. The "worst" client is the one with the
 * highest-severity narrative among clients that DO have enough data;
 * ties keep the first one encountered.
 */
export function summarizeDriftAcrossClients(
  results: { clientName: string; result: DriftResult }[],
): {
  worstNarrative: DriftNarrative | null;
  worstClientName: string | null;
  scoredCount: number;
  insufficientCount: number;
} {
  let worstNarrative: DriftNarrative | null = null;
  let worstClientName: string | null = null;
  let scoredCount = 0;
  let insufficientCount = 0;

  for (const { clientName, result } of results) {
    if (result.status === "insufficient_data") {
      insufficientCount += 1;
      continue;
    }
    scoredCount += 1;
    if (
      worstNarrative === null ||
      NARRATIVE_SEVERITY[result.narrative] > NARRATIVE_SEVERITY[worstNarrative]
    ) {
      worstNarrative = result.narrative;
      worstClientName = clientName;
    }
  }

  return { worstNarrative, worstClientName, scoredCount, insufficientCount };
}
