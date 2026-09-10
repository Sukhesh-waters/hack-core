import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, content, type ContentTypeValue } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { isValidTransition, type ProductionStage } from "@/lib/production";

/** Content rows under internal work-tracking, scoped to workspace, joined
 *  for client name — mirrors approvalQueueQuery's shape. */
export function productionQueueQuery(workspaceId: string) {
  return db
    .select({
      id: content.id,
      clientId: content.clientId,
      clientName: clients.name,
      title: content.title,
      type: content.type,
      productionStage: content.productionStage,
      revisionCount: content.revisionCount,
      createdAt: content.createdAt,
    })
    .from(content)
    .innerJoin(clients, eq(clients.id, content.clientId))
    .where(
      and(
        eq(content.workspaceId, workspaceId),
        isNotNull(content.productionStage),
      ),
    )
    .orderBy(asc(content.createdAt))
    // Board cap — small-agency scale; oldest-first so nothing in-flight hides.
    .limit(200);
}

export async function listProductionQueue(workspaceId: string) {
  return productionQueueQuery(workspaceId);
}

/** Direct kanban add — a card born on the board, not from an accepted idea.
 *  Seeds at "brief" like acceptIdea; status stays "draft" (production is
 *  independent of the approval pipeline — constitution). */
export async function createProductionCard(input: {
  workspaceId: string;
  clientId: string;
  title: string;
  type: ContentTypeValue;
}): Promise<string> {
  const [row] = await db
    .insert(content)
    .values({
      ...input,
      body: "",
      status: "draft",
      productionStage: "brief",
    })
    .returning({ id: content.id });
  return row.id;
}

/** Advances one card. Guards the transition against the stage graph and
 *  against a stale `from` (guard-in-WHERE, same pattern as decideHubApproval).
 *  Increments revision_count atomically on send-back. */
/** Guarded stage transition (exposed for SQL-shape assertions). The
 * productionStage=from predicate is what makes a raced/stale move a safe
 * no-op — advanceStage checks the returned row count to detect that. */
/**
 * Seeds a body onto a card that has none — the manual draft-entry path (G1)
 * for cards born on the kanban or calendar, which insert `body: ""` and have
 * no AI generation entry point the way accepted ideas do.
 *
 * Guards on the body still being empty in the WHERE, not just in a prior
 * read: two people opening the same stranded card would otherwise both pass
 * the read check and the second would silently overwrite the first. A 0-row
 * result means someone got there first — same race-guard shape as
 * advanceStageQuery.
 */
export function seedDraftBodyQuery(input: {
  workspaceId: string;
  contentId: string;
  body: string;
}) {
  return db
    .update(content)
    .set({ body: input.body })
    .where(
      and(
        eq(content.workspaceId, input.workspaceId),
        eq(content.id, input.contentId),
        or(isNull(content.body), eq(content.body, "")),
      ),
    )
    .returning({ id: content.id });
}

export function advanceStageQuery(input: {
  workspaceId: string;
  contentId: string;
  from: ProductionStage;
  to: ProductionStage;
}) {
  return db
    .update(content)
    .set({
      productionStage: input.to,
      ...(input.to === "revision"
        ? { revisionCount: sql`${content.revisionCount} + 1` }
        : {}),
    })
    .where(
      and(
        eq(content.workspaceId, input.workspaceId),
        eq(content.id, input.contentId),
        eq(content.productionStage, input.from),
      ),
    )
    .returning({ id: content.id });
}

export async function advanceStage(input: {
  workspaceId: string;
  contentId: string;
  from: ProductionStage;
  to: ProductionStage;
  actorId?: string | null;
}) {
  if (!isValidTransition(input.from, input.to)) {
    throw new Error("Invalid stage transition.");
  }
  // Check the affected-row count so a lost race (someone already moved this
  // card) surfaces a clear "already moved" error instead of a silent success
  // that did nothing.
  const moved = await advanceStageQuery(input);
  if (moved.length === 0) {
    throw new Error("This card was already moved. Refresh to see its stage.");
  }
  // Recorded only after the guard passes, so a lost race leaves no
  // history line claiming a move that never happened.
  await recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "content",
    subjectId: input.contentId,
    actorId: input.actorId ?? null,
    verb: "stage_advanced",
    meta: { from: input.from, to: input.to },
  });
}
