import { GlassCard } from "@/components/glass-card";
import {
  TICKET_STATUS_LABELS,
  TICKET_STATUS_ORDER,
  type TicketStatus,
} from "@/lib/tickets";
import { TicketCard, type TicketCardView } from "./ticket-card";

/** Board view — one column per TICKET_STATUS_ORDER value, matching
 *  production's kanban idiom. Server-rendered, no realtime in T1. */
export function TicketBoard({
  workspaceId,
  tickets,
}: {
  workspaceId: string;
  tickets: TicketCardView[];
}) {
  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-4">
      {TICKET_STATUS_ORDER.map((status: TicketStatus) => {
        const cards = tickets.filter((t) => t.status === status);
        return (
          <div key={status}>
            <div className="flex items-center justify-between pt-2">
              <p className="label-mono text-muted-foreground/70">
                {TICKET_STATUS_LABELS[status]}
              </p>
              <span className="font-mono text-xs text-muted-foreground/70">
                {cards.length}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {cards.length === 0 ? (
                <GlassCard className="p-4 text-center text-xs text-muted-foreground/50">
                  Empty
                </GlassCard>
              ) : (
                cards.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    workspaceId={workspaceId}
                    ticket={ticket}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
