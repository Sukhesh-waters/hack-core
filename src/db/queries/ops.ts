import { and, count, eq, gte, inArray, isNotNull, isNull, sql, sum, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  platinaAuditRuns,
  platinaBrainChunks,
  platinaBrandChunks,
  platinaBrands,
  platinaCreativeReviews,
  platinaCreatives,
  platinaEvents,
  platinaFindings,
  platinaFirstPartyChunks,
  platinaInterestSignals,
  platinaLearningEvents,
  platinaOutcomes,
  platinaPlans,
  platinaSignalDocuments,
  platinaSolutionTasks,
  platinaWorkspaceProfiles,
} from "@/db/platina-schema";
import { aiUsage, clients, knowledgeSources, workspaces } from "@/db/schema";

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

type Scoped = PgTable & { workspaceId: PgColumn };

/** One scalar count, scoped to the workspace (and an optional extra condition). */
function countIn(table: Scoped, workspaceId: string, extra?: SQL) {
  return sql<number>`(select count(*)::int from ${table} where ${table.workspaceId} = ${workspaceId}${extra ? sql` and ${extra}` : sql``})`;
}

/** The newest timestamp in one column, scoped to the workspace. */
function newestIn(table: Scoped, column: PgColumn, workspaceId: string, extra?: SQL) {
  return sql<string | null>`(select max(${column})::text from ${table} where ${table.workspaceId} = ${workspaceId}${extra ? sql` and ${extra}` : sql``})`;
}

/**
 * What each Platina page would show for one workspace (C8.0 readiness): row
 * counts and the newest row, in one statement. Every subquery filters
 * workspace_id; the outer row is the workspace itself.
 */
export function pageFactsQuery(workspaceId: string) {
  const ad = eq(platinaSignalDocuments.sourceKind, "ad_library");
  const upcoming = sql`${platinaEvents.startsOn} >= current_date`;
  const undated = isNull(platinaEvents.startsOn);
  const activeBrain = eq(platinaBrainChunks.status, "active");
  return db
    .select({
      findings: countIn(platinaFindings, workspaceId),
      findingsNewest: newestIn(platinaFindings, platinaFindings.createdAt, workspaceId),
      runs: countIn(platinaAuditRuns, workspaceId),
      runsNewest: newestIn(platinaAuditRuns, platinaAuditRuns.queuedAt, workspaceId),
      signals: countIn(platinaSignalDocuments, workspaceId),
      signalsNewest: newestIn(platinaSignalDocuments, platinaSignalDocuments.fetchedAt, workspaceId),
      adDocs: countIn(platinaSignalDocuments, workspaceId, ad),
      adDocsNewest: newestIn(platinaSignalDocuments, platinaSignalDocuments.fetchedAt, workspaceId, ad),
      brain: countIn(platinaBrainChunks, workspaceId, activeBrain),
      brainNewest: newestIn(platinaBrainChunks, platinaBrainChunks.createdAt, workspaceId, activeBrain),
      brands: countIn(platinaBrands, workspaceId),
      profiles: countIn(platinaWorkspaceProfiles, workspaceId),
      interest: countIn(platinaInterestSignals, workspaceId),
      interestNewest: newestIn(platinaInterestSignals, platinaInterestSignals.collectedAt, workspaceId),
      eventsUpcoming: countIn(platinaEvents, workspaceId, upcoming),
      eventsUndated: countIn(platinaEvents, workspaceId, undated),
      eventsNewest: newestIn(platinaEvents, platinaEvents.lastSeenAt, workspaceId),
      plans: countIn(platinaPlans, workspaceId),
      plansNewest: newestIn(platinaPlans, platinaPlans.createdAt, workspaceId),
      creatives: countIn(platinaCreatives, workspaceId),
      creativesNewest: newestIn(platinaCreatives, platinaCreatives.createdAt, workspaceId),
      outcomes: countIn(platinaOutcomes, workspaceId),
      solutionTasks: countIn(platinaSolutionTasks, workspaceId),
      brandChunks: countIn(platinaBrandChunks, workspaceId),
      ownChunks: countIn(platinaFirstPartyChunks, workspaceId),
      ownChunksNewest: newestIn(platinaFirstPartyChunks, platinaFirstPartyChunks.createdAt, workspaceId),
      learningEvents: countIn(platinaLearningEvents, workspaceId),
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
}

export type PageFacts = Awaited<ReturnType<typeof pageFactsQuery>>[number];

/** Sources with a run waiting or running: a force run does not queue a second one. */
export function openRunSpecIdsQuery(workspaceId: string) {
  return db
    .selectDistinct({ specId: platinaAuditRuns.specId })
    .from(platinaAuditRuns)
    .where(
      and(
        eq(platinaAuditRuns.workspaceId, workspaceId),
        inArray(platinaAuditRuns.status, ["queued", "running", "validating"]),
        isNotNull(platinaAuditRuns.specId),
      ),
    );
}
