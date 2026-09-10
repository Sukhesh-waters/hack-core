import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, posts, schedule } from "@/db/schema";

/**
 * Workspace-level totals across all clients — first-party only (two-layer
 * rule). This is the analytics page's overall min-N gate input: the page
 * shows nothing chart-shaped unless the whole workspace clears the same
 * MIN_BASELINE_N bar the per-client Reports screen already enforces.
 */
export function workspaceTotalsQuery(workspaceId: string) {
  return db
    .select({
      posts: sql<number>`count(${posts.id})::int`,
      scored: sql<number>`count(*) filter (where ${posts.scoreStatus} = 'scored')::int`,
      avgEngagement: sql<number | null>`avg(${posts.engagementRate})::float`,
    })
    .from(posts)
    .where(
      and(eq(posts.workspaceId, workspaceId), eq(posts.source, "first_party")),
    );
}

export async function getWorkspaceTotals(workspaceId: string) {
  const rows = await workspaceTotalsQuery(workspaceId);
  return rows[0] ?? { posts: 0, scored: 0, avgEngagement: null };
}

/**
 * Weekly engagement trend, workspace-wide — first-party only (two-layer
 * rule). Buckets by calendar week (date_trunc) so the analytics page can
 * render a sparkline without exposing individual posts. Sample size per
 * bucket is returned alongside the average so the page can still apply the
 * min-N gate at the series level (see src/lib/analytics.ts).
 */
export function engagementTrendQuery(workspaceId: string, since: Date) {
  return db
    .select({
      bucket: sql<string>`date_trunc('week', ${posts.postedAt})`,
      posts: sql<number>`count(${posts.id})::int`,
      avgEngagement: sql<number | null>`avg(${posts.engagementRate})::float`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.source, "first_party"),
        gte(posts.postedAt, since),
      ),
    )
    .groupBy(sql`date_trunc('week', ${posts.postedAt})`)
    .orderBy(sql`date_trunc('week', ${posts.postedAt})`);
}

export async function listEngagementTrend(workspaceId: string, since: Date) {
  return engagementTrendQuery(workspaceId, since);
}

/**
 * Client report rollup: first-party rows only (two-layer rule) — pattern
 * posts never appear in performance analytics.
 */
export function clientPerformanceQuery(workspaceId: string) {
  return db
    .select({
      clientId: clients.id,
      name: clients.name,
      handle: clients.handle,
      contactEmail: clients.contactEmail,
      posts: sql<number>`count(${posts.id})::int`,
      scored: sql<number>`count(*) filter (where ${posts.scoreStatus} = 'scored')::int`,
      avgEngagement: sql<number | null>`avg(${posts.engagementRate})::float`,
      lastPostedAt: sql<string | null>`max(${posts.postedAt})`,
    })
    .from(clients)
    .leftJoin(
      posts,
      and(
        eq(posts.clientId, clients.id),
        eq(posts.workspaceId, workspaceId),
        eq(posts.source, "first_party"),
      ),
    )
    .where(eq(clients.workspaceId, workspaceId))
    .groupBy(clients.id, clients.name, clients.handle, clients.contactEmail);
}

export async function listClientPerformance(workspaceId: string) {
  return clientPerformanceQuery(workspaceId);
}

/** Performance by format — first-party only (two-layer rule), for the
 *  Reports screen's per-format bars. */
export function formatPerformanceQuery(workspaceId: string, clientId: string) {
  return db
    .select({
      format: posts.format,
      count: sql<number>`count(${posts.id})::int`,
      avgEngagement: sql<number | null>`avg(${posts.engagementRate})::float`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.clientId, clientId),
        eq(posts.source, "first_party"),
      ),
    )
    .groupBy(posts.format);
}

export async function listFormatPerformance(
  workspaceId: string,
  clientId: string,
) {
  return formatPerformanceQuery(workspaceId, clientId);
}

/** Count of schedule rows already slotted within [start, end) — grounded in
 *  real scheduled content, not a speculative forecast. */
export function nextMonthScheduledQuery(
  workspaceId: string,
  clientId: string,
  start: Date,
  end: Date,
) {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(schedule)
    .where(
      and(
        eq(schedule.workspaceId, workspaceId),
        eq(schedule.clientId, clientId),
        gte(schedule.scheduledFor, start),
        lt(schedule.scheduledFor, end),
      ),
    );
}

export async function countNextMonthScheduled(
  workspaceId: string,
  clientId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const rows = await nextMonthScheduledQuery(workspaceId, clientId, start, end);
  return rows[0]?.count ?? 0;
}
