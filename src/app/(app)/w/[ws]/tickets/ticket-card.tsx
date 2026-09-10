"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";
import { cn } from "@/lib/utils";
import {
  isOverdueTicket,
  transitionsFor,
  type TicketStatus,
} from "@/lib/tickets";
import { TicketTransitionForm } from "./ticket-transition-form";

export type TicketPriority = "high" | "medium" | "low";

export type TicketCardView = {
  id: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeName: string | null;
  assigneeEmail: string | null;
  dueAt: Date | null;
};

// Static, fully-written-out Tailwind classes — JIT scans source text, so
// nothing here may be template-built (colors.ts precedent).
export const PRIORITY_COLORS: Record<TicketPriority, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-amber-400/15 text-amber-300",
  low: "bg-accent text-muted-foreground",
};

export function TicketCard({
  workspaceId,
  ticket,
}: {
  workspaceId: string;
  ticket: TicketCardView;
}) {
  const transitions = transitionsFor(ticket.status);
  const overdue = isOverdueTicket(ticket.dueAt, ticket.status);

  return (
    <GlassCard className="space-y-3 p-4">
      <div>
        <Link
          href={`/w/${workspaceId}/tickets/${ticket.id}`}
          className="text-sm text-foreground hover:text-brand-teal hover:underline"
        >
          {ticket.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/70">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              PRIORITY_COLORS[ticket.priority],
            )}
          >
            {ticket.priority}
          </span>
          <span>{ticket.assigneeName ?? ticket.assigneeEmail ?? "Unassigned"}</span>
          {ticket.dueAt ? (
            <span className={cn(overdue && "text-destructive")}>
              due {ticket.dueAt.toLocaleDateString()}
            </span>
          ) : null}
        </div>
      </div>
      {overdue ? (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          Overdue
        </Badge>
      ) : null}
      {transitions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {transitions.map((t) => (
            <TicketTransitionForm
              key={t.to}
              workspaceId={workspaceId}
              ticketId={ticket.id}
              from={ticket.status}
              to={t.to}
              label={t.label}
            />
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}
