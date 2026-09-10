import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { content, patternAds, clients } from "@/db/schema";

/**
 * Query: top ad-eligible organic content for a client.
 * Surfaces recent drafts/published content ordered by recency.
 * The AI agent does the suitability scoring — this query just feeds it candidates.
 */
export async function topAdEligibleContent(
  workspaceId: string,
  clientId: string,
  limit = 10,
) {
  return db
    .select({
      id: content.id,
      title: content.title,
      body: content.body,
      type: content.type,
      pillar: content.pillar,
      status: content.status,
      createdAt: content.createdAt,
    })
    .from(content)
    .where(
      and(
        eq(content.workspaceId, workspaceId),
        eq(content.clientId, clientId),
      ),
    )
    .orderBy(desc(content.createdAt))
    .limit(limit);
}

/**
 * Query: recent competitor ad patterns for a workspace.
 * Surfaces the latest scraped ads from pattern_ads for market context.
 * Score-free, weight neutral — these are Tier 2 public pattern rows.
 */
export async function recentCompetitorAds(
  workspaceId: string,
  limit = 20,
) {
  return db
    .select({
      id: patternAds.id,
      pageHandle: patternAds.pageHandle,
      adBody: patternAds.adBody,
      adFormat: patternAds.adFormat,
      targetAudience: patternAds.targetAudience,
      postedAt: patternAds.postedAt,
    })
    .from(patternAds)
    .where(eq(patternAds.workspaceId, workspaceId))
    .orderBy(desc(patternAds.postedAt))
    .limit(limit);
}

/**
 * Query: client names for a workspace (used for brand context in AI agents).
 */
export async function clientBrandContext(
  workspaceId: string,
  clientId: string,
) {
  const rows = await db
    .select({
      name: clients.name,
      handle: clients.handle,
    })
    .from(clients)
    .where(
      and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)),
    )
    .limit(1);
  return rows[0] ?? null;
}
