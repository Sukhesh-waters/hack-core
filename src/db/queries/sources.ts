import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { connectedAccounts, importJobs, patternPosts } from "@/db/schema";

/**
 * "Ingested sources" registry for the Brand DNA Vault — where KB data came
 * from, labelled by layer: CSV + connected accounts feed the first-party
 * baseline; pattern posts are the public inspiration layer. Read-only.
 */

export function importJobsForClientQuery(workspaceId: string, clientId: string) {
  return db
    .select({
      id: importJobs.id,
      filename: importJobs.filename,
      rowCount: importJobs.rowCount,
      status: importJobs.status,
      createdAt: importJobs.createdAt,
    })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.workspaceId, workspaceId),
        eq(importJobs.clientId, clientId),
      ),
    )
    .orderBy(desc(importJobs.createdAt))
    .limit(10);
}

export function accountsForClientQuery(workspaceId: string, clientId: string) {
  return db
    .select({
      id: connectedAccounts.id,
      provider: connectedAccounts.provider,
      status: connectedAccounts.status,
      lastPullAt: connectedAccounts.lastPullAt,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.clientId, clientId),
      ),
    );
}

export function patternPostCountQuery(workspaceId: string) {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId));
}

export async function getSourceRegistry(workspaceId: string, clientId: string) {
  const [csvJobs, accounts, patternCount] = await Promise.all([
    importJobsForClientQuery(workspaceId, clientId),
    accountsForClientQuery(workspaceId, clientId),
    patternPostCountQuery(workspaceId),
  ]);
  return {
    csvJobs,
    accounts,
    patternPostCount: patternCount[0]?.count ?? 0,
  };
}
