import { and, asc, eq, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  content,
  memberships,
  sopRunSteps,
  sopRuns,
  tickets,
  users,
  workflowStates,
} from "@/db/schema";


const METRICS_LIMIT = 100;

export type CycleTimeResult = {
  stateKey: string;
  sampleCount: number;
  avgHours: number | null;
  hasEnoughData: boolean;
};

/** Minimum sample count required by the Min-N gate to display average cycle time. */
export const MIN_N_THRESHOLD = 5;

/**
 * D2 — Cycle time per state.
 * Derives average duration (in hours) a content item spent in a state before being transitioned out.
 * Grounded in `activity` rows with `verb = 'stage_advanced'`.
 * Min-N gate: returns avgHours = null when sampleCount < MIN_N_THRESHOLD.
 */
export function cycleTimeByStateQuery(workspaceId: string) {
  const transitions = db
    .select({
      meta: activity.meta,
      createdAt: activity.createdAt,
      lagCreatedAt: sql<Date>`lag(${activity.createdAt}) over (partition by ${activity.subjectId} order by ${activity.createdAt})`.as(
        "lag_created_at",
      ),
    })
    .from(activity)
    .where(
      and(
        eq(activity.workspaceId, workspaceId),
        eq(activity.subjectType, "content"),
        eq(activity.verb, "stage_advanced"),
      ),
    )
    .as("transitions");

  return db
    .select({
      stateKey: sql<string>`${transitions.meta}->>'to'`,
      sampleCount: sql<number>`count(*)::int`,
      avgHours: sql<number | null>`
        case
          when count(*) >= ${MIN_N_THRESHOLD}
          then round(avg(extract(epoch from (${transitions.createdAt} - ${transitions.lagCreatedAt})) / 3600.0)::numeric, 1)::float
          else null
        end
      `,
    })
    .from(transitions)
    .where(sql`${transitions.lagCreatedAt} is not null`)
    .groupBy(sql`${transitions.meta}->>'to'`)
    .limit(METRICS_LIMIT);
}

export async function getCycleTimeByState(
  workspaceId: string,
): Promise<CycleTimeResult[]> {
  const rows = await cycleTimeByStateQuery(workspaceId);
  return rows.map((r) => ({
    stateKey: r.stateKey,
    sampleCount: r.sampleCount,
    avgHours: r.avgHours,
    hasEnoughData: r.sampleCount >= MIN_N_THRESHOLD && r.avgHours !== null,
  }));
}

export type WipVsLimitRow = {
  stateId: string;
  stateName: string;
  stateKey: string;
  colorKey: string;
  position: number;
  wipLimit: number | null;
  currentCount: number;
  isOverLimit: boolean;
};

/**
 * D2 — WIP vs Limit.
 * Counts content items per workflow state against the state's WIP limit.
 */
export function wipVsLimitQuery(workspaceId: string) {
  return db
    .select({
      stateId: workflowStates.id,
      stateName: workflowStates.name,
      stateKey: workflowStates.key,
      colorKey: workflowStates.colorKey,
      position: workflowStates.position,
      wipLimit: workflowStates.wipLimit,
      currentCount: sql<number>`count(${content.id})::int`,
    })
    .from(workflowStates)
    .leftJoin(
      content,
      and(
        eq(content.workflowStateId, workflowStates.id),
        eq(content.workspaceId, workspaceId),
      ),
    )
    .where(eq(workflowStates.workspaceId, workspaceId))
    .groupBy(workflowStates.id)
    .orderBy(asc(workflowStates.position))
    .limit(METRICS_LIMIT);
}

export async function getWipVsLimit(
  workspaceId: string,
): Promise<WipVsLimitRow[]> {
  const rows = await wipVsLimitQuery(workspaceId);
  return rows.map((r) => ({
    ...r,
    isOverLimit: r.wipLimit !== null && r.currentCount > r.wipLimit,
  }));
}

export type OverdueLoadRow = {
  runId: string;
  runName: string;
  stepId: string;
  stepTitle: string;
  dueAt: Date;
  assigneeId: string | null;
  assigneeName: string | null;
};

/**
 * D2 — Overdue Load.
 * Open `sop_run_steps` past `due_at`, grouped by run and assignee.
 * Workspace-scoped and limited.
 */
export function overdueLoadQuery(workspaceId: string) {
  return db
    .select({
      runId: sopRuns.id,
      runName: sopRuns.name,
      stepId: sopRunSteps.id,
      stepTitle: sopRunSteps.title,
      dueAt: sopRunSteps.dueAt,
      assigneeId: sopRunSteps.assigneeId,
      assigneeName: users.name,
    })
    .from(sopRunSteps)
    .innerJoin(
      sopRuns,
      and(
        eq(sopRunSteps.runId, sopRuns.id),
        eq(sopRuns.status, "active"),
      ),
    )
    .leftJoin(users, eq(sopRunSteps.assigneeId, users.id))
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        notInArray(sopRunSteps.status, ["done", "skipped"]),
        lt(sopRunSteps.dueAt, sql`now()`),
      ),
    )
    .orderBy(asc(sopRunSteps.dueAt))
    .limit(METRICS_LIMIT);
}

export async function getOverdueLoad(
  workspaceId: string,
): Promise<OverdueLoadRow[]> {
  return overdueLoadQuery(workspaceId);
}

export type OwnerLoadRow = {
  userId: string;
  userName: string | null;
  userEmail: string;
  openStepCount: number;
  openTicketCount: number;
  openContentCount: number;
  totalLoad: number;
};

/**
 * D2 — Per-owner Load.
 * Aggregates open steps, open tickets, and assigned content per workspace member in SQL.
 */
export function ownerLoadQuery(workspaceId: string) {
  return db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      openStepCount: sql<number>`coalesce((
        select count(*)::int from ${sopRunSteps}
        inner join ${sopRuns} on ${sopRunSteps.runId} = ${sopRuns.id}
        where ${sopRunSteps.workspaceId} = ${workspaceId}
          and ${sopRunSteps.assigneeId} = ${users.id}
          and ${sopRunSteps.status} not in ('done', 'skipped')
          and ${sopRuns.status} = 'active'
      ), 0)`,
      openTicketCount: sql<number>`coalesce((
        select count(*)::int from ${tickets}
        where ${tickets.workspaceId} = ${workspaceId}
          and ${tickets.assigneeId} = ${users.id}
          and ${tickets.status} != 'done'
      ), 0)`,
      openContentCount: sql<number>`coalesce((
        select count(*)::int from ${content}
        where ${content.workspaceId} = ${workspaceId}
          and ${content.assigneeId} = ${users.id}
      ), 0)`,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.workspaceId, workspaceId))
    .limit(METRICS_LIMIT);
}

export async function getOwnerLoad(
  workspaceId: string,
): Promise<OwnerLoadRow[]> {
  const rows = await ownerLoadQuery(workspaceId);
  return rows.map((r) => ({
    ...r,
    totalLoad: r.openStepCount + r.openTicketCount + r.openContentCount,
  }));
}
