/**
 * S2 — turning a template into a run.
 *
 * Pure on purpose: instantiation is where a template's relative intentions
 * ("14 days before launch", "whoever is an admin", "after the brief")
 * collapse into concrete commitments (a date, a person, a blocked/ready
 * state). That collapse is exactly the logic worth testing without a
 * database, and exactly the logic that is expensive to get wrong — a run is
 * a snapshot, so a mistake here is baked into work people then do.
 */

import type { SopAssigneeRule, StepCompletionPolicy } from "@/db/schema";
import type { MembershipRole } from "@/lib/permissions";
import type { SopStepCreates, SopStepGate } from "./template";

export type TemplateStepLike = {
  id: string;
  position: number;
  title: string;
  description: string | null;
  assigneeRule: SopAssigneeRule;
  dueOffsetDays: number;
  gate: SopStepGate;
  creates: SopStepCreates;
  completesWhen?: StepCompletionPolicy;
  dependsOn: string[];
};

export type InstantiatedStep = {
  id: string;
  templateStepId: string;
  position: number;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeRole: MembershipRole | null;
  dueAt: Date;
  status: "blocked" | "ready";
  gate: SopStepGate;
  creates: SopStepCreates;
  completesWhen: StepCompletionPolicy;
  /** Run-step ids, not template-step ids. */
  dependsOn: string[];
};

/**
 * Day arithmetic that survives DST. Adding 86_400_000 ms lands an hour off
 * either side of a clock change, which is how a step quietly becomes due on
 * the wrong day twice a year; `setDate` moves calendar days instead.
 */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** Midnight local time. A step is due on a DAY — carrying the hour someone
 *  happened to click "start run" makes two identical runs disagree. */
export function startOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

export function instantiateRun(input: {
  steps: TemplateStepLike[];
  anchorDate: Date;
  /** Whether a user id is still a member of this workspace. A template can
   *  name someone who has since left, and assigning work to them would make
   *  it invisible to everyone who could actually do it. */
  isMember: (userId: string) => boolean;
  newId: () => string;
}): InstantiatedStep[] {
  const { steps, anchorDate, isMember, newId } = input;
  const anchor = startOfDay(anchorDate);

  // Ids first, so dependencies can be remapped in one pass afterwards.
  const idByTemplateStep = new Map(steps.map((s) => [s.id, newId()]));

  return steps.map((step): InstantiatedStep => {
    const { assigneeId, assigneeRole } = resolveAssignee(
      step.assigneeRule,
      isMember,
    );

    // Drop dependencies that name a step which is not part of this
    // template. They cannot ever complete, so keeping them would block the
    // dependent forever.
    const dependsOn = step.dependsOn
      .map((templateStepId) => idByTemplateStep.get(templateStepId))
      .filter((id): id is string => Boolean(id));

    return {
      id: idByTemplateStep.get(step.id)!,
      templateStepId: step.id,
      position: step.position,
      title: step.title,
      description: step.description,
      assigneeId,
      assigneeRole,
      dueAt: addDays(anchor, step.dueOffsetDays),
      // Derived, never chosen: anything with an unmet dependency starts
      // blocked, everything else is immediately actionable.
      status: dependsOn.length > 0 ? "blocked" : "ready",
      gate: step.gate,
      creates: step.creates,
      completesWhen: step.completesWhen ?? { kind: "manual" },
      dependsOn,
    };
  });
}


/**
 * A `role` rule resolves to a role, NOT to a person.
 *
 * Auto-picking "some admin" would hand real, dated work to someone who
 * never agreed to it, and would pick differently depending on row order.
 * Leaving it unassigned-with-a-role lets the run board say "needs an admin"
 * and offer a filtered picker — a human makes the call, which is the only
 * honest option when the template genuinely didn't name anyone.
 */
function resolveAssignee(
  rule: SopAssigneeRule,
  isMember: (userId: string) => boolean,
): { assigneeId: string | null; assigneeRole: MembershipRole | null } {
  if (rule.kind === "user") {
    return {
      assigneeId: isMember(rule.value) ? rule.value : null,
      assigneeRole: null,
    };
  }
  if (rule.kind === "role") {
    return { assigneeId: null, assigneeRole: rule.value };
  }
  return { assigneeId: null, assigneeRole: null };
}

/**
 * Recomputes which steps are unblocked after some set of steps is done.
 *
 * Used on every step completion (S3). A step becomes `ready` only when
 * every dependency is closed — `done` or `skipped` both count, because a
 * skipped step is a decision that it will never happen, and leaving its
 * dependents blocked on it forever would strand the rest of the run.
 */
export function unblockedStepIds(
  steps: {
    id: string;
    status: string;
    dependsOn: string[];
  }[],
): string[] {
  const closed = new Set(
    steps.filter((s) => s.status === "done" || s.status === "skipped").map((s) => s.id),
  );
  return steps
    .filter(
      (s) =>
        s.status === "blocked" && s.dependsOn.every((dep) => closed.has(dep)),
    )
    .map((s) => s.id);
}

/**
 * Recomputes which steps should be re-blocked after a step moves from closed to non-closed.
 * Any step currently `ready` that depends on a step that is no longer closed moves back to `blocked`.
 */
export function reblockedStepIds(
  steps: {
    id: string;
    status: string;
    dependsOn: string[];
  }[],
): string[] {
  const closed = new Set(
    steps.filter((s) => s.status === "done" || s.status === "skipped").map((s) => s.id),
  );
  return steps
    .filter(
      (s) =>
        s.status === "ready" && !s.dependsOn.every((dep) => closed.has(dep)),
    )
    .map((s) => s.id);
}

/** True when every step has reached a terminal state, i.e. the run is over. */
export function isRunComplete(steps: { status: string }[]): boolean {
  if (steps.length === 0) return false;
  return steps.every((s) => s.status === "done" || s.status === "skipped");
}
