import { createHash } from "node:crypto";
import { addDays, startOfDay } from "./instantiate";

export type CascadeStepLike = {
  id: string;
  title: string;
  dueAt: Date;
  status: "blocked" | "ready" | "in_progress" | "done" | "skipped";
  dependsOn: string[];
  assigneeId: string | null;
};

export type CascadeMove = {
  stepId: string;
  stepTitle: string;
  fromDate: Date;
  toDate: Date;
  assigneeId: string | null;
};

export type CascadeBreach = {
  kind: "sla" | "assignee_overload" | "weekend_clamp";
  stepId: string;
  message: string;
};

export type CascadeResult = {
  slippedStepId: string;
  slipDays: number;
  scopedRunHash: string;
  moves: CascadeMove[];
  breaches: CascadeBreach[];
};

/**
 * Adds business days to a date, skipping Saturday (6) and Sunday (0).
 */
export function addBusinessDays(startDate: Date, days: number): Date {
  const current = new Date(startDate.getTime());
  let added = 0;
  const direction = days >= 0 ? 1 : -1;
  const target = Math.abs(days);

  while (added < target) {
    current.setDate(current.getDate() + direction);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }

  return current;
}


/**
 * Computes deterministic SHA-256 hash for optimistic concurrency locking.
 */
export function computeScopedRunHash(steps: CascadeStepLike[]): string {
  const payload = steps
    .map((s) => `${s.id}:${s.status}:${s.dueAt.toISOString()}`)
    .sort()
    .join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Pure cascade computation:
 * Traverses forward dependency graph from a slipped step and recalculates due dates.
 */
export function computeCascade(input: {
  steps: CascadeStepLike[];
  slippedStepId: string;
  actualCompletionDate: Date;
  skipWeekends?: boolean;
}): CascadeResult {
  const { steps, slippedStepId, actualCompletionDate, skipWeekends = true } = input;

  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const slipped = stepMap.get(slippedStepId);

  if (!slipped) {
    return {
      slippedStepId,
      slipDays: 0,
      scopedRunHash: computeScopedRunHash(steps),
      moves: [],
      breaches: [],
    };
  }

  const originalDue = startOfDay(slipped.dueAt);
  const actualDue = startOfDay(actualCompletionDate);
  const diffMs = actualDue.getTime() - originalDue.getTime();
  const slipDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  if (slipDays === 0) {
    return {
      slippedStepId,
      slipDays: 0,
      scopedRunHash: computeScopedRunHash(steps),
      moves: [],
      breaches: [],
    };
  }

  // Find all downstream dependents via BFS / transitive closure
  const downstreamIds = new Set<string>();
  const queue = [slippedStepId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const step of steps) {
      if (step.dependsOn.includes(currentId) && !downstreamIds.has(step.id)) {
        downstreamIds.add(step.id);
        queue.push(step.id);
      }
    }
  }

  const affectedSteps = steps.filter(
    (s) => s.id === slippedStepId || downstreamIds.has(s.id),
  );

  const moves: CascadeMove[] = [];
  const breaches: CascadeBreach[] = [];
  const assigneeWorkload = new Map<string, Set<string>>();

  for (const stepId of downstreamIds) {
    const step = stepMap.get(stepId);
    if (!step) continue;
    if (step.status === "done" || step.status === "skipped") continue;

    const fromDate = startOfDay(step.dueAt);
    const toDate = skipWeekends
      ? addBusinessDays(fromDate, slipDays)
      : addDays(fromDate, slipDays);

    moves.push({
      stepId: step.id,
      stepTitle: step.title,
      fromDate,
      toDate,
      assigneeId: step.assigneeId,
    });

    // Detect assignee conflicts on same target date
    if (step.assigneeId) {
      const dateKey = `${step.assigneeId}:${toDate.toISOString().slice(0, 10)}`;
      const existing = assigneeWorkload.get(dateKey) ?? new Set();
      existing.add(step.id);
      assigneeWorkload.set(dateKey, existing);

      if (existing.size > 1) {
        breaches.push({
          kind: "assignee_overload",
          stepId: step.id,
          message: `Assignee has multiple concurrent deliverables landing on ${toDate.toLocaleDateString()}`,
        });
      }
    }
  }

  // Detect SLA breach if downstream delay exceeds 5 business days
  if (slipDays >= 5) {
    breaches.push({
      kind: "sla",
      stepId: slippedStepId,
      message: `Step "${slipped.title}" slipped by ${slipDays} days, threatening milestone SLAs.`,
    });
  }

  return {
    slippedStepId,
    slipDays,
    scopedRunHash: computeScopedRunHash(affectedSteps),
    moves,
    breaches,
  };
}
