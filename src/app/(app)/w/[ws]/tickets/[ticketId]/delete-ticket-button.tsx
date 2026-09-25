"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { deleteTicketAction, type TicketState } from "../actions";

/**
 * Small, low-emphasis delete affordance. No AlertDialog/confirm-dialog
 * pattern exists anywhere in the app yet (checked — no `confirm(` usage, no
 * shadcn AlertDialog import), so per T4 spec a native browser confirm() in
 * a thin client wrapper is used instead of building a new dialog component
 * for one button.
 *
 * Role is not cheaply available client-side here (the detail page doesn't
 * currently fetch the caller's membership), so this button always renders —
 * the server action (deleteTicketAction -> canPerformTicketAction) is the
 * actual permission gate. Any non-owner who clicks it gets the action's
 * "You don't have permission to do that." error back inline. The UI is a
 * convenience, not the enforcement.
 */
function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-destructive/60 hover:text-destructive disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete ticket"}
    </button>
  );
}

export function DeleteTicketButton({
  workspaceId,
  ticketId,
}: {
  workspaceId: string;
  ticketId: string;
}) {
  const [state, formAction] = useActionState<TicketState, FormData>(
    deleteTicketAction,
    undefined,
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("Delete this ticket? This can't be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <DeleteButton />
      {state?.error ? (
        <p className="mt-1 text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
