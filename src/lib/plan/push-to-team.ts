import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  content,
  hubMessages,
  notifications,
  tickets,
} from "@/db/schema";
import { getMembership } from "@/db/queries/memberships";
import type { ProductionStage } from "@/lib/production";

export type PushToTeamResult =
  | { ok: true; ticketId: string }
  | { ok: false; error: string };

/** A ticket in any of these is still live work. */
const OPEN_TICKET_STATUSES = ["open", "in_progress", "blocked"] as const;

/**
 * Turns an approved draft into assigned work everywhere it needs to exist,
 * in one transaction.
 *
 * The atomicity is the point. Five writes land together or none do: a
 * half-push that assigned the content but never created the ticket would
 * leave the work invisible on every board, which is exactly the
 * three-blind-systems problem this phase exists to stop making worse.
 */
export async function pushToTeam(input: {
  workspaceId: string;
  contentId: string;
  assigneeId: string;
  dueAt: Date;
  note?: string;
  actorId: string;
}): Promise<PushToTeamResult> {
  const { workspaceId, contentId, assigneeId, dueAt, note, actorId } = input;

  // Guards run before the transaction opens. They are reads, and holding a
  // write transaction open across them buys nothing.
  if (dueAt.getTime() <= Date.now()) {
    return { ok: false, error: "The due date has to be in the future." };
  }

  const member = await getMembership(workspaceId, assigneeId);
  if (!member) {
    return { ok: false, error: "That person isn't in this workspace." };
  }

  const [row] = await db
    .select({
      id: content.id,
      title: content.title,
      body: content.body,
      clientId: content.clientId,
      productionStage: content.productionStage,
    })
    .from(content)
    .where(and(eq(content.workspaceId, workspaceId), eq(content.id, contentId)))
    .limit(1);
  if (!row) return { ok: false, error: "That draft is no longer available." };
  if (!row.body) {
    return {
      ok: false,
      error: "This draft has no content yet — write it before pushing it.",
    };
  }

  const [openTicket] = await db
    .select({ id: tickets.id, title: tickets.title })
    .from(tickets)
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        eq(tickets.linkedType, "content"),
        eq(tickets.linkedId, contentId),
        inArray(tickets.status, [...OPEN_TICKET_STATUSES]),
      ),
    )
    .limit(1);
  if (openTicket) {
    return {
      ok: false,
      error: `Already pushed — "${openTicket.title}" is still open.`,
    };
  }

  // Pushing to a team member is the "work has started" event: a brand-new
  // card (null stage) or one still sitting in "brief" moves to
  // "in_progress" — a card already further along (internal_review,
  // revision, done) must not be yanked backward.
  const nextStage: ProductionStage | null =
    row.productionStage === null || row.productionStage === "brief"
      ? "in_progress"
      : null;

  try {
    const ticketId = await db.transaction(async (tx) => {
      // 1. Assign the content and advance its stage.
      await tx
        .update(content)
        .set({
          assigneeId,
          dueAt,
          ...(nextStage ? { productionStage: nextStage } : {}),
        })
        .where(
          and(
            eq(content.workspaceId, workspaceId),
            eq(content.id, contentId),
          ),
        );

      // 2. The ticket the assignee will actually work from.
      const [ticket] = await tx
        .insert(tickets)
        .values({
          workspaceId,
          title: row.title,
          description: note ?? null,
          assigneeId,
          dueAt,
          createdById: actorId,
          linkedType: "content",
          linkedId: contentId,
          clientId: row.clientId,
        })
        .returning({ id: tickets.id });

      // 3. A visible line in the team feed — the push is a team event, not
      // a private one.
      await tx.insert(hubMessages).values({
        workspaceId,
        kind: "system",
        body: `Pushed "${row.title}" to ${member.userId === actorId ? "themselves" : "the team"}, due ${dueAt.toLocaleDateString()}`,
      });

      // 4. History. Written through tx, not recordActivity's swallowing
      // path: here the record is part of the unit, so a failure SHOULD
      // roll the whole push back rather than leave a silent gap.
      await tx.insert(activity).values({
        workspaceId,
        subjectType: "content",
        subjectId: contentId,
        actorId,
        verb: "pushed_to_team",
        meta: { assigneeId, ticketId: ticket.id, dueAt: dueAt.toISOString() },
      });

      // 5. Tell the one person who now owns it.
      if (assigneeId !== actorId) {
        await tx.insert(notifications).values({
          workspaceId,
          userId: assigneeId,
          kind: "assigned",
          subjectType: "content",
          subjectId: contentId,
          body: `You were assigned "${row.title}"`,
        });
      }

      return ticket.id;
    });

    return { ok: true, ticketId };
  } catch {
    return {
      ok: false,
      error: "Couldn't push this to the team. Nothing was changed.",
    };
  }
}
