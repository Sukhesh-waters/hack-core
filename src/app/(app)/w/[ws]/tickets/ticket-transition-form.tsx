"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { TicketStatus } from "@/lib/tickets";
import { advanceTicketStatusAction, type TicketState } from "./actions";

/** Shared status-transition button+form, used by both the board card and
 *  the ticket detail page — extracted from T1's ticket-card.tsx. */
function AdvanceButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export function TicketTransitionForm({
  workspaceId,
  ticketId,
  from,
  to,
  label,
}: {
  workspaceId: string;
  ticketId: string;
  from: TicketStatus;
  to: TicketStatus;
  label: string;
}) {
  const [state, formAction] = useActionState<TicketState, FormData>(
    advanceTicketStatusAction,
    undefined,
  );
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <AdvanceButton label={label} />
      {state?.error ? (
        <p className="mt-1 text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
