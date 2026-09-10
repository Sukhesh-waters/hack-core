import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";

export type AiUsageRow = typeof aiUsage.$inferInsert;

export async function insertAiUsage(row: AiUsageRow) {
  await db.insert(aiUsage).values(row);
}

export function workspaceSpendQuery(workspaceId: string, since: Date) {
  return db
    .select({
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
      calls: sql<number>`count(*)::int`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        gte(aiUsage.createdAt, since),
      ),
    );
}

export async function getWorkspaceSpendSince(workspaceId: string, since: Date) {
  const [row] = await workspaceSpendQuery(workspaceId, since);
  return row ?? { costUsd: 0, calls: 0 };
}

export function spendByProviderQuery(workspaceId: string, since: Date) {
  return db
    .select({
      provider: aiUsage.provider,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
      calls: sql<number>`count(*)::int`,
      tokensIn: sql<number>`coalesce(sum(${aiUsage.tokensIn}), 0)::int`,
      tokensOut: sql<number>`coalesce(sum(${aiUsage.tokensOut}), 0)::int`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        gte(aiUsage.createdAt, since),
      ),
    )
    .groupBy(aiUsage.provider);
}

export async function listSpendByProvider(workspaceId: string, since: Date) {
  return spendByProviderQuery(workspaceId, since);
}

export function recentUsageQuery(workspaceId: string, limit = 15) {
  return db
    .select()
    .from(aiUsage)
    .where(eq(aiUsage.workspaceId, workspaceId))
    .orderBy(desc(aiUsage.createdAt))
    .limit(limit);
}

export async function listRecentUsage(workspaceId: string, limit = 15) {
  return recentUsageQuery(workspaceId, limit);
}

export function capAlertQuery(workspaceId: string, since: Date) {
  return db
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        eq(aiUsage.purpose, "cap-alert"),
        gte(aiUsage.createdAt, since),
      ),
    )
    .limit(1);
}

/** Has the once-a-day budget alert already been recorded? */
export async function hasCapAlertSince(workspaceId: string, since: Date) {
  const rows = await capAlertQuery(workspaceId, since);
  return rows.length > 0;
}
