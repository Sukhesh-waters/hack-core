import { and, asc, desc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  clients,
  sopRunSteps,
  sopRuns,
  sopSteps,
  sopTemplates,
  users,
  type SopAssigneeRule,
  type StepCompletionPolicy,
} from "@/db/schema";
import type { MembershipRole } from "@/lib/permissions";
import { recordActivity } from "@/lib/activity";
import { notify } from "@/db/queries/notifications";
import { isRunComplete, reblockedStepIds, unblockedStepIds } from "@/lib/sop/instantiate";
import type { SopStepCreates, SopStepGate } from "@/lib/sop/template";


/**
 * S1 — SOP template reads.
 *
 * Every query takes workspaceId as its first argument and puts it in the
 * WHERE, including the child table: `sop_steps` carries its own
 * `workspace_id` rather than relying on the join to `sop_templates` for
 * isolation, so a step can never be reached through a template id guessed
 * from another workspace.
 */

/** Nothing in this product legitimately has thousands of templates or steps;
 *  the caps exist so a runaway row count can't turn one page into a scan. */
const TEMPLATE_LIMIT = 200;
const STEP_LIMIT = 200;

export type SopTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  anchorLabel: string;
  archivedAt: Date | null;
  createdAt: Date;
};

export type SopStepRow = {
  id: string;
  templateId: string;
  position: number;
  title: string;
  description: string | null;
  assigneeRule: SopAssigneeRule;
  dueOffsetDays: number;
  gate: SopStepGate;
  creates: SopStepCreates;
  completesWhen: StepCompletionPolicy;
  dependsOn: string[];
};

/** Live templates, newest first. Archived ones stay out of the picker but
 *  are never deleted — a run started from one must keep resolving. */
export function listSopTemplatesQuery(workspaceId: string) {
  return db
    .select({
      id: sopTemplates.id,
      name: sopTemplates.name,
      description: sopTemplates.description,
      anchorLabel: sopTemplates.anchorLabel,
      archivedAt: sopTemplates.archivedAt,
      createdAt: sopTemplates.createdAt,
    })
    .from(sopTemplates)
    .where(
      and(
        eq(sopTemplates.workspaceId, workspaceId),
        isNull(sopTemplates.archivedAt),
      ),
    )
    .orderBy(asc(sopTemplates.name))
    .limit(TEMPLATE_LIMIT);
}

export async function listSopTemplates(
  workspaceId: string,
): Promise<SopTemplateRow[]> {
  return listSopTemplatesQuery(workspaceId);
}

export function sopTemplateQuery(workspaceId: string, templateId: string) {
  return db
    .select({
      id: sopTemplates.id,
      name: sopTemplates.name,
      description: sopTemplates.description,
      anchorLabel: sopTemplates.anchorLabel,
      archivedAt: sopTemplates.archivedAt,
      createdAt: sopTemplates.createdAt,
    })
    .from(sopTemplates)
    .where(
      and(
        eq(sopTemplates.workspaceId, workspaceId),
        eq(sopTemplates.id, templateId),
      ),
    )
    .limit(1);
}

export function sopStepsQuery(workspaceId: string, templateId: string) {
  return db
    .select({
      id: sopSteps.id,
      templateId: sopSteps.templateId,
      position: sopSteps.position,
      title: sopSteps.title,
      description: sopSteps.description,
      assigneeRule: sopSteps.assigneeRule,
      dueOffsetDays: sopSteps.dueOffsetDays,
      gate: sopSteps.gate,
      creates: sopSteps.creates,
      completesWhen: sopSteps.completesWhen,
      dependsOn: sopSteps.dependsOn,
    })
    .from(sopSteps)
    .where(
      and(
        eq(sopSteps.workspaceId, workspaceId),
        eq(sopSteps.templateId, templateId),
      ),
    )
    .orderBy(asc(sopSteps.position), asc(sopSteps.createdAt))
    .limit(STEP_LIMIT);
}

/**
 * Step counts for every template in the workspace, in one grouped query.
 * The list page needs them to flag a template with no steps (which cannot
 * produce a run); fetching them per card would be one query per template.
 */
