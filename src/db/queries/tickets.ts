import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { recordActivity } from "@/lib/activity";
import { tickets, users } from "@/db/schema";
import { isValidTransition, type TicketStatus } from "@/lib/tickets";
import { logTicketActivity } from "@/db/queries/ticket-activity";

export type TicketPriority = "high" | "medium" | "low";
export type TicketLinkType = "content" | "idea" | "campaign" | "client";

/** Priority-then-recency ordering: high first, then medium, then low; newest
 *  within each band first. Static CASE expression — no template-built SQL. */
const priorityRank = sql`case ${tickets.priority}
  when 'high' then 0
  when 'medium' then 1
  when 'low' then 2
  else 3 end`;

export type TicketsQueryOpts = {
  status?: TicketStatus;
  assigneeId?: string;
  label?: string;
  /** T5: filter to sub-tasks of one parent ticket — reuses this query's
   *  existing opts pattern rather than a separate childTicketsQuery. */
  parentTicketId?: string;
  /** F9.5: filter to tickets belonging to one client — same opts pattern.
   *  Workspace-scoped as always; combined with clientId this is the
   *  isolation-critical filter for the client detail page. */
  clientId?: string;
};

export function ticketsQuery(
  workspaceId: string,
  opts: TicketsQueryOpts = {},
) {
  return db
    .select({
      id: tickets.id,
      workspaceId: tickets.workspaceId,
      title: tickets.title,
      description: tickets.description,
      status: tickets.status,
      priority: tickets.priority,
      assigneeId: tickets.assigneeId,
      assigneeName: users.name,
      assigneeEmail: users.email,
      dueAt: tickets.dueAt,
      createdById: tickets.createdById,
      linkedType: tickets.linkedType,
      linkedId: tickets.linkedId,
      labels: tickets.labels,
      parentTicketId: tickets.parentTicketId,
      clientId: tickets.clientId,
      workflowStateId: tickets.workflowStateId,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assigneeId))
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        opts.status ? eq(tickets.status, opts.status) : undefined,
        opts.assigneeId ? eq(tickets.assigneeId, opts.assigneeId) : undefined,
        opts.label ? sql`${opts.label} = any(${tickets.labels})` : undefined,
        opts.parentTicketId
          ? eq(tickets.parentTicketId, opts.parentTicketId)
          : undefined,
        opts.clientId ? eq(tickets.clientId, opts.clientId) : undefined,
      ),
    )
    .orderBy(priorityRank, desc(tickets.createdAt));
}

export async function listTickets(
  workspaceId: string,
  opts: TicketsQueryOpts = {},
) {
  return ticketsQuery(workspaceId, opts);
}

export async function getTicket(workspaceId: string, ticketId: string) {
  const rows = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createTicket(input: {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: TicketPriority;
  assigneeId?: string | null;
  dueAt?: Date | null;
  createdById: string;
  linkedType?: TicketLinkType | null;
  linkedId?: string | null;
  parentTicketId?: string | null;
  clientId?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(tickets)
    .values({
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ?? null,
      createdById: input.createdById,
      linkedType: input.linkedType ?? null,
      linkedId: input.linkedId ?? null,
      parentTicketId: input.parentTicketId ?? null,
      clientId: input.clientId ?? null,
    })
    .returning({ id: tickets.id });

  // Log on the winning path only — insert already succeeded above, so a
  // logging failure here must not mask the ticket's creation (F1 idiom).
  try {
    await logTicketActivity({
      workspaceId: input.workspaceId,
      ticketId: row.id,
      actorId: input.createdById,
      kind: "created",
    });
  } catch {
    // swallow — activity logging is best-effort, never fails the mutation.
  }

  return row.id;
}

/** Guard-in-WHERE builder (exposed for SQL-shape assertions). The
 * status=from predicate makes a raced/stale move a safe no-op — the wrapper
 * checks the returned row count to detect that, mirroring advanceStageQuery. */
export function advanceTicketStatusQuery(input: {
  workspaceId: string;
  ticketId: string;
  from: TicketStatus;
  to: TicketStatus;
}) {
  return db
    .update(tickets)
    .set({ status: input.to, updatedAt: new Date() })
    .where(
      and(
        eq(tickets.workspaceId, input.workspaceId),
        eq(tickets.id, input.ticketId),
        eq(tickets.status, input.from),
      ),
    )
    .returning({ id: tickets.id });
}

export async function advanceTicketStatus(input: {
  workspaceId: string;
  ticketId: string;
  from: TicketStatus;
  to: TicketStatus;
  actorId: string;
}) {
  if (!isValidTransition(input.from, input.to)) {
    throw new Error("Invalid ticket transition.");
  }
  const moved = await advanceTicketStatusQuery(input);
  if (moved.length === 0) {
    throw new Error("This ticket was already updated. Refresh.");
  }

  // Winning path only — the guard-in-WHERE above already confirmed a row
  // was actually moved, so a lost race never produces a phantom activity
  // row. Logging failure is swallowed, never masks the transition result.
  try {
    await logTicketActivity({
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      actorId: input.actorId,
      kind: "status_changed",
      detail: { from: input.from, to: input.to },
    });
  } catch {
    // swallow — best-effort logging.
  }

  // Dual-write to the universal log (S6). ticketActivity stays as-is: it is
  // live audit data, and migrating it inside a feature slice is not worth
  // the risk. Retiring it is trigger-gated on S6 running clean for a month.
  await recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "ticket",
    subjectId: input.ticketId,
    actorId: input.actorId,
    verb: "ticket_status_changed",
    meta: { from: input.from, to: input.to },
  });

  return moved[0];
}

