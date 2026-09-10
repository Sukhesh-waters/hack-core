import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientGoals } from "@/db/schema";
import type { ClientGoalStatus } from "@/lib/client-goals";

const GOAL_LIMIT = 50;

/** Builder exported for .toSQL() tests. */
export function clientGoalsQuery(workspaceId: string, clientId: string) {
  return db
    .select()
    .from(clientGoals)
    .where(
      and(
        eq(clientGoals.workspaceId, workspaceId),
        eq(clientGoals.clientId, clientId),
      ),
    )
    .orderBy(desc(clientGoals.createdAt))
    .limit(GOAL_LIMIT);
}

export type ClientGoalRow = Awaited<ReturnType<typeof clientGoalsQuery>>[number];

export async function listClientGoals(workspaceId: string, clientId: string) {
  return clientGoalsQuery(workspaceId, clientId);
}

/** Builder exported for .toSQL() tests. Used by the ideation goal picker. */
export function activeGoalsForClientQuery(
  workspaceId: string,
  clientId: string,
) {
  return db
    .select({
      id: clientGoals.id,
      title: clientGoals.title,
      hypothesis: clientGoals.hypothesis,
      metric: clientGoals.metric,
    })
    .from(clientGoals)
    .where(
      and(
        eq(clientGoals.workspaceId, workspaceId),
        eq(clientGoals.clientId, clientId),
        eq(clientGoals.status, "active"),
      ),
    )
    .orderBy(desc(clientGoals.createdAt))
    .limit(GOAL_LIMIT);
}

export async function listActiveGoalsForClient(
  workspaceId: string,
  clientId: string,
) {
  return activeGoalsForClientQuery(workspaceId, clientId);
}

/**
 * Builder exported for .toSQL() tests. Scoped by workspace, client, AND id —
 * a client-supplied goalId is never proof it belongs here (same posture as
 * requireTemplateId's comment in sop/actions.ts). Used server-side before
 * trusting a goal picked in the ideation form.
 */
export function clientGoalByIdQuery(
  workspaceId: string,
  clientId: string,
  goalId: string,
) {
  return db
    .select({
      id: clientGoals.id,
      title: clientGoals.title,
      hypothesis: clientGoals.hypothesis,
    })
    .from(clientGoals)
    .where(
      and(
        eq(clientGoals.workspaceId, workspaceId),
        eq(clientGoals.clientId, clientId),
        eq(clientGoals.id, goalId),
      ),
    )
    .limit(1);
}

export async function getClientGoalById(
  workspaceId: string,
  clientId: string,
  goalId: string,
) {
  const rows = await clientGoalByIdQuery(workspaceId, clientId, goalId);
  return rows[0] ?? null;
}

export async function createClientGoal(input: {
  workspaceId: string;
  clientId: string;
  title: string;
  hypothesis: string | null;
  metric: string;
  targetWindowStart: Date;
  targetWindowEnd: Date;
  createdById: string;
}) {
  await db.insert(clientGoals).values(input);
}

/** Guard-in-WHERE: a stale click affects 0 rows rather than another
 *  workspace's goal. Mirrors the production-board transition idiom. */
export async function setClientGoalStatus(input: {
  workspaceId: string;
  goalId: string;
  status: ClientGoalStatus;
}) {
  await db
    .update(clientGoals)
    .set({ status: input.status, updatedAt: new Date() })
    .where(
      and(
        eq(clientGoals.workspaceId, input.workspaceId),
        eq(clientGoals.id, input.goalId),
      ),
    );
}
