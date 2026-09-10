"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { emitDomainEvent } from "@/lib/events/dispatch";
import { listWorkspaceMembers, requireMembership } from "@/db/queries/memberships";
import { addTicketComment } from "@/db/queries/ticket-comments";
import {
  assignTicket,
  advanceTicketStatus,
  createTicket,
  deleteTicket,
  getTicket,
  updateTicketFields,
} from "@/db/queries/tickets";
import { getCampaignById } from "@/db/queries/campaigns";
import { getClientById, getContentById } from "@/db/queries/clients";
import { getIdea } from "@/db/queries/ideas";
import { actionErrorMessage } from "@/lib/action-errors";
import { canPerformTicketAction } from "@/lib/ticket-permissions";
import {
  assertClientInSameWorkspace,
  assertLinkedObjectInWorkspace,
  assertParentInSameWorkspace,
  type TicketLinkType,
} from "@/lib/tickets";
import {
  addTicketCommentSchema,
  advanceTicketStatusSchema,
  assignTicketSchema,
  createTicketSchema,
  deleteTicketSchema,
  updateTicketLabelsSchema,
  updateTicketSchema,
} from "@/lib/ticket-schemas";

/** F9.3 isolation guard: a linkedId (if provided) must resolve to a real row
 *  of `linkedType` in THIS workspace — mirrors assertAssigneeIsMember below.
 *  Reuses each type's existing workspace-scoped get-by-id query; the
 *  pass/throw decision itself lives in the pure, directly-tested
 *  assertLinkedObjectInWorkspace (src/lib/tickets.ts). */
async function assertLinkedObjectResolves(
  workspaceId: string,
  linkedType: TicketLinkType,
  linkedId: string,
) {
  const resolved =
    linkedType === "content"
      ? await getContentById(workspaceId, linkedId)
      : linkedType === "idea"
        ? await getIdea(workspaceId, linkedId)
        : linkedType === "campaign"
          ? await getCampaignById(workspaceId, linkedId)
          : await getClientById(workspaceId, linkedId);
  assertLinkedObjectInWorkspace(resolved);
}

export type TicketState = { error?: string } | undefined;

/** An assigneeId (if provided) must actually be a member of this workspace —
 *  isolation guard so one workspace can't assign a ticket to another
 *  workspace's user. */
async function assertAssigneeIsMember(workspaceId: string, assigneeId: string) {
  const members = await listWorkspaceMembers(workspaceId);
  if (!members.some((m) => m.userId === assigneeId)) {
    throw new Error("That person is not a member of this workspace.");
  }
}

/** T5 isolation guard: a parentTicketId (if provided) must resolve to a real
 *  ticket in THIS workspace — mirrors assertAssigneeIsMember's layering
 *  above (action-layer check via a reused existence lookup, not re-verified
 *  inside the query-layer createTicket). getTicket's WHERE is already
 *  workspace-scoped, so a parent that exists in a DIFFERENT workspace
 *  returns null here — same as a parent that doesn't exist at all. The
 *  pass/throw decision itself lives in the pure, directly-tested
 *  assertParentInSameWorkspace (src/lib/tickets.ts) so the isolation
 *  guard has a real unit test, not just a comment. */
async function assertParentTicketInWorkspace(
  workspaceId: string,
  parentTicketId: string,
) {
  const parent = await getTicket(workspaceId, parentTicketId);
  assertParentInSameWorkspace(parent);
}

/** F9.5 isolation guard: a clientId (if provided) must resolve to a real
 *  client in THIS workspace — same layering as assertAssigneeIsMember and
 *  assertParentTicketInWorkspace above. The pass/throw decision itself lives
 *  in the pure, directly-tested assertClientInSameWorkspace
 *  (src/lib/tickets.ts) so the isolation guard has a real unit test, not
 *  just a comment. */
async function assertClientInWorkspace(workspaceId: string, clientId: string) {
  const client = await getClientById(workspaceId, clientId);
  assertClientInSameWorkspace(client);
}

