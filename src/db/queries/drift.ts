import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { content } from "@/db/schema";

/** Last N content rows for a client, newest first — the compliance
 *  signal Brand Drift is derived from. See src/lib/drift.ts. */
export function recentComplianceQuery(
  workspaceId: string,
  clientId: string,
  limit: number,
) {
  return db
    .select({
      id: content.id,
      complianceStatus: content.complianceStatus,
      createdAt: content.createdAt,
    })
    .from(content)
    .where(
      and(eq(content.workspaceId, workspaceId), eq(content.clientId, clientId)),
    )
    .orderBy(desc(content.createdAt))
    .limit(limit);
}

export async function driftSignal(
  workspaceId: string,
  clientId: string,
  limit: number,
): Promise<{ total: number; flagged: number }> {
  const rows = await recentComplianceQuery(workspaceId, clientId, limit);
  return {
    total: rows.length,
    flagged: rows.filter((r) => r.complianceStatus === "flagged").length,
  };
}
