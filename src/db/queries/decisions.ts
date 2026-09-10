import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { decisions } from "@/db/schema";
import type { DecisionOutcome } from "@/lib/decisions";

const DECISION_LIMIT = 100;

/** Builder exported for .toSQL() tests. */
export function decisionsQuery(workspaceId: string) {
  return db
    .select()
    .from(decisions)
    .where(eq(decisions.workspaceId, workspaceId))
    .orderBy(desc(decisions.createdAt))
    .limit(DECISION_LIMIT);
}

export type DecisionRow = Awaited<ReturnType<typeof decisionsQuery>>[number];

export async function listDecisions(workspaceId: string) {
  return decisionsQuery(workspaceId);
}

/** Builder exported for .toSQL() tests. Used on the client detail page. */
export function decisionsForClientQuery(workspaceId: string, clientId: string) {
  return db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.workspaceId, workspaceId),
        eq(decisions.clientId, clientId),
      ),
    )
    .orderBy(desc(decisions.createdAt))
    .limit(DECISION_LIMIT);
}

export async function listDecisionsForClient(
  workspaceId: string,
  clientId: string,
) {
  return decisionsForClientQuery(workspaceId, clientId);
}

/**
 * Builder exported for .toSQL() tests. Feeds the daily review cron
 * (decision-review.ts) — still-pending decisions whose review date has
 * arrived, for one workspace.
 */
export function dueForReviewQuery(workspaceId: string, now: Date) {
  return db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.workspaceId, workspaceId),
        eq(decisions.outcome, "pending"),
        lte(decisions.reviewAt, now),
      ),
    )
    .orderBy(desc(decisions.reviewAt))
    .limit(DECISION_LIMIT);
}

export async function listDueForReview(workspaceId: string, now: Date) {
  return dueForReviewQuery(workspaceId, now);
}

export async function createDecision(input: {
  workspaceId: string;
  clientId: string | null;
  goalId: string | null;
  title: string;
  reason: string;
  evidencePostIds: string[];
  insightId: string | null;
  expectedOutcome: string;
  reviewAt: Date;
  ownerId: string;
}): Promise<string> {
  const [row] = await db
    .insert(decisions)
    .values(input)
    .returning({ id: decisions.id });
  return row.id;
}

/** Guard-in-WHERE: outcome='pending' in the WHERE clause means a second
 *  reviewer's stale click affects 0 rows instead of overwriting the first
 *  verdict — a decision's recorded result is the audit trail the whole
 *  table exists for, so overwriting it silently would defeat the point. */
export async function recordDecisionOutcome(input: {
  workspaceId: string;
  decisionId: string;
  outcome: Exclude<DecisionOutcome, "pending">;
  outcomeNote: string | null;
}) {
  const rows = await db
    .update(decisions)
    .set({
      outcome: input.outcome,
      outcomeNote: input.outcomeNote,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(decisions.workspaceId, input.workspaceId),
        eq(decisions.id, input.decisionId),
        eq(decisions.outcome, "pending"),
      ),
    )
    .returning({ id: decisions.id });
  return rows.length > 0;
}

/** Stamped by the daily review cron the first time it surfaces a decision,
 *  so the next tick doesn't repost the same reminder to Team Hub. */
export async function markReviewSurfaced(input: {
  workspaceId: string;
  decisionId: string;
  at: Date;
}) {
  await db
    .update(decisions)
    .set({ reviewSurfacedAt: input.at })
    .where(
      and(
        eq(decisions.workspaceId, input.workspaceId),
        eq(decisions.id, input.decisionId),
      ),
    );
}

/**
 * Builder exported for .toSQL() tests. Scoped by workspace AND id — a
 * client-supplied clientId/goalId/insightId is validated elsewhere before
 * a decision is created; this is the read-back for rendering one decision.
 */
export function decisionByIdQuery(workspaceId: string, decisionId: string) {
  return db
    .select()
    .from(decisions)
    .where(
      and(eq(decisions.workspaceId, workspaceId), eq(decisions.id, decisionId)),
    )
    .limit(1);
}

export async function getDecisionById(workspaceId: string, decisionId: string) {
  const rows = await decisionByIdQuery(workspaceId, decisionId);
  return rows[0] ?? null;
}
