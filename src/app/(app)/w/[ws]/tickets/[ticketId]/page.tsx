import Link from "next/link";
import { notFound } from "next/navigation";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { listTicketComments } from "@/db/queries/ticket-comments";
import { listTicketActivity } from "@/db/queries/ticket-activity";
import { getTicket, listTickets } from "@/db/queries/tickets";
import { getCampaignById } from "@/db/queries/campaigns";
import { getClientById, getContentById } from "@/db/queries/clients";
import { getIdea } from "@/db/queries/ideas";
import { listLinkedAssets } from "@/db/queries/assets";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isOverdueTicket, resolveTicketLink, transitionsFor } from "@/lib/tickets";
import { PRIORITY_COLORS, type TicketPriority } from "../ticket-card";
import { TicketTransitionForm } from "../ticket-transition-form";
import { CommentForm } from "./comment-form";
import { LabelEditForm } from "./label-edit-form";
import { ActivityTimeline } from "./activity-timeline";
import { DeleteTicketButton } from "./delete-ticket-button";
import { AddSubtaskForm } from "./add-subtask-form";
import { TicketAttachments } from "./ticket-attachments";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

/** F9.3: resolve tickets.linkedType/linkedId to the real object's {id,
 *  label} via each type's existing workspace-scoped get-by-id query. Returns
 *  null when there's no link set, OR when the linked row no longer exists
 *  (deleted) — resolveTicketLink (src/lib/tickets.ts) turns that null into
 *  the "no longer available" render state. */
async function resolveLinkedObject(
  workspaceId: string,
  linkedType: "content" | "idea" | "campaign" | "client" | null,
  linkedId: string | null,
): Promise<{ id: string; label: string } | null> {
  if (!linkedType || !linkedId) return null;

  if (linkedType === "content") {
    const row = await getContentById(workspaceId, linkedId);
    return row ? { id: row.id, label: row.title } : null;
  }
  if (linkedType === "idea") {
    const row = await getIdea(workspaceId, linkedId);
    return row ? { id: row.id, label: row.topic } : null;
  }
  if (linkedType === "campaign") {
    const row = await getCampaignById(workspaceId, linkedId);
    return row ? { id: row.id, label: row.name } : null;
  }
  const row = await getClientById(workspaceId, linkedId);
  return row ? { id: row.id, label: row.name } : null;
}

