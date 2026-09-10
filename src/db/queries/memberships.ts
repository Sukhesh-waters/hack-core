import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships, orgs, users, workspaces } from "@/db/schema";
import {
  PermissionError,
  roleCan,
  type Capability,
} from "@/lib/permissions";

/**
 * Workspace-scoped reads take workspaceId as the required first argument —
 * the constitution's isolation rule, enforced at the query surface.
 */
export async function getMembership(workspaceId: string, userId: string) {
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function requireMembership(workspaceId: string, userId: string) {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) {
    throw new Error("Not a member of this workspace");
  }
  return membership;
}

/**
 * P1 — membership AND capability, in one call.
 *
 * Deliberately wraps requireMembership rather than sitting beside it: a
 * capability check that forgot the membership check would let a member of
 * workspace A act on workspace B by holding the right role somewhere else.
 * Making the membership lookup the only path to the role makes that
 * mistake unrepresentable.
 *
 * Throws PermissionError, which actionErrorMessage surfaces verbatim — the
 * messages are written for the person who hit them.
 */
export async function requireCapability(
  workspaceId: string,
  userId: string,
  capability: Capability,
) {
  const membership = await requireMembership(workspaceId, userId);
  if (!roleCan(membership.role, capability)) {
    throw new PermissionError(capability);
  }
  return membership;
}

/** Non-throwing variant, for deciding whether to RENDER a control. The
 *  server action still calls requireCapability — hiding a button is a
 *  courtesy, never the enforcement. */
export async function userCan(
  workspaceId: string,
  userId: string,
  capability: Capability,
): Promise<boolean> {
  const membership = await getMembership(workspaceId, userId);
  return membership ? roleCan(membership.role, capability) : false;
}

// listMemberEmails was removed in S10. It resolved every member of a
// workspace regardless of preference, which is what made both senders blast
// the whole team about one person's post. Use emailsForUsers for a targeted
// send, or listImmediateMemberEmails for a genuinely team-wide one — both
// honour the digest preference.

/**
 * S10 — emails for specific members, honouring their digest preference.
 *
 * "off" is filtered here rather than at the send site so no caller can
 * forget it. The in-app notification is unaffected: opting out of inbox
 * noise is not opting out of knowing your work exists.
 *
 * "daily" is also excluded from immediate sends — the batched sender is a
 * separate slice, trigger-gated on someone actually choosing it. Until
 * then, choosing "daily" means "not right now", which is honest.
 */
export function emailsForUsersQuery(workspaceId: string, userIds: string[]) {
  return db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        inArray(memberships.userId, userIds),
        eq(memberships.emailDigest, "immediate"),
        isNotNull(users.email),
      ),
    );
}

export async function emailsForUsers(
  workspaceId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await emailsForUsersQuery(workspaceId, userIds);
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}

/** Everyone in the workspace who still wants immediate email. */
export function immediateMemberEmailsQuery(workspaceId: string) {
  return db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.emailDigest, "immediate"),
        isNotNull(users.email),
      ),
    );
}

export async function listImmediateMemberEmails(
  workspaceId: string,
): Promise<string[]> {
  const rows = await immediateMemberEmailsQuery(workspaceId);
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}

/** Workspace-scoped member roster — powers the ticket assignee picker and
 *  validates an assigneeId actually belongs to this workspace before a
 *  ticket is assigned to it (isolation: no cross-workspace assignment). */
export function workspaceMembersQuery(workspaceId: string) {
  return db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.workspaceId, workspaceId));
}

export async function listWorkspaceMembers(workspaceId: string) {
  return workspaceMembersQuery(workspaceId);
}

/** All workspaces the user belongs to, with org context — powers /hub. */
export async function listWorkspacesForUser(userId: string) {
  return db
    .select({
      membership: memberships,
      workspace: workspaces,
      org: orgs,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .innerJoin(orgs, eq(workspaces.orgId, orgs.id))
    .where(eq(memberships.userId, userId));
}
