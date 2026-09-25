"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { pushToTeamAction, type RefineState } from "./actions";

export type TeamMemberOption = { id: string; label: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Pushing…" : "Push to team"}
    </Button>
  );
}

/**
 * S8 — assignment, ticket, hub line, history and notification in one click.
 * Rendered only when the draft has a body; there is nothing to work on
 * otherwise, and the server rejects it anyway.
 */
export function PushToTeamForm({
  workspaceId,
  contentId,
  members,
}: {
  workspaceId: string;
  contentId: string;
  members: TeamMemberOption[];
}) {
  const [state, formAction] = useActionState<RefineState, FormData>(
    pushToTeamAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Owner *
          </span>
          <select
            name="assigneeId"
            required
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            <option value="" className="bg-popover">
              Pick someone
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id} className="bg-popover">
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Due *
          </span>
          <input
            type="date"
            name="dueAt"
            required
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Note (optional)
        </span>
        <textarea
          name="note"
          rows={2}
          maxLength={1000}
          placeholder="What does this person need to know?"
          className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