export function sopStepCountsQuery(workspaceId: string) {
  return db
    .select({
      templateId: sopSteps.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(sopSteps)
    .where(eq(sopSteps.workspaceId, workspaceId))
    .groupBy(sopSteps.templateId)
    .limit(TEMPLATE_LIMIT);
}

export async function sopStepCounts(
  workspaceId: string,
): Promise<Map<string, number>> {
  const rows = await sopStepCountsQuery(workspaceId);
  return new Map(rows.map((r) => [r.templateId, r.count]));
}

export type LoadedSopTemplate = {
  template: SopTemplateRow;
  steps: SopStepRow[];
};

/**
 * A template with its steps, or null when the id names nothing in this
 * workspace. Returning null rather than throwing lets the page render a
 * 404 instead of a stack trace for a stale bookmark.
 */
export async function loadSopTemplate(
  workspaceId: string,
  templateId: string,
): Promise<LoadedSopTemplate | null> {
  const [template] = await sopTemplateQuery(workspaceId, templateId);
  if (!template) return null;
  const steps = (await sopStepsQuery(
    workspaceId,
    templateId,
  )) as SopStepRow[];
  return { template, steps };
}

/**
 * The next free position in a template. Appending at `count` would collide
 * the moment a middle step is deleted (5 steps, delete #2, next append also
 * lands on 4), which silently ties two steps and lets the tiebreak decide
 * the order.
 */
export async function nextStepPosition(
  workspaceId: string,
  templateId: string,
): Promise<number> {
  const [row] = await db
    .select({ highest: max(sopSteps.position) })
    .from(sopSteps)
    .where(
      and(
        eq(sopSteps.workspaceId, workspaceId),
        eq(sopSteps.templateId, templateId),
      ),
    )
    .limit(1);
  return (row?.highest ?? -1) + 1;
}

/** Confirms a template id belongs to this workspace before any child write.
 *  A step insert takes a templateId from the client; without this an id
 *  guessed from another workspace would attach a step to someone else's
 *  template. */
export async function templateBelongsToWorkspace(
  workspaceId: string,
  templateId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sopTemplates.id })
    .from(sopTemplates)
    .where(
      and(
        eq(sopTemplates.workspaceId, workspaceId),
        eq(sopTemplates.id, templateId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// S2 — runs.
// ---------------------------------------------------------------------------

const RUN_LIMIT = 200;
const RUN_STEP_LIMIT = 300;

export type SopRunRow = {
  id: string;
  templateId: string | null;
  clientId: string | null;
  clientName: string | null;
  name: string;
  anchorDate: Date;
  status: "active" | "completed" | "cancelled";
  createdAt: Date;
  completedAt: Date | null;
};

export type SopRunStepRow = {
  id: string;
  runId: string;
  position: number;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeRole: MembershipRole | null;
  dueAt: Date;
  status: "blocked" | "ready" | "in_progress" | "done" | "skipped";
  gate: SopStepGate;
  creates: SopStepCreates;
  completesWhen: StepCompletionPolicy;
  dependsOn: string[];
  linkedType: string | null;
  linkedId: string | null;
  rejectionReason?: string | null;
  completedAt: Date | null;
};

/** Runs newest first. Left-joined to clients so a run whose client was
 *  removed still lists rather than vanishing. */
export function listSopRunsQuery(workspaceId: string) {
  return db
    .select({
      id: sopRuns.id,
      templateId: sopRuns.templateId,
      clientId: sopRuns.clientId,
      clientName: clients.name,
      name: sopRuns.name,
      anchorDate: sopRuns.anchorDate,
      status: sopRuns.status,
      createdAt: sopRuns.createdAt,
      completedAt: sopRuns.completedAt,
    })
    .from(sopRuns)
    .leftJoin(clients, eq(sopRuns.clientId, clients.id))
    .where(eq(sopRuns.workspaceId, workspaceId))
    .orderBy(desc(sopRuns.createdAt))
    .limit(RUN_LIMIT);
}

export async function listSopRuns(workspaceId: string): Promise<SopRunRow[]> {
  return listSopRunsQuery(workspaceId) as unknown as Promise<SopRunRow[]>;
}

export function sopRunQuery(workspaceId: string, runId: string) {
  return db
    .select({
      id: sopRuns.id,
      templateId: sopRuns.templateId,
      clientId: sopRuns.clientId,
      clientName: clients.name,
      name: sopRuns.name,
      anchorDate: sopRuns.anchorDate,
      status: sopRuns.status,
      createdAt: sopRuns.createdAt,
      completedAt: sopRuns.completedAt,
    })
    .from(sopRuns)
    .leftJoin(clients, eq(sopRuns.clientId, clients.id))
    .where(and(eq(sopRuns.workspaceId, workspaceId), eq(sopRuns.id, runId)))
    .limit(1);
}

/** Steps in author order. `position` can tie after a template reorder, so
 *  due date then created_at break it — the run must render the same way
 *  twice in a row. */
export function sopRunStepsQuery(workspaceId: string, runId: string) {
  return db
    .select({
      id: sopRunSteps.id,
      runId: sopRunSteps.runId,
      position: sopRunSteps.position,
      title: sopRunSteps.title,
      description: sopRunSteps.description,
      assigneeId: sopRunSteps.assigneeId,
      assigneeRole: sopRunSteps.assigneeRole,
      dueAt: sopRunSteps.dueAt,
      status: sopRunSteps.status,
      gate: sopRunSteps.gate,
      creates: sopRunSteps.creates,
      completesWhen: sopRunSteps.completesWhen,
      dependsOn: sopRunSteps.dependsOn,
      linkedType: sopRunSteps.linkedType,
      linkedId: sopRunSteps.linkedId,
      rejectionReason: sopRunSteps.rejectionReason,
      completedAt: sopRunSteps.completedAt,
    })
    .from(sopRunSteps)
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        eq(sopRunSteps.runId, runId),
      ),
    )
    .orderBy(
      asc(sopRunSteps.position),
      asc(sopRunSteps.dueAt),
      asc(sopRunSteps.createdAt),
    )
    .limit(RUN_STEP_LIMIT);
}

export type LoadedSopRun = { run: SopRunRow; steps: SopRunStepRow[] };

export async function loadSopRun(
  workspaceId: string,
  runId: string,
): Promise<LoadedSopRun | null> {
  const [run] = await sopRunQuery(workspaceId, runId);
  if (!run) return null;
  const steps = (await sopRunStepsQuery(
    workspaceId,
    runId,
  )) as SopRunStepRow[];
  return { run: run as SopRunRow, steps };
}

export type SopRunActivityItem = {
  id: string;
  subjectType: string;
  subjectId: string;
  actorId: string | null;
  actorName: string | null;
  verb: string;
  meta: Record<string, unknown> | null;
  createdAt: Date;
};

/**
 * Activity log for an SOP run (E3) — selects activity events belonging
 * to the run itself or any of its steps, newest first.
 */
export function activityForRunQuery(
  workspaceId: string,
  runId: string,
  stepIds: string[] = [],
) {
  return db
    .select({
      id: activity.id,
      subjectType: activity.subjectType,
      subjectId: activity.subjectId,
      actorId: activity.actorId,
      actorName: users.name,
      verb: activity.verb,
      meta: activity.meta,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .leftJoin(users, eq(activity.actorId, users.id))
    .where(
      and(
        eq(activity.workspaceId, workspaceId),
        or(
          eq(activity.subjectId, runId),
          sql`${activity.meta}->>'runId' = ${runId}`,
          stepIds.length > 0 ? inArray(activity.subjectId, stepIds) : sql`false`,
        ),
      ),
    )
    .orderBy(desc(activity.createdAt))
    .limit(50);
}

export async function listActivityForRun(
  workspaceId: string,
  runId: string,
  stepIds: string[] = [],
): Promise<SopRunActivityItem[]> {
  return activityForRunQuery(workspaceId, runId, stepIds);
}

/** Open-step counts per run, in one grouped query — the list needs
 *  "3 of 7 done" without loading every run's steps. */
export function sopRunProgressQuery(workspaceId: string) {
  return db
    .select({
      runId: sopRunSteps.runId,
      total: sql<number>`count(*)::int`,
      closed: sql<number>`count(*) filter (where ${sopRunSteps.status} in ('done','skipped'))::int`,
      overdue: sql<number>`count(*) filter (where ${sopRunSteps.status} not in ('done','skipped') and ${sopRunSteps.dueAt} < now())::int`,
    })
    .from(sopRunSteps)
    .where(eq(sopRunSteps.workspaceId, workspaceId))
    .groupBy(sopRunSteps.runId)
    .limit(RUN_LIMIT);
}

export type SopRunProgress = {
  total: number;
  closed: number;
  overdue: number;
};

export async function sopRunProgress(
  workspaceId: string,
): Promise<Map<string, SopRunProgress>> {
  const rows = await sopRunProgressQuery(workspaceId);
  return new Map(
    rows.map((r) => [
      r.runId,
      { total: r.total, closed: r.closed, overdue: r.overdue },
    ]),
  );
}

// ---------------------------------------------------------------------------
// S3 — moving a run forward.
// ---------------------------------------------------------------------------

export type StepMoveResult =
  | { ok: true; unblocked: number; runCompleted: boolean }
  | { ok: false; error: string };

/**
 * The guarded write, plus the cascade it causes.
 *
 * `status IN (expectFrom)` in the WHERE is what makes a raced or stale move
 * match zero rows instead of applying twice — the same discipline the
 * workflow engine's transitions use. Two people clicking "Done" on the same
 * step get one write and one honest error, not two completions and a
 * doubled cascade.
 *
 * Unblocking and run-completion happen in the SAME transaction as the
 * status change. Splitting them would let a completed step leave its
 * dependents blocked forever if the second write failed — the exact
 * deadlock the dependency graph exists to avoid.
 */
export async function moveRunStep(input: {
  workspaceId: string;
  runId: string;
  stepId: string;
  userId: string;
  to: "in_progress" | "done" | "skipped" | "ready";
  expectFrom: readonly string[];
  rejectionReason?: string | null;
}): Promise<StepMoveResult> {
  const { workspaceId, runId, stepId, userId, to, expectFrom, rejectionReason } = input;
  const closing = to === "done" || to === "skipped";
  const reopening = expectFrom.some((f) => f === "done" || f === "skipped") && (to === "ready" || to === "in_progress");

  try {
    const res = await db.transaction(async (tx) => {
      const patch: Record<string, unknown> = {
        status: to,
        completedAt: closing ? new Date() : null,
        completedById: closing ? userId : null,
      };
      if (closing) {
        patch.rejectionReason = null;
      } else if (rejectionReason !== undefined) {
        patch.rejectionReason = rejectionReason;
      }

      const updated = await tx
        .update(sopRunSteps)
        .set(patch)
        .where(
          and(
            eq(sopRunSteps.workspaceId, workspaceId),
            eq(sopRunSteps.runId, runId),
            eq(sopRunSteps.id, stepId),
            inArray(sopRunSteps.status, [...expectFrom] as never[]),
          ),
        )
        .returning({ id: sopRunSteps.id });

      if (updated.length === 0) {
        return {
          ok: false as const,
          error: "That step already moved — reload to see where it is now.",
        };
      }

      const steps = await tx
        .select({
          id: sopRunSteps.id,
          title: sopRunSteps.title,
          assigneeId: sopRunSteps.assigneeId,
          status: sopRunSteps.status,
          dependsOn: sopRunSteps.dependsOn,
        })
        .from(sopRunSteps)
        .where(
          and(
            eq(sopRunSteps.workspaceId, workspaceId),
            eq(sopRunSteps.runId, runId),
          ),
        )
        .limit(RUN_STEP_LIMIT);

      if (reopening) {
        const toReblock = reblockedStepIds(steps);
        if (toReblock.length > 0) {
          await tx
            .update(sopRunSteps)
            .set({ status: "blocked" })
            .where(
              and(
                eq(sopRunSteps.workspaceId, workspaceId),
                eq(sopRunSteps.runId, runId),
                inArray(sopRunSteps.id, toReblock),
                eq(sopRunSteps.status, "ready"),
              ),
            );
        }

        await tx
          .update(sopRuns)
          .set({ status: "active", completedAt: null })
          .where(
            and(
              eq(sopRuns.workspaceId, workspaceId),
              eq(sopRuns.id, runId),
            ),
          );

        await recordActivity(
          {
            workspaceId,
            subjectType: "sop_run_step",
            subjectId: stepId,
            actorId: userId,
            verb: "reopened",
            meta: { runId, toStatus: to, reblockedCount: toReblock.length },
          },
          tx,
        );

        return {
          ok: true as const,
          unblocked: 0,
          runCompleted: false,
        };
      }

      if (!closing) {
        return { ok: true as const, unblocked: 0, runCompleted: false };
      }

      const toUnblock = unblockedStepIds(steps);
      if (toUnblock.length > 0) {
        await tx
          .update(sopRunSteps)
          .set({ status: "ready" })
          .where(
            and(
              eq(sopRunSteps.workspaceId, workspaceId),
              eq(sopRunSteps.runId, runId),
              inArray(sopRunSteps.id, toUnblock),
              // Re-assert blocked: another transaction may have moved one
              // already, and this must never drag a started step backwards.
              eq(sopRunSteps.status, "blocked"),
            ),
          );

        // Notify assignees of steps that just unblocked (E2)
        const unblockedSteps = steps.filter((s) => toUnblock.includes(s.id));
        for (const unblocked of unblockedSteps) {
          if (unblocked.assigneeId && unblocked.assigneeId !== userId) {
            await notify(
              {
                workspaceId,
                userId: unblocked.assigneeId,
                kind: "ready",
                subjectType: "sop_run_step",
                subjectId: unblocked.id,
                body: `Step "${unblocked.title}" is now unblocked and ready for you.`,
              },
              tx,
            );
          }
        }
      }

      const runCompleted = isRunComplete(steps);
      if (runCompleted) {
        await tx
          .update(sopRuns)
          .set({ status: "completed", completedAt: new Date() })
          .where(
            and(
              eq(sopRuns.workspaceId, workspaceId),
              eq(sopRuns.id, runId),
              eq(sopRuns.status, "active"),
            ),
          );
      }

      return {
        ok: true as const,
        unblocked: toUnblock.length,
        runCompleted,
      };
    });

    return res;
  } catch {
    return { ok: false, error: "Couldn't move that step. Nothing changed." };
  }
}

/** Sets or clears a run step's owner. Scoped by workspace + run + step so a
 *  step id alone can't reassign work in another workspace. */
export async function assignRunStep(input: {
  workspaceId: string;
  runId: string;
  stepId: string;
  assigneeId: string | null;
}): Promise<boolean> {
  const rows = await db
    .update(sopRunSteps)
    .set({ assigneeId: input.assigneeId })
    .where(
      and(
        eq(sopRunSteps.workspaceId, input.workspaceId),
        eq(sopRunSteps.runId, input.runId),
        eq(sopRunSteps.id, input.stepId),
      ),
    )
    .returning({ id: sopRunSteps.id });
  return rows.length > 0;
}

/** One step, workspace-scoped — for checking a gate before acting on it. */
export async function getRunStep(
  workspaceId: string,
  runId: string,
  stepId: string,
) {
  const [row] = await db
    .select({
      id: sopRunSteps.id,
      status: sopRunSteps.status,
      gate: sopRunSteps.gate,
      title: sopRunSteps.title,
      assigneeId: sopRunSteps.assigneeId,
    })
    .from(sopRunSteps)
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        eq(sopRunSteps.runId, runId),
        eq(sopRunSteps.id, stepId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Cancels an active SOP run, skips all non-done steps, and records audit trail. */
export async function cancelSopRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
}): Promise<{ ok: true; skippedCount: number } | { ok: false; error: string }> {
  try {
    const res = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: sopRuns.id, status: sopRuns.status })
        .from(sopRuns)
        .where(
          and(
            eq(sopRuns.workspaceId, input.workspaceId),
            eq(sopRuns.id, input.runId),
          ),
        )
        .limit(1);

      if (!run) return { ok: false as const, error: "Run not found." };
      if (run.status === "completed" || run.status === "cancelled") {
        return { ok: false as const, error: `Run is already ${run.status}.` };
      }

      // Mark run cancelled
      await tx
        .update(sopRuns)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(
          and(
            eq(sopRuns.workspaceId, input.workspaceId),
            eq(sopRuns.id, input.runId),
          ),
        );

      // Skip non-done steps
      const skipped = await tx
        .update(sopRunSteps)
        .set({ status: "skipped" })
        .where(
          and(
            eq(sopRunSteps.workspaceId, input.workspaceId),
            eq(sopRunSteps.runId, input.runId),
            inArray(sopRunSteps.status, ["ready", "in_progress", "blocked"]),
          ),
        )
        .returning({ id: sopRunSteps.id });

      await recordActivity(
        {
          workspaceId: input.workspaceId,
          actorId: input.userId,
          verb: "status_changed",
          subjectType: "sop_run_step",
          subjectId: input.runId,
          meta: { status: "cancelled", skippedSteps: skipped.length },
        },
        tx,
      );

      return { ok: true as const, skippedCount: skipped.length };
    });

    return res;
  } catch {
    return { ok: false, error: "Couldn't cancel that run." };
  }
}