/** Guard-in-WHERE builder for assignment (exposed for SQL-shape assertions).
 *  Workspace+id scoped like every other mutation here; no status guard since
 *  assignment is orthogonal to the status graph. */
export function assignTicketQuery(
  workspaceId: string,
  ticketId: string,
  assigneeId: string | null,
) {
  return db
    .update(tickets)
    .set({ assigneeId, updatedAt: new Date() })
    .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)))
    .returning({ id: tickets.id });
}

export async function assignTicket(
  workspaceId: string,
  ticketId: string,
  assigneeId: string | null,
  actorId: string,
) {
  const rows = await assignTicketQuery(workspaceId, ticketId, assigneeId);
  if (rows.length === 0) {
    throw new Error("Ticket not found in this workspace.");
  }

  try {
    await logTicketActivity({
      workspaceId,
      ticketId,
      actorId,
      kind: "assigned",
      detail: { assigneeId },
    });
  } catch {
    // swallow — best-effort logging.
  }

  return rows[0];
}

export type TicketFieldUpdate = {
  title?: string;
  description?: string | null;
  priority?: TicketPriority;
  dueAt?: Date | null;
  linkedType?: TicketLinkType | null;
  linkedId?: string | null;
  labels?: string[];
};

export function updateTicketFieldsQuery(
  workspaceId: string,
  ticketId: string,
  fields: TicketFieldUpdate,
) {
  return db
    .update(tickets)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)))
    .returning({ id: tickets.id });
}

/** Guard-in-WHERE builder for hard delete (exposed for SQL-shape
 *  assertions). Workspace+id scoped like every other mutation here. This is
 *  a hard delete — it cascades to `ticket_comments` and `ticket_activity`
 *  via their existing FK cascade (T2/T3), so no manual cleanup is needed
 *  here. Gated to owner-only at the action layer (see ticket-permissions.ts
 *  and deleteTicketAction), not enforced in this query itself. */
export function deleteTicketQuery(workspaceId: string, ticketId: string) {
  return db
    .delete(tickets)
    .where(and(eq(tickets.workspaceId, workspaceId), eq(tickets.id, ticketId)))
    .returning({ id: tickets.id });
}

export async function deleteTicket(workspaceId: string, ticketId: string) {
  const rows = await deleteTicketQuery(workspaceId, ticketId);
  if (rows.length === 0) {
    throw new Error("Ticket not found in this workspace.");
  }
  return rows[0];
}

export async function updateTicketFields(
  workspaceId: string,
  ticketId: string,
  fields: TicketFieldUpdate,
  actorId: string,
) {
  const rows = await updateTicketFieldsQuery(workspaceId, ticketId, fields);
  if (rows.length === 0) {
    throw new Error("Ticket not found in this workspace.");
  }

  // "labeled" takes priority over the generic "edited" when labels were
  // part of this update — a clearer signal in the compact timeline. Both
  // are best-effort: logging failure never masks the update result.
  try {
    if (fields.labels !== undefined) {
      await logTicketActivity({
        workspaceId,
        ticketId,
        actorId,
        kind: "labeled",
        detail: { labels: fields.labels },
      });
    } else {
      await logTicketActivity({
        workspaceId,
        ticketId,
        actorId,
        kind: "edited",
      });
    }
  } catch {
    // swallow — best-effort logging.
  }

  return rows[0];
}
