import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { recordActivity } from "@/lib/activity";
import {
  campaigns,
  hubApprovals,
  hubMessages,
  hubReminders,
  hubTasks,
  ideas,
  memberships,
  sopRunSteps,
  users,
} from "@/db/schema";

// ---- list builders (exported for isolation tests) ----

export function hubMessagesQuery(workspaceId: string) {
  return db
    .select({
      id: hubMessages.id,
      kind: hubMessages.kind,
      body: hubMessages.body,
      approvalId: hubMessages.approvalId,
      createdAt: hubMessages.createdAt,
      authorId: hubMessages.authorId,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(hubMessages)
    .leftJoin(users, eq(users.id, hubMessages.authorId))
    .where(
      and(
        eq(hubMessages.workspaceId, workspaceId),
        isNull(hubMessages.archivedAt),
      ),
    )
    .orderBy(asc(hubMessages.createdAt))
    .limit(200);
}

export function hubApprovalsQuery(workspaceId: string) {
  return db
    .select({
      id: hubApprovals.id,
      title: hubApprovals.title,
      status: hubApprovals.status,
      createdAt: hubApprovals.createdAt,
      requestedByName: users.name,
      requestedByEmail: users.email,
      decidedById: hubApprovals.decidedById,
    })
    .from(hubApprovals)
    .leftJoin(users, eq(users.id, hubApprovals.requestedById))
    .where(
      and(
        eq(hubApprovals.workspaceId, workspaceId),
        isNull(hubApprovals.archivedAt),
      ),
    )
    .orderBy(desc(hubApprovals.createdAt))
    .limit(25);
}

export function hubTasksQuery(workspaceId: string) {
  return db
    .select({
      id: hubTasks.id,
      workspaceId: hubTasks.workspaceId,
      title: hubTasks.title,
      done: hubTasks.done,
      priority: hubTasks.priority,
      createdById: hubTasks.createdById,
      assigneeId: hubTasks.assigneeId,
      dueAt: hubTasks.dueAt,
      completedAt: hubTasks.completedAt,
      archivedAt: hubTasks.archivedAt,
      originRunStepId: hubTasks.originRunStepId,
      createdAt: hubTasks.createdAt,
      sopStepTitle: sopRunSteps.title,
      sopRunId: sopRunSteps.runId,
    })
    .from(hubTasks)
    .leftJoin(sopRunSteps, eq(sopRunSteps.id, hubTasks.originRunStepId))
    .where(
      and(
        eq(hubTasks.workspaceId, workspaceId),
        eq(hubTasks.done, false),
        isNull(hubTasks.archivedAt),
      ),
    )
    .orderBy(asc(hubTasks.createdAt))
    .limit(100);
}

export function listCompletedHubTasks(workspaceId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return db
    .select({
      id: hubTasks.id,
      workspaceId: hubTasks.workspaceId,
      title: hubTasks.title,
      done: hubTasks.done,
      priority: hubTasks.priority,
      createdById: hubTasks.createdById,
      assigneeId: hubTasks.assigneeId,
      dueAt: hubTasks.dueAt,
      completedAt: hubTasks.completedAt,
      archivedAt: hubTasks.archivedAt,
      originRunStepId: hubTasks.originRunStepId,
      createdAt: hubTasks.createdAt,
      sopStepTitle: sopRunSteps.title,
      sopRunId: sopRunSteps.runId,
    })
    .from(hubTasks)
    .leftJoin(sopRunSteps, eq(sopRunSteps.id, hubTasks.originRunStepId))
    .where(
      and(
        eq(hubTasks.workspaceId, workspaceId),
        eq(hubTasks.done, true),
        isNull(hubTasks.archivedAt),
        gte(hubTasks.completedAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(hubTasks.completedAt))
    .limit(50);
}

export function hubRemindersQuery(workspaceId: string) {
  return db
    .select({
      id: hubReminders.id,
      title: hubReminders.title,
      dueAt: hubReminders.dueAt,
      notifiedAt: hubReminders.notifiedAt,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(hubReminders)
    .leftJoin(users, eq(users.id, hubReminders.ownerId))
    .where(
      and(
        eq(hubReminders.workspaceId, workspaceId),
        isNull(hubReminders.archivedAt),
      ),
    )
    .orderBy(asc(hubReminders.dueAt))
    .limit(50);
}

export function listDueUnnotifiedReminders(
  now: Date = new Date(),
  windowMs: number = 60 * 60 * 1000,
) {
  const windowEnd = new Date(now.getTime() + windowMs);
  return db
    .select({
      id: hubReminders.id,
      workspaceId: hubReminders.workspaceId,
      title: hubReminders.title,
      dueAt: hubReminders.dueAt,
      ownerId: hubReminders.ownerId,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(hubReminders)
    .innerJoin(users, eq(users.id, hubReminders.ownerId))
    .where(
      and(
        lte(hubReminders.dueAt, windowEnd),
        isNull(hubReminders.notifiedAt),
        isNull(hubReminders.archivedAt),
      ),
    )
    .limit(50);
}

export async function markReminderNotified(
  workspaceId: string,
  reminderId: string,
) {
  await db
    .update(hubReminders)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(hubReminders.workspaceId, workspaceId),
        eq(hubReminders.id, reminderId),
      ),
    );
}

export function workspaceMembersQuery(workspaceId: string) {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId));
}

/** Hub Plan quick-view rows — live ideas, newest first. */
export function ideasQuickViewQuery(workspaceId: string) {
  return db
    .select({
      id: ideas.id,
      topic: ideas.topic,
      format: ideas.format,
      status: ideas.status,
    })
    .from(ideas)
    .where(eq(ideas.workspaceId, workspaceId))
    .orderBy(desc(ideas.createdAt))
    .limit(3);
}

export async function getHubState(workspaceId: string) {
  const [messages, approvals, tasks, completedTasks, reminders, members] = await Promise.all([
    hubMessagesQuery(workspaceId),
    hubApprovalsQuery(workspaceId),
    hubTasksQuery(workspaceId),
    listCompletedHubTasks(workspaceId),
    hubRemindersQuery(workspaceId),
    workspaceMembersQuery(workspaceId),
  ]);
  return { messages, approvals, tasks, completedTasks, reminders, members };
}

// ---- writes (every one workspace-scoped) ----

export async function addHubTextMessage(input: {
  workspaceId: string;
  authorId: string;
  body: string;
}) {
  const [row] = await db
    .insert(hubMessages)
    .values({ ...input, kind: "text" })
    .returning({ id: hubMessages.id });
  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_message",
    subjectId: row.id,
    actorId: input.authorId,
    verb: "created",
  });
}

export async function createHubApproval(input: {
  workspaceId: string;
  requestedById: string;
  title: string;
  campaignId?: string;
}): Promise<string> {
  const [row] = await db
    .insert(hubApprovals)
    .values(input)
    .returning({ id: hubApprovals.id });
  await db.insert(hubMessages).values({
    workspaceId: input.workspaceId,
    kind: "approval",
    authorId: input.requestedById,
    approvalId: row.id,
  });
  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_approval",
    subjectId: row.id,
    actorId: input.requestedById,
    verb: "created",
  });
  return row.id;
}

