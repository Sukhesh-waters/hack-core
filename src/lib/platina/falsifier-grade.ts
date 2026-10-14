/**
 * Falsifier grading (Metacognitive Brain plan, B5). Pure: given a stored
 * falsifier (B1), a measurement already produced by the registry's
 * `measureMetric` (falsifier-metrics.ts — the grader's ONLY measuring path)
 * and the chunk's own due date, decides whether the claim was proved wrong,
 * held up, is still inconclusive, or cannot be tested yet. No DB, no
 * provider call.
 *
 * Rule table (plan §5 B5):
 *   window not elapsed                         -> pending       (no row written)
 *   not_measured, or n < metric.minN            -> insufficient  ("not enough data to test yet")
 *   falsifier triggered                         -> refuted
 *   not triggered, clears the threshold by      -> promoted      ("effect held")
 *     >= HELD_MARGIN of the threshold
 *   not triggered, margin not cleared           -> holding       ("effect weak")
 *
 * "Triggered" mirrors the falsifier's own direction (falsifier-metrics.ts
 * FalsifierClaim.direction is the direction that would prove the claim
 * WRONG, not the claim's own asserted direction — see interrogation.ts
 * chunkDirectionFor for that distinction):
 *   direction "below": triggered when value <  threshold
 *   direction "above": triggered when value >  threshold
 *
 * Facts (kind="fact") and legacy rows carry no falsifier at all, so they
 * never reach this function — the due-chunks query (platina-grades.ts)
 * selects only `falsifier is not null`, which excludes them structurally.
 * This function therefore requires a falsifier, not an optional one: there
 * is no "no falsifier" branch to get wrong.
 */
import type { FalsifierClaim, MetricResult } from "./falsifier-metrics";

/**
 * A deterministic stand-in for "the effect held" until a per-metric
 * raw-observation significance test (the kind B3's significance.ts runs for
 * the gate) is wired into the grader too. 10% of the threshold's own
 * magnitude: a value that merely fails to trigger the falsifier is not yet
 * "held" — it must clear the line by a margin before the system calls it
 * promoted rather than just holding.
 */
export const HELD_MARGIN = 0.1;

export const GRADE_VERDICTS = ["pending", "insufficient", "refuted", "promoted", "holding"] as const;
export type GradeVerdict = (typeof GRADE_VERDICTS)[number];

export type GradeInsightInput = {
  falsifier: FalsifierClaim;
  /** From falsifier-metrics.ts measureMetric, called through the real MeasureDeps. */
  measurement: MetricResult;
  now: Date;
  /** The chunk's due_at. Null means "no window to test" — treated as not yet due. */
  dueAt: Date | null;
};

export type GradeInsightResult = {
  verdict: GradeVerdict;
  /** Plain words — not yet the operator copy in plan §9, which a display layer applies. */
  reason: string;
  /** Present whenever the metric was actually measured (refuted/promoted/holding), absent for pending/insufficient. */
  measured?: { value: number; n: number };
};

function triggered(falsifier: FalsifierClaim, value: number): boolean {
  return falsifier.direction === "below" ? value < falsifier.threshold : value > falsifier.threshold;
}

/** Whether `value`, having NOT triggered the falsifier, clears the threshold by at least HELD_MARGIN of its magnitude. */
function clearsMargin(falsifier: FalsifierClaim, value: number): boolean {
  const margin = HELD_MARGIN * Math.abs(falsifier.threshold);
  return falsifier.direction === "below"
    ? value >= falsifier.threshold + margin
    : value <= falsifier.threshold - margin;
}

export function gradeInsight(input: GradeInsightInput): GradeInsightResult {
  const { falsifier, measurement, now, dueAt } = input;

  if (!dueAt || now.getTime() < dueAt.getTime()) {
    return { verdict: "pending", reason: "the test window has not closed yet" };
  }

  if (measurement.status === "not_measured") {
    return { verdict: "insufficient", reason: "not enough data to test yet" };
  }
  if (measurement.status === "insufficient") {
    return {
      verdict: "insufficient",
      reason: `not enough data to test yet (${measurement.n} observation${measurement.n === 1 ? "" : "s"})`,
    };
  }

  const { value, n } = measurement;
  const measured = { value, n };

  if (triggered(falsifier, value)) {
    return {
      verdict: "refuted",
      reason:
        falsifier.direction === "below"
          ? `the measured value (${value}) fell below the threshold (${falsifier.threshold}) — the falsifier triggered`
          : `the measured value (${value}) rose above the threshold (${falsifier.threshold}) — the falsifier triggered`,
      measured,
    };
  }

  if (clearsMargin(falsifier, value)) {
    return {
      verdict: "promoted",
      reason: `the measured value (${value}) cleared the threshold (${falsifier.threshold}) by at least ${Math.round(HELD_MARGIN * 100)}% — the effect held`,
      measured,
    };
  }

  return {
    verdict: "holding",
    reason: `the measured value (${value}) did not trigger the falsifier but has not cleared the threshold (${falsifier.threshold}) by ${Math.round(HELD_MARGIN * 100)}% either — not yet clearly held`,
    measured,
  };
}

/**
 * Confidence becomes earned, not reported (plan §5 B5): the mean of
 * Beta(1 + held, 1 + refuted), the same arithmetic learning.ts uses for
 * feature posteriors. `held`/`refuted` are grade COUNTS (how many times this
 * chunk — or, per the caller's choice, a pooled subject — has been promoted
 * vs. refuted), not booleans. With no grades yet this is the uninformative
 * prior, 0.5. A model never sets confidence again once a chunk has a
 * falsifier; only this function does, through setBrainState.
 */
export function earnedConfidence(held: number, refuted: number): number {
  const alpha = 1 + Math.max(0, held);
  const beta = 1 + Math.max(0, refuted);
  return alpha / (alpha + beta);
}

/**
 * Inngest event id for the daily fan-out (plan §5 B5, §12 "grade:<ws>:<day>"):
 * one event per workspace per UTC day, so a re-run of the sweep (crash,
 * manual replay) collapses into the same delivery instead of re-grading
 * twice. Unlike analysis.ts analyzeEventId (bucketed to a stale-claim
 * window), this is a daily cron, so the bucket is simply the UTC day.
 */
export const gradeEventId = (workspaceId: string, now: number = Date.now()) =>
  `grade:${workspaceId}:${new Date(now).toISOString().slice(0, 10)}`;
