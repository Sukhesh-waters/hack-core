import { TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/tickets";
import type { TicketActivityKind } from "@/db/queries/ticket-activity";

type ActivityRow = {
  id: string;
  actorId: string;
  kind: TicketActivityKind;
  detail: {
    from?: string;
    to?: string;
    assigneeId?: string | null;
    labels?: string[];
    mentionedUserId?: string;
  } | null;
  createdAt: Date;
};

type MemberLookup = { userId: string; name: string | null; email: string };

function actorLabel(actorId: string, members: MemberLookup[]): string {
  const member = members.find((m) => m.userId === actorId);
  return member?.name ?? member?.email ?? "Someone";
}

function statusLabel(status: string | undefined): string {
  if (!status) return "?";
  return TICKET_STATUS_LABELS[status as TicketStatus] ?? status;
}

function describeActivity(row: ActivityRow, members: MemberLookup[]): string {
  const who = actorLabel(row.actorId, members);
  switch (row.kind) {
    case "created":
      return `${who} created this ticket`;
    case "status_changed":
      return `${who} moved ${statusLabel(row.detail?.from)} → ${statusLabel(row.detail?.to)}`;
    case "assigned": {
      const assigneeId = row.detail?.assigneeId;
      if (!assigneeId) return `${who} unassigned this ticket`;
      const assigneeName = actorLabel(assigneeId, members);
      return `${who} assigned this to ${assigneeName}`;
    }
    case "commented":
      return `${who} commented`;
    case "edited":
      return `${who} edited this ticket`;
    case "labeled": {
      const labels = row.detail?.labels ?? [];
      return labels.length > 0
        ? `${who} set labels: ${labels.join(", ")}`
        : `${who} cleared labels`;
    }
    case "mentioned": {
      const mentionedUserId = row.detail?.mentionedUserId;
      const mentionedName = mentionedUserId
        ? actorLabel(mentionedUserId, members)
        : "someone";
      return `${who} mentioned ${mentionedName}`;
    }
    default:
      return `${who} updated this ticket`;
  }
}

/** Compact timeline below comments — one line per event, per T3 spec. */
export function ActivityTimeline({
  activity,
  members,
}: {
  activity: ActivityRow[];
  members: MemberLookup[];
}) {
  if (activity.length === 0) return null;

  return (
    <div className="mt-4 space-y-1 border-t border-border pt-3">
      <p className="label-mono text-muted-foreground/50">Activity</p>
      <ul className="space-y-1">
        {activity.map((row) => (
          <li key={row.id} className="text-xs text-muted-foreground/70">
            {describeActivity(row, members)} ·{" "}
            {row.createdAt.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