/** Decides the approval; if it's linked to a campaign (Ads Management —
 *  "routed through the same approval gate"), cascades a status flip on
 *  that campaign atomically. Guard-in-WHERE on both statements. */
export async function decideHubApproval(input: {
  workspaceId: string;
  approvalId: string;
  deciderId: string;
  status: "approved" | "rejected";
}) {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(hubApprovals)
      .set({
        status: input.status,
        decidedById: input.deciderId,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(hubApprovals.workspaceId, input.workspaceId),
          eq(hubApprovals.id, input.approvalId),
          eq(hubApprovals.status, "pending"),
        ),
      )
      .returning({ campaignId: hubApprovals.campaignId });

    if (updated?.campaignId) {
      await tx
        .update(campaigns)
        .set({
          status: input.status === "approved" ? "active" : "rejected",
        })
        .where(
          and(
            eq(campaigns.workspaceId, input.workspaceId),
            eq(campaigns.id, updated.campaignId),
            eq(campaigns.status, "pending_approval"),
          ),
        );
    }

    if (updated) {
      await recordActivity(
        {
          workspaceId: input.workspaceId,
          subjectType: "hub_approval",
          subjectId: input.approvalId,
          actorId: input.deciderId,
          verb: input.status,
        },
        tx,
      );
    }
  });
}

