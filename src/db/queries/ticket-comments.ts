import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ticketComments, users } from "@/db/schema";
import { logTicketActivity } from "@/db/queries/ticket-activity";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { extractMentions } from "@/lib/tickets";

/** Near-clone of commentsForContentQuery — workspace AND ticket scoped. */
export function commentsForTicketQuery(workspaceId: string, ticketId: string) {
  return db
    .select({
      id: ticketComments.id,
      body: ticketComments.body,
      createdAt: ticketComments.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(ticketComments)
    .innerJoin(users, eq(users.id, ticketComments.authorId))
    .where(
      and(
        eq(ticketComments.workspaceId, workspaceId),
        eq(ticketComments.ticketId, ticketId),
      ),
    )
    .orderBy(asc(ticketComments.createdAt))
    .limit(200);
}

export async function listTicketComments(
  workspaceId: string,
  ticketId: string,
) {
  return commentsForTicketQuery(workspaceId, ticketId);
}

export async function addTicketComment(input: {
  workspaceId: string;
  ticketId: string;
  authorId: string;
  body: string;
}) {
  await db.insert(ticketComments).values(input);

  // Winning path: the insert above already succeeded, so everything below
  // is best-effort activity logging — a failure here must never surface as
  // a failed comment post (F1 idiom).
  try {
    await logTicketActivity({
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      actorId: input.authorId,
      kind: "commented",
    });
  } catch {
    // swallow — best-effort logging.
  }

  // @mentions: parse the comment body against the real workspace roster and
  // log one "mentioned" activity row per matched user. This activity-log
  // entry IS the mention record for T3 — no new notification/email channel.
  try {
    const members = await listWorkspaceMembers(input.workspaceId);
    const mentionedUserIds = extractMentions(input.body, members);
    for (const mentionedUserId of mentionedUserIds) {
      await logTicketActivity({
        workspaceId: input.workspaceId,
        ticketId: input.ticketId,
        actorId: input.authorId,
        kind: "mentioned",
        detail: { mentionedUserId },
      });
    }
  } catch {
    // swallow — best-effort; the comment itself already succeeded.
  }
}