// ---------------------------------------------------------------------------
// S4 — gates.
// ---------------------------------------------------------------------------

/** Open statuses. A closed step has nothing left to decide. */
export const OPEN_STEP_STATUSES = ["ready", "in_progress"] as const;

export type PendingGateStep = {
  id: string;
  runId: string;
  runName: string;
  clientName: string | null;
  title: string;
  description: string | null;
  dueAt: Date;
  assigneeId: string | null;
  gate: SopStepGate;
  linkedType: string | null;
  linkedId: string | null;
};

/**
 * Run steps waiting on a human decision — the approval queue's SOP half.
 *
 * Only steps in an ACTIVE run: a cancelled run's gates are not decisions
 * anyone still needs to make, and leaving them in the queue would train
 * people to ignore it. Blocked steps are excluded too — their dependency,
 * not the approver, is what they're waiting on.
 */
export function pendingGateStepsQuery(
  workspaceId: string,
  gate: SopStepGate,
) {
  return db
    .select({
      id: sopRunSteps.id,
      runId: sopRunSteps.runId,
      runName: sopRuns.name,
      clientName: clients.name,
      title: sopRunSteps.title,
      description: sopRunSteps.description,
      dueAt: sopRunSteps.dueAt,
      assigneeId: sopRunSteps.assigneeId,
      gate: sopRunSteps.gate,
      linkedType: sopRunSteps.linkedType,
      linkedId: sopRunSteps.linkedId,
    })
    .from(sopRunSteps)
    .innerJoin(sopRuns, eq(sopRunSteps.runId, sopRuns.id))
    .leftJoin(clients, eq(sopRuns.clientId, clients.id))
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        eq(sopRunSteps.gate, gate),
        inArray(sopRunSteps.status, [...OPEN_STEP_STATUSES] as never[]),
        eq(sopRuns.status, "active"),
      ),
    )
    .orderBy(asc(sopRunSteps.dueAt))
    .limit(RUN_STEP_LIMIT);
}

