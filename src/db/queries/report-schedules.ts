import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { reportSchedules, users } from "@/db/schema";

export function listReportSchedulesQuery(workspaceId: string) {
  return db
    .select({
      id: reportSchedules.id,
      workspaceId: reportSchedules.workspaceId,
      clientId: reportSchedules.clientId,
      recipientEmails: reportSchedules.recipientEmails,
      cadence: reportSchedules.cadence,
      lastSentAt: reportSchedules.lastSentAt,
      createdById: reportSchedules.createdById,
      createdByName: users.name,
      createdAt: reportSchedules.createdAt,
    })
    .from(reportSchedules)
    .leftJoin(users, eq(users.id, reportSchedules.createdById))
    .where(eq(reportSchedules.workspaceId, workspaceId))
    .orderBy(desc(reportSchedules.createdAt));
}

export async function listReportSchedules(workspaceId: string) {
  return listReportSchedulesQuery(workspaceId);
}

export async function createReportSchedule(input: {
  workspaceId: string;
  clientId: string;
  recipientEmails: string[];
  cadence?: string;
  createdById: string;
}): Promise<string> {
  const [row] = await db
    .insert(reportSchedules)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      recipientEmails: input.recipientEmails,
      cadence: input.cadence ?? "weekly",
      createdById: input.createdById,
    })
    .returning({ id: reportSchedules.id });
  return row.id;
}

export async function deleteReportSchedule(
  workspaceId: string,
  scheduleId: string,
) {
  return db
    .delete(reportSchedules)
    .where(
      and(
        eq(reportSchedules.workspaceId, workspaceId),
        eq(reportSchedules.id, scheduleId),
      ),
    )
    .returning({ id: reportSchedules.id });
}

export function listDueReportSchedulesQuery(cutoff: Date) {
  return db
    .select()
    .from(reportSchedules)
    .where(
      or(
        isNull(reportSchedules.lastSentAt),
        lte(reportSchedules.lastSentAt, cutoff),
      ),
    );
}

export async function listDueReportSchedules(cutoff: Date) {
  return listDueReportSchedulesQuery(cutoff);
}
