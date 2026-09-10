import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import type { ActivitySubjectType } from "@/lib/activity";

/** The bell shows a page, not a lifetime. */
const NOTIFICATION_CAP = 20;

export type NotificationKind =
  | "assigned"
  | "due_soon"
  | "mentioned"
  | "approval_needed"
  | "ready";

/**
 * Scoped by user AND workspace. User alone would leak one workspace's
 * activity into another's bell for anyone who belongs to both — which is
 * the normal case for an agency operator.
 */
export function unreadCountQuery(workspaceId: string, userId: string) {
  return db
    .select({ unread: count(notifications.id) })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
}

export function notificationsQuery(workspaceId: string, userId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(NOTIFICATION_CAP);
}

/**
 * Marking read is idempotent by construction: the readAt IS NULL predicate
 * means a second call matches nothing instead of overwriting the original
 * timestamp with a later one.
 */
export function markReadQuery(input: {
  workspaceId: string;
  userId: string;
  notificationId: string;
}) {
  return db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, input.workspaceId),
        eq(notifications.userId, input.userId),
        eq(notifications.id, input.notificationId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
}

export function markAllReadQuery(workspaceId: string, userId: string) {
  return db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
}

export type NotifyInput = {
  workspaceId: string;
  userId: string;
  kind: NotificationKind;
  subjectType: ActivitySubjectType;
  subjectId: string;
  body: string;
};

/**
 * Never throws, for the same reason recordActivity doesn't: a notification
 * is a consequence of the work, not the work. Pass `tx` when the caller
 * needs it atomic with its own writes.
 */
export async function notify(
  input: NotifyInput,
  tx?: Pick<typeof db, "insert">,
): Promise<void> {
  if (tx) {
    await tx.insert(notifications).values(input);
    return;
  }
  try {
    await db.insert(notifications).values(input);
  } catch (error) {
    console.error("[notify] failed to write", input.kind, error);
  }
}

export async function listNotifications(workspaceId: string, userId: string) {
  return notificationsQuery(workspaceId, userId);
}

export async function getUnreadCount(workspaceId: string, userId: string) {
  const [row] = await unreadCountQuery(workspaceId, userId);
  return Number(row?.unread ?? 0);
}
