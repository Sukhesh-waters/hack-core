import { and, count, eq, gte, inArray, isNotNull, isNull, sum } from "drizzle-orm";
import { db } from "@/db";
import { platinaAuditRuns, platinaBrainChunks, platinaCreativeReviews } from "@/db/platina-schema";
import { aiUsage, clients, knowledgeSources } from "@/db/schema";

/**
 * Read-only facts for the ops board (C7.1), across both products. Lives
 * outside Platina (lib/ops, not lib/platina) because the first-party
 * knowledge check reads InstaMedia's knowledge tables. Every query filters
 * workspace_id.
 */

export function knowledgeSourcesWithUrlQuery(workspaceId: string) {
  return db
    .select({
      id: knowledgeSources.id,
      clientId: knowledgeSources.clientId,
      url: knowledgeSources.url,
      status: knowledgeSources.status,
      chunkCount: knowledgeSources.chunkCount,
    })
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.workspaceId, workspaceId), isNotNull(knowledgeSources.url)));
}

export function clientNamesQuery(workspaceId: string) {
  return db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.workspaceId, workspaceId));
}

export function embedFailuresSinceQuery(workspaceId: string, since: Date) {
  return db
    .select({ n: count() })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        eq(aiUsage.kind, "embed"),
        eq(aiUsage.status, "failed"),
        gte(aiUsage.createdAt, since),
      ),
    );
}

export function aiCostSinceQuery(workspaceId: string, since: Date) {
  return db
    .select({ usd: sum(aiUsage.costUsd) })
    .from(aiUsage)
    .where(and(eq(aiUsage.workspaceId, workspaceId), gte(aiUsage.createdAt, since)));
}

export function unembeddedBrainCountQuery(workspaceId: string) {
  return db
    .select({ n: count() })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        isNull(platinaBrainChunks.embedding),
        eq(platinaBrainChunks.status, "active"),
      ),
    );
}

export function activeRunsQuery(workspaceId: string) {
  return db
    .select({ id: platinaAuditRuns.id, startedAt: platinaAuditRuns.startedAt, queuedAt: platinaAuditRuns.queuedAt })
    .from(platinaAuditRuns)
    .where(and(eq(platinaAuditRuns.workspaceId, workspaceId), inArray(platinaAuditRuns.status, ["running", "validating"])));
}

export function draftReviewsCountQuery(workspaceId: string) {
  return db
    .select({ n: count() })
    .from(platinaCreativeReviews)
    .where(and(eq(platinaCreativeReviews.workspaceId, workspaceId), eq(platinaCreativeReviews.status, "draft")));
}
