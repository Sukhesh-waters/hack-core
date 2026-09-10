import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { connectedAccounts, patternPosts } from "@/db/schema";

export async function listConnectedAccounts(workspaceId: string) {
  return db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.workspaceId, workspaceId))
    .orderBy(desc(connectedAccounts.createdAt));
}

export async function getConnectedAccount(
  workspaceId: string,
  accountId: string,
) {
  const rows = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.id, accountId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function updateHeartbeat(
  workspaceId: string,
  accountId: string,
  patch: {
    status: "connected" | "error" | "disconnected";
    lastPullAt?: Date;
    lastError?: string | null;
  },
) {
  await db
    .update(connectedAccounts)
    .set(patch)
    .where(
      and(
        eq(connectedAccounts.workspaceId, workspaceId),
        eq(connectedAccounts.id, accountId),
      ),
    );
}

/** Public pattern layer reads its OWN namespace (two-layer rule). */
export function patternQuery(workspaceId: string) {
  return db
    .select()
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId));
}

export async function listPatternPosts(
  workspaceId: string,
  opts: { limit?: number } = {},
) {
  return db
    .select()
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId))
    .orderBy(desc(patternPosts.postedAt))
    .limit(opts.limit ?? 20);
}

export async function countPatternPosts(workspaceId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patternPosts)
    .where(eq(patternPosts.workspaceId, workspaceId));
  return row.count;
}
