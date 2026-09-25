"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateTicketLabelsAction, type TicketState } from "../actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Saving…" : "Save labels"}
    </Button>
  );
}

/** Simple comma-separated label input — matches existing form patterns, no
 *  new shadcn component (T3 spec). Submitting appends a "labeled" activity
 *  row (see updateTicketFields in src/db/queries/tickets.ts). */
export function LabelEditForm({
  workspaceId,
  ticketId,
  labels,
}: {
  workspaceId: string;
  ticketId: string;
  labels: string[];
}) {
  const [state, formAction] = useActionState<TicketState, FormData>(
    updateTicketLabelsAction,
    undefined,
  );

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <Input
        name="labels"
        defaultValue={labels.join(", ")}
        placeholder="e.g. urgent, client-facing"
        maxLength={500}
        className="min-w-48 flex-1"
      />
      <SaveButton />
      {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