export default async function TicketDetailPage(
  props: {
    params: Promise<{ ws: string; ticketId: string }>;
  }
) {
  const params = await props.params;
  const ticket = await getTicket(params.ws, params.ticketId);
  if (!ticket) notFound();

  const [comments, members, activity, children, parent, linkedObject, attachments] =
    await Promise.all([
      listTicketComments(params.ws, params.ticketId),
      listWorkspaceMembers(params.ws),
      listTicketActivity(params.ws, params.ticketId),
      listTickets(params.ws, { parentTicketId: params.ticketId }),
      ticket.parentTicketId
        ? getTicket(params.ws, ticket.parentTicketId)
        : Promise.resolve(null),
      resolveLinkedObject(params.ws, ticket.linkedType, ticket.linkedId),
      listLinkedAssets(params.ws, "ticket", params.ticketId),
    ]);

  const memberNameById: Record<string, string> = Object.fromEntries(
    members.map((m) => [m.userId, m.name ?? m.email]),
  );

  const assignee = ticket.assigneeId
    ? members.find((m) => m.userId === ticket.assigneeId)
    : null;
  const transitions = transitionsFor(ticket.status);
  const overdue = isOverdueTicket(ticket.dueAt, ticket.status);
  const priority = ticket.priority as TicketPriority;
  const linkView = resolveTicketLink(
    params.ws,
    ticket.linkedType,
    ticket.linkedId,
    linkedObject,
  );

  return (
    <PageShell width="prose">
      <Link
        href={`/w/${params.ws}/tickets`}
        className="text-xs text-muted-foreground/70 hover:text-foreground"
      >
        ← All tickets
      </Link>

      {parent ? (
        <div className="mt-1">
          <Link
            href={`/w/${params.ws}/tickets/${parent.id}`}
            className="text-xs text-muted-foreground/70 hover:text-brand-teal hover:underline"
          >
            Part of: {parent.title}
          </Link>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">{ticket.title}</h1>
        <Badge variant="outline" className="border-border text-muted-foreground/70">
          {ticket.status}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px]",
            PRIORITY_COLORS[priority],
          )}
        >
          {ticket.priority}
        </span>
        <span>
          {assignee?.name ?? assignee?.email ?? "Unassigned"}
        </span>
        {ticket.dueAt ? (
          <span className={cn(overdue && "text-destructive")}>
            due {ticket.dueAt.toLocaleDateString()}
          </span>
        ) : null}
        {overdue ? (
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            Overdue
          </Badge>
        ) : null}
      </div>

      {ticket.description ? (
        <GlassCard className="mt-6 p-5">
          <p className="label-mono text-brand-teal">Description</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
            {ticket.description}
          </p>
        </GlassCard>
      ) : null}

      {linkView ? (
        <GlassCard className="mt-6 p-5">
          <p className="label-mono text-brand-purple">
            Linked {ticket.linkedType}
          </p>
          {"missing" in linkView ? (
            <p className="mt-2 text-sm text-muted-foreground/70">
              Linked item no longer available.
            </p>
          ) : linkView.clickable ? (
            <Link
              href={linkView.href}
              className="mt-2 inline-block text-sm text-brand-teal hover:underline"
            >
              {linkView.label}
            </Link>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{linkView.label}</p>
          )}
        </GlassCard>
      ) : null}

      <TicketAttachments
        workspaceId={params.ws}
        ticketId={ticket.id}
        attachments={attachments}
        memberNameById={memberNameById}
      />

      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Labels</p>
          {ticket.labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {ticket.labels.map((label) => (
                <span
                  key={label}
                  className="rounded bg-brand-teal/15 px-1.5 py-0.5 text-[11px] text-brand-teal"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <LabelEditForm
          workspaceId={params.ws}
          ticketId={ticket.id}
          labels={ticket.labels}
        />
      </GlassCard>

      {transitions.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {transitions.map((t) => (
            <TicketTransitionForm
              key={t.to}
              workspaceId={params.ws}
              ticketId={ticket.id}
              from={ticket.status}
              to={t.to}
              label={t.label}
            />
          ))}
        </div>
      ) : null}

      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Sub-tasks</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {children.length} sub-task{children.length === 1 ? "" : "s"}
          </span>
        </div>
        {children.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No sub-tasks yet — break this down into smaller pieces.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {children.map((child) => (
              <li
                key={child.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <Link
                  href={`/w/${params.ws}/tickets/${child.id}`}
                  className="text-sm text-foreground hover:text-brand-teal hover:underline"
                >
                  {child.title}
                </Link>
                <Badge
                  variant="outline"
                  className="border-border text-[11px] text-muted-foreground/70"
                >
                  {child.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <AddSubtaskForm workspaceId={params.ws} parentTicketId={ticket.id} />
      </GlassCard>

      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Comments</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {comments.length} comment{comments.length === 1 ? "" : "s"} ·
            refreshes every 10s
          </span>
        </div>
        {comments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No comments yet — leave feedback or a status note.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {comment.authorName ?? comment.authorEmail ?? "Teammate"}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground/50">
                    {comment.createdAt.toLocaleString()}
                  </p>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}
        <CommentForm workspaceId={params.ws} ticketId={ticket.id} />
        <ActivityTimeline activity={activity} members={members} />
      </GlassCard>

      <div className="mt-6 flex justify-end">
        <DeleteTicketButton workspaceId={params.ws} ticketId={ticket.id} />
      </div>
    </PageShell>
  );
}
