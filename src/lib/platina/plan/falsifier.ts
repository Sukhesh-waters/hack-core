/**
 * B8 — a plan states how the team will know it is NOT working.
 *
 * A plan with no stated test can only be judged by impression afterwards; a
 * stated test ("leads below 10 within 30 days") is a prediction the results
 * can contradict. The planner may only pick a first-party result metric the
 * system records (the metric registry's creative_* entries) and a window the
 * registry declares for it. Anything else is dropped, never repaired, and an
 * unusable test never fails the plan itself: the plan simply has none.
 *
 * Grading a whole plan needs a plan-level measure (results across the plan's
 * logged pieces) that the registry does not have yet; until then the test is
 * stated and shown, not graded. Pure.
 */
import type { PlanFalsifier } from "@/db/platina-schema";
import { FALSIFIER_METRICS } from "@/lib/platina/falsifier-metrics";

/** Plain operator words for each metric when it is measured across a plan. */
export const PLAN_FALSIFIER_METRICS: Record<PlanFalsifier["metric"], string> = {
  creative_leads: "leads from this plan's pieces",
  creative_ctr: "click-through rate on this plan's pieces",
  creative_engagement_rate: "engagement rate on this plan's pieces",
};

const METRIC_IDS = Object.keys(PLAN_FALSIFIER_METRICS) as PlanFalsifier["metric"][];

/** Allowed windows per metric, from the registry (never hand-copied). */
function windowsFor(metric: PlanFalsifier["metric"]): readonly number[] {
  return FALSIFIER_METRICS[metric]?.windows ?? [];
}

/** The prompt line that asks for the test, listing only what can be recorded. */
export function planFalsifierInstruction(): string {
  const options = METRIC_IDS.map((m) => `"${m}" (${PLAN_FALSIFIER_METRICS[m]}; window ${windowsFor(m).join(" or ")} days)`);
  return (
    'Also state how the team will know this plan is NOT working, as "falsifier": ' +
    '{"metric": one of ' + options.join(", ") +
    ', "direction": "below" or "above", "threshold": number, "window_days": number}. ' +
    "Pick the result this plan most depends on and a threshold that would mean it failed. Use null if none of these fits."
  );
}

/** A validated test, or null. Malformed or out-of-registry input is dropped. */
export function parsePlanFalsifier(raw: unknown): PlanFalsifier | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const metric = r.metric;
  if (typeof metric !== "string" || !METRIC_IDS.includes(metric as PlanFalsifier["metric"])) return null;
  const m = metric as PlanFalsifier["metric"];
  if (r.direction !== "below" && r.direction !== "above") return null;
  const threshold = typeof r.threshold === "number" ? r.threshold : Number(r.threshold);
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  const window = Number(r.window_days);
  if (!windowsFor(m).includes(window) || (window !== 30 && window !== 90)) return null;
  return { metric: m, direction: r.direction, threshold, window_days: window };
}

/** One plain sentence for the roadmap. */
export function describePlanFalsifier(f: PlanFalsifier): string {
  const value = f.metric === "creative_leads" ? String(f.threshold) : formatShare(f.threshold);
  const verb = f.metric === "creative_leads" ? "are" : "is";
  return `This plan is not working if ${PLAN_FALSIFIER_METRICS[f.metric]} ${verb} ${f.direction} ${value} after ${f.window_days} days.`;
}

/** Rates may arrive as a fraction (0.02) or a percentage (2); show a percentage. */
function formatShare(x: number): string {
  const pct = x <= 1 ? x * 100 : x;
  return `${Math.round(pct * 100) / 100}%`;
}
