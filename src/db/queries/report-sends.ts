import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { reportSends } from "@/db/schema";

/** Builder exported for .toSQL() tests. */
export function recentSendsQuery(
  workspaceId: string,
  clientId: string,
  limit = 5,
) {
  return db
    .select({
      id: reportSends.id,
      audience: reportSends.audience,
      recipients: reportSends.recipients,
      status: reportSends.status,
      createdAt: reportSends.createdAt,
    })
    .from(reportSends)
    .where(
      and(
        eq(reportSends.workspaceId, workspaceId),
        eq(reportSends.clientId, clientId),
      ),
    )
    .orderBy(desc(reportSends.createdAt))
    .limit(limit);
}

export async function listRecentSends(workspaceId: string, clientId: string) {
  return recentSendsQuery(workspaceId, clientId);
}

/** Logs one send attempt — success or failure — so "did the report go out"
 *  always has a real answer. Called for every attempt, never conditionally. */
export async function logReportSend(input: {
  workspaceId: string;
  clientId: string;
  sentByUserId: string;
  recipients: string[];
  audience: "team" | "client";
  subject: string;
  body: string;
  status: "sent" | "failed";
  error?: string;
}) {
  await db.insert(reportSends).values(input);
}
