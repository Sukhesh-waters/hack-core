import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ticketActivity } from "@/db/schema";

export type TicketActivityKind =
  | "created"
  | "status_changed"
  | "assigned"
  | "commented"
  | "edited"
  | "labeled"
  | "mentioned";

export type TicketActivityDetail = {
  from?: string;
  to?: string;
  assigneeId?: string | null;
  labels?: string[];
  mentionedUserId?: string;
};

/**
 * Append-only insert. Callers log ONLY on the winning path of a mutation
 * (after a guard-in-WHERE confirms rows affected, or after a successful
 * insert) and wrap the call in try/catch — a logging failure must never
 * mask the primary mutation's result (F1's report-send-log idiom).
 */
export async function logTicketActivity(input: {
  workspaceId: string;
  ticketId: string;
  actorId: string;
  kind: TicketActivityKind;
  detail?: TicketActivityDetail | null;
}) {
  await db.insert(ticketActivity).values({
    workspaceId: input.workspaceId,
    ticketId: input.ticketId,
    actorId: input.actorId,
    kind: input.kind,
    detail: input.detail ?? null,
  });
}

/** Builder exposed for SQL-shape assertions — workspace AND ticket scoped,
 *  newest first, capped at 100 rows (compact timeline, not a full audit
 *  export). */
export function activityForTicketQuery(workspaceId: string, ticketId: string) {
  return db
    .select()
    .from(ticketActivity)
    .where(
      and(
        eq(ticketActivity.workspaceId, workspaceId),
        eq(ticketActivity.ticketId, ticketId),
      ),
    )
    .orderBy(desc(ticketActivity.createdAt))
    .limit(100);
}

export async function listTicketActivity(
  workspaceId: string,
  ticketId: string,
) {
  return activityForTicketQuery(workspaceId, ticketId);
}
