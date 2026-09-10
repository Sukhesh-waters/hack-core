/**
 * S5 — which steps are late, which are about to be, and what moves if you
 * reschedule.
 *
 * The governing decision (plan section 2.4): a late step NEVER silently
 * reschedules its dependents. A due date is a commitment other people
 * planned around, and moving it behind their back is worse than showing it
 * as late. So this module only ever *computes* — it tells you what is at
 * risk and what would move. A human decides whether it moves.
 */

import { addDays, startOfDay } from "./instantiate";

export type RiskStep = {
  id: string;
  status: string;
  dueAt: Date;
  dependsOn: string[];
};

/** done and skipped are both terminal — a skipped step will never happen,
 *  which is as final as having happened. */
export function isClosed(status: string): boolean {
  return status === "done" || status === "skipped";
}

/**
 * Whole calendar days a step is past due, or 0 if it isn't.
 *
 * Compared at day granularity because that is the granularity due dates are
 * set at: something due today is not "0.4 days late" at teatime, it is on
 * time until the day ends.
 */
export function daysLate(dueAt: Date, now: Date): number {
  const due = startOfDay(dueAt).getTime();
  const today = startOfDay(now).getTime();
  if (today <= due) return 0;
  return Math.round((today - due) / 86_400_000);
}

/**
 * Every step that transitively waits on `stepId` — what a reschedule would
 * move.
 *
 * Walks the reverse edges breadth-first with a visited set, so a diamond
 * doesn't return the same step twice and a cycle (which the template
 * builder refuses, but crafted data could still contain) terminates instead
 * of hanging.
 */
export function downstreamStepIds(
  steps: RiskStep[],
  stepId: string,
): string[] {
  const dependentsOf = new Map<string, string[]>();
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      const list = dependentsOf.get(dep);
      if (list) list.push(step.id);
      else dependentsOf.set(dep, [step.id]);
    }
  }

  const seen = new Set<string>([stepId]);
  const out: string[] = [];
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of dependentsOf.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}

export type RunRisk = {
  /** Open and already past due. */
  overdue: string[];
  /**
   * Open, not yet late itself, but waiting on something that is. These are
   * the ones worth surfacing early — by the time they go overdue it is too
   * late to do anything about the cause.
   */
  atRisk: string[];
};

export function runRisk(steps: RiskStep[], now: Date): RunRisk {
  const overdue = new Set(
    steps
      .filter((s) => !isClosed(s.status) && daysLate(s.dueAt, now) > 0)
      .map((s) => s.id),
  );

  // A step is at risk if anything it transitively waits on is overdue.
  // Computed by walking DOWN from each overdue step rather than up from
  // every step, so the cost is proportional to how much is actually late.
  const atRisk = new Set<string>();
  for (const lateId of overdue) {
    for (const id of downstreamStepIds(steps, lateId)) {
      atRisk.add(id);
    }
  }

  const stepById = new Map(steps.map((s) => [s.id, s]));
  return {
    overdue: [...overdue],
    atRisk: [...atRisk].filter((id) => {
      const step = stepById.get(id);
      // Already-late steps are reported as overdue, not double-counted as
      // at risk, and closed ones are neither.
      return step && !isClosed(step.status) && !overdue.has(id);
    }),
  };
}

/**
 * The new due dates a reschedule would produce: every open downstream step
 * shifted by `days`.
 *
 * Closed steps keep their dates — those are history, and rewriting when
 * something actually happened to tidy up a chart is a lie. The step that
 * slipped is not moved either: its date is the evidence of the slip.
 */
export function rescheduledDates(
  steps: RiskStep[],
  stepId: string,
  days: number,
): { id: string; dueAt: Date }[] {
  if (days === 0) return [];
  const stepById = new Map(steps.map((s) => [s.id, s]));
  return downstreamStepIds(steps, stepId)
    .map((id) => stepById.get(id))
    .filter((s): s is RiskStep => Boolean(s) && !isClosed(s!.status))
    .map((s) => ({ id: s.id, dueAt: addDays(s.dueAt, days) }));
}

/**
 * The new due dates a whole-run re-anchor would produce (E9): every open step
 * in the run shifted by `days`.
 *
 * Closed steps keep their dates — those are history, and rewriting when
 * something actually completed is a lie.
 */
export function reanchoredDates(
  steps: RiskStep[],
  days: number,
): { id: string; dueAt: Date }[] {
  if (days === 0) return [];
  return steps
    .filter((s) => !isClosed(s.status))
    .map((s) => ({ id: s.id, dueAt: addDays(s.dueAt, days) }));
}