export async function createTicketAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = createTicketSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority"),
    assigneeId: formData.get("assigneeId"),
    dueAt: formData.get("dueAt"),
    linkedType: formData.get("linkedType"),
    linkedId: formData.get("linkedId"),
    parentTicketId: formData.get("parentTicketId"),
    clientId: formData.get("clientId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const {
    workspaceId,
    title,
    description,
    priority,
    assigneeId,
    dueAt,
    linkedType,
    linkedId,
    parentTicketId,
    clientId,
  } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    if (assigneeId) await assertAssigneeIsMember(workspaceId, assigneeId);
    if (parentTicketId) {
      await assertParentTicketInWorkspace(workspaceId, parentTicketId);
    }
    if (linkedType && linkedId) {
      await assertLinkedObjectResolves(workspaceId, linkedType, linkedId);
    }
    if (clientId) await assertClientInWorkspace(workspaceId, clientId);
    await createTicket({
      workspaceId,
      title,
      description: description ?? null,
      priority,
      assigneeId: assigneeId ?? null,
      dueAt: dueAt ? new Date(dueAt) : null,
      createdById: user.id,
      linkedType: linkedType ?? null,
      linkedId: linkedId ?? null,
      parentTicketId: parentTicketId ?? null,
      clientId: clientId ?? null,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets`);
  if (parentTicketId) {
    revalidatePath(`/w/${workspaceId}/tickets/${parentTicketId}`);
  }
  if (clientId) {
    revalidatePath(`/w/${workspaceId}/clients/${clientId}`);
  }
  return undefined;
}

export async function advanceTicketStatusAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = advanceTicketStatusSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ticketId: formData.get("ticketId"),
    from: formData.get("from"),
    to: formData.get("to"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ticketId, from, to } = parsed.data;

  try {
    const user = await requireUser();
    const membership = await requireMembership(workspaceId, user.id);

    // Closing a ticket (any status -> "done") is the "force_close" action —
    // every other transition (start, block, unblock, reopen) stays open to
    // any member, unchanged.
    if (to === "done" && from !== "done") {
      const ticket = await getTicket(workspaceId, ticketId);
      if (!ticket) return { error: "Ticket not found." };
      const isOwnerOfTicket =
        ticket.createdById === user.id || ticket.assigneeId === user.id;
      const allowed = canPerformTicketAction(
        membership.role,
        "force_close",
        { isOwnerOfTicket },
      );
      if (!allowed) {
        return { error: "You don't have permission to do that." };
      }
    }

    await advanceTicketStatus({ workspaceId, ticketId, from, to, actorId: user.id });

    if (to === "done" && from !== "done") {
      await emitDomainEvent({
        verb: "ticket.closed",
        workspaceId,
        subjectType: "ticket",
        subjectId: ticketId,
        actorId: user.id,
        meta: { from, to },
      });
    } else if (from === "done" && to !== "done") {
      await emitDomainEvent({
        verb: "ticket.reopened",
        workspaceId,
        subjectType: "ticket",
        subjectId: ticketId,
        actorId: user.id,
        meta: { from, to },
      });
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets`);
  return undefined;
}

export async function assignTicketAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = assignTicketSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ticketId: formData.get("ticketId"),
    assigneeId: formData.get("assigneeId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ticketId, assigneeId } = parsed.data;

  try {
    const user = await requireUser();
    const membership = await requireMembership(workspaceId, user.id);
    if (assigneeId) await assertAssigneeIsMember(workspaceId, assigneeId);

    // Claiming an unassigned ticket (or assigning it to someone for the
    // first time) stays open to any member. Changing an EXISTING non-null
    // assigneeId to a different value (or to nobody) is "reassign_away" and
    // requires the permission check — fetch current state first to know
    // whether this is a reassignment away from an existing assignee.
    const ticket = await getTicket(workspaceId, ticketId);
    if (!ticket) return { error: "Ticket not found." };
    const newAssigneeId = assigneeId ?? null;
    const isReassignAway =
      ticket.assigneeId !== null && ticket.assigneeId !== newAssigneeId;
    if (isReassignAway) {
      const isOwnerOfTicket =
        ticket.createdById === user.id || ticket.assigneeId === user.id;
      const allowed = canPerformTicketAction(
        membership.role,
        "reassign_away",
        { isOwnerOfTicket },
      );
      if (!allowed) {
        return { error: "You don't have permission to do that." };
      }
    }

    await assignTicket(workspaceId, ticketId, newAssigneeId, user.id);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets`);
  return undefined;
}

export async function addTicketCommentAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = addTicketCommentSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ticketId: formData.get("ticketId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ticketId, body } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const ticket = await getTicket(workspaceId, ticketId);
    if (!ticket) return { error: "Ticket not found." };
    await addTicketComment({ workspaceId, ticketId, authorId: user.id, body });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets/${ticketId}`);
  return undefined;
}

export async function updateTicketAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = updateTicketSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ticketId: formData.get("ticketId"),
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority"),
    dueAt: formData.get("dueAt"),
    linkedType: formData.get("linkedType"),
    linkedId: formData.get("linkedId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const {
    workspaceId,
    ticketId,
    title,
    description,
    priority,
    dueAt,
    linkedType,
    linkedId,
  } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    if (linkedType && linkedId) {
      await assertLinkedObjectResolves(workspaceId, linkedType, linkedId);
    }
    await updateTicketFields(
      workspaceId,
      ticketId,
      {
        title,
        description: description ?? null,
        priority,
        dueAt: dueAt ? new Date(dueAt) : null,
        linkedType: linkedType ?? null,
        linkedId: linkedId ?? null,
      },
      user.id,
    );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets`);
  return undefined;
}

export async function updateTicketLabelsAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = updateTicketLabelsSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ticketId: formData.get("ticketId"),
    labels: formData.get("labels"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ticketId, labels } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await updateTicketFields(
      workspaceId,
      ticketId,
      { labels: labels ?? [] },
      user.id,
    );
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets/${ticketId}`);
  return undefined;
}

/** T4: hard-delete a ticket. Owner-only — canPerformTicketAction("delete")
 *  is always false for admin/member regardless of ownership. The ticket
 *  detail page will 404 after this succeeds; that's correct/expected. */
export async function deleteTicketAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const parsed = deleteTicketSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    ticketId: formData.get("ticketId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ticketId } = parsed.data;

  try {
    const user = await requireUser();
    const membership = await requireMembership(workspaceId, user.id);
    const ticket = await getTicket(workspaceId, ticketId);
    if (!ticket) return { error: "Ticket not found." };
    const isOwnerOfTicket =
      ticket.createdById === user.id || ticket.assigneeId === user.id;
    const allowed = canPerformTicketAction(membership.role, "delete", {
      isOwnerOfTicket,
    });
    if (!allowed) {
      return { error: "You don't have permission to do that." };
    }
    await deleteTicket(workspaceId, ticketId);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/tickets`);
  return undefined;
}