export async function listPendingApprovalGates(
  workspaceId: string,
): Promise<PendingGateStep[]> {
  return pendingGateStepsQuery(
    workspaceId,
    "approval",
  ) as unknown as Promise<PendingGateStep[]>;
}

/**
 * Closes any compliance-gated run step linked to this content, when its
 * check has actually passed.
 *
 * Called from the studio's compliance action rather than reimplemented
 * there: the gate closes because the real check really passed, in the place
 * it really runs. A SOP-specific copy of the compliance logic would be a
 * second source of truth about whether a draft is compliant.
 *
 * Returns the run ids touched so the caller can revalidate them. Failure to
 * find anything is the normal case (most content isn't part of a run), not
 * an error.
 */
export async function closeComplianceGatesForContent(input: {
  workspaceId: string;
  contentId: string;
  userId: string;
}): Promise<string[]> {
  const { workspaceId, contentId, userId } = input;

  const open = await db
    .select({ id: sopRunSteps.id, runId: sopRunSteps.runId })
    .from(sopRunSteps)
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        eq(sopRunSteps.linkedType, "content"),
        eq(sopRunSteps.linkedId, contentId),
        eq(sopRunSteps.gate, "compliance"),
        inArray(sopRunSteps.status, [...OPEN_STEP_STATUSES] as never[]),
      ),
    )
    .limit(RUN_STEP_LIMIT);

  const touched: string[] = [];
  for (const step of open) {
    // Each goes through the same guarded move as a manual one, so the
    // unblocking cascade and run-completion happen identically.
    const result = await moveRunStep({
      workspaceId,
      runId: step.runId,
      stepId: step.id,
      userId,
      to: "done",
      expectFrom: OPEN_STEP_STATUSES,
    });
    if (result.ok) touched.push(step.runId);
  }
  return touched;
}