/**
 * Reopens a decided hub approval (approved/rejected -> pending), decider-only within 24h window.
 */
export async function reopenHubApproval(input: {
  workspaceId: string;
  approvalId: string;
  deciderId: string;
}) {
  const window24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(hubApprovals)
      .set({
        status: "pending",
        decidedById: null,
        decidedAt: null,
      })
      .where(
        and(
          eq(hubApprovals.workspaceId, input.workspaceId),
          eq(hubApprovals.id, input.approvalId),
          eq(hubApprovals.decidedById, input.deciderId),
          gte(hubApprovals.decidedAt, window24h),
        ),
      )
      .returning({ campaignId: hubApprovals.campaignId });

    if (updated?.campaignId) {
      await tx
        .update(campaigns)
        .set({ status: "pending_approval" })
        .where(
          and(
            eq(campaigns.workspaceId, input.workspaceId),
            eq(campaigns.id, updated.campaignId),
          ),
        );
    }

    if (updated) {
      await recordActivity(
        {
          workspaceId: input.workspaceId,
          subjectType: "hub_approval",
          subjectId: input.approvalId,
          actorId: input.deciderId,
          verb: "reopened",
        },
        tx,
      );
    }
  });
}

export async function addHubTask(input: {
  workspaceId: string;
  createdById: string;
  title: string;
}) {
  const [row] = await db
    .insert(hubTasks)
    .values(input)
    .returning({ id: hubTasks.id });
  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_task",
    subjectId: row.id,
    actorId: input.createdById,
    verb: "created",
  });
}

export async function toggleHubTask(input: {
  workspaceId: string;
  taskId: string;
  actorId?: string;
}) {
  const [row] = await db
    .select({ done: hubTasks.done })
    .from(hubTasks)
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    )
    .limit(1);

  if (!row) return;

  const nextDone = !row.done;
  await db
    .update(hubTasks)
    .set({
      done: nextDone,
      completedAt: nextDone ? new Date() : null,
    })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_task",
    subjectId: input.taskId,
    actorId: input.actorId ?? null,
    verb: nextDone ? "completed" : "reopened",
  });
}

export async function updateHubTaskTitle(input: {
  workspaceId: string;
  taskId: string;
  title: string;
  actorId?: string;
}) {
  await db
    .update(hubTasks)
    .set({ title: input.title })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_task",
    subjectId: input.taskId,
    actorId: input.actorId ?? null,
    verb: "updated",
    meta: { title: input.title },
  });
}

export async function archiveHubTask(input: {
  workspaceId: string;
  taskId: string;
  actorId?: string;
}) {
  await db
    .update(hubTasks)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_task",
    subjectId: input.taskId,
    actorId: input.actorId ?? null,
    verb: "archived",
  });
}

export async function reopenHubTask(input: {
  workspaceId: string;
  taskId: string;
  actorId?: string;
}) {
  await db
    .update(hubTasks)
    .set({ done: false, completedAt: null, archivedAt: null })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_task",
    subjectId: input.taskId,
    actorId: input.actorId ?? null,
    verb: "reopened",
  });
}

export async function setHubTaskPriority(input: {
  workspaceId: string;
  taskId: string;
  priority: "high" | "medium" | "low";
  actorId?: string;
}) {
  await db
    .update(hubTasks)
    .set({ priority: input.priority })
    .where(
      and(
        eq(hubTasks.workspaceId, input.workspaceId),
        eq(hubTasks.id, input.taskId),
      ),
    );

  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_task",
    subjectId: input.taskId,
    actorId: input.actorId ?? null,
    verb: "priority_changed",
    meta: { priority: input.priority },
  });
}

export async function addHubReminder(input: {
  workspaceId: string;
  ownerId: string;
  title: string;
  dueAt: Date;
}) {
  const [row] = await db
    .insert(hubReminders)
    .values(input)
    .returning({ id: hubReminders.id });
  void recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "hub_reminder",
    subjectId: row.id,
    actorId: input.ownerId,
    verb: "created",
  });
}
