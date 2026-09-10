"use server";

import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  getUnreadCount,
  listNotifications,
  markAllReadQuery,
  markReadQuery,
} from "@/db/queries/notifications";

export type NotificationItem = {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  body: string;
  read: boolean;
  createdAtIso: string;
};

export type NotificationFeed = {
  unread: number;
  items: NotificationItem[];
};

/**
 * Polled by the bell. Every read is scoped by the caller's own session user
 * — the client never says whose notifications it wants, so it cannot ask
 * for someone else's.
 */
export async function fetchNotificationsAction(
  workspaceId: string,
): Promise<NotificationFeed> {
  const user = await requireUser();
  await requireMembership(workspaceId, user.id);

  const [unread, rows] = await Promise.all([
    getUnreadCount(workspaceId, user.id),
    listNotifications(workspaceId, user.id),
  ]);

  return {
    unread,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      body: r.body,
      read: r.readAt !== null,
      createdAtIso: r.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationReadAction(
  workspaceId: string,
  notificationId: string,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await requireMembership(workspaceId, user.id);
  // A second call matches zero rows rather than overwriting the original
  // timestamp — idempotent by construction, not by check-then-write.
  await markReadQuery({ workspaceId, userId: user.id, notificationId });
  return { ok: true };
}

export async function markAllNotificationsReadAction(
  workspaceId: string,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await requireMembership(workspaceId, user.id);
  await markAllReadQuery(workspaceId, user.id);
  return { ok: true };
}