// ---------------------------------------------------------------------------
// S5 — rescheduling, explicitly.
// ---------------------------------------------------------------------------

/**
 * Applies a set of new due dates in one transaction.
 *
 * Each row re-asserts that the step is still open in its WHERE. A step
 * someone finished while the reschedule dialog was open must keep the date
 * it was actually finished against — quietly moving it would rewrite when
 * the work happened.
 */
export async function applyRescheduledDates(input: {
  workspaceId: string;
  runId: string;
  moves: { id: string; dueAt: Date }[];
}): Promise<number> {
  const { workspaceId, runId, moves } = input;
  if (moves.length === 0) return 0;

  const moved = await db.transaction(async (tx) => {
    let count = 0;
    for (const move of moves) {
      const rows = await tx
        .update(sopRunSteps)
        .set({ dueAt: move.dueAt })
        .where(
          and(
            eq(sopRunSteps.workspaceId, workspaceId),
            eq(sopRunSteps.runId, runId),
            eq(sopRunSteps.id, move.id),
            inArray(sopRunSteps.status, [
              "blocked",
              "ready",
              "in_progress",
            ] as never[]),
          ),
        )
        .returning({ id: sopRunSteps.id });
      count += rows.length;
    }
    return count;
  });

  return moved;
}

/**
 * Re-anchors an entire active SOP run (E9): updates sopRuns.anchorDate and
 * shifts all open steps in one transaction, recording an audit activity row.
 */
export async function reanchorSopRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  newAnchorDate: Date;
  days: number;
  moves: { id: string; dueAt: Date }[];
}): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const { workspaceId, runId, userId, newAnchorDate, days, moves } = input;

  try {
    const moved = await db.transaction(async (tx) => {
      // 1. Update run anchor date
      const updatedRun = await tx
        .update(sopRuns)
        .set({ anchorDate: newAnchorDate })
        .where(
          and(
            eq(sopRuns.workspaceId, workspaceId),
            eq(sopRuns.id, runId),
            eq(sopRuns.status, "active"),
          ),
        )
        .returning({ id: sopRuns.id, name: sopRuns.name });

      if (updatedRun.length === 0) {
        throw new Error("Run is not active or not found");
      }

      // 2. Update open steps
      let count = 0;
      for (const move of moves) {
        const rows = await tx
          .update(sopRunSteps)
          .set({ dueAt: move.dueAt })
          .where(
            and(
              eq(sopRunSteps.workspaceId, workspaceId),
              eq(sopRunSteps.runId, runId),
              eq(sopRunSteps.id, move.id),
              inArray(sopRunSteps.status, [
                "blocked",
                "ready",
                "in_progress",
              ] as never[]),
            ),
          )
          .returning({ id: sopRunSteps.id });
        count += rows.length;
      }

      // 3. Record audit activity
      await recordActivity(
        {
          workspaceId,
          subjectType: "sop_run_step",
          subjectId: runId,
          actorId: userId,
          verb: "run_reanchored",
          meta: {
            runId,
            days,
            newAnchorDate: newAnchorDate.toISOString(),
            movedCount: count,
          },
        },
        tx,
      );

      return count;
    });

    return { ok: true, moved };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to re-anchor run",
    };
  }
}

