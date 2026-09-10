"use client";

import { useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTicketAction, type TicketState } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Adding…" : "Add sub-task"}
    </Button>
  );
}

/**
 * T5: title-only sub-task creation, reusing createTicketAction rather than a
 * dedicated action — the only extra input is a hidden parentTicketId, and
 * createTicketAction already carries the cross-workspace guard
 * (assertParentTicketInWorkspace) for it. Mirrors comment-form.tsx's
 * reset-on-success pattern.
 */
export function AddSubtaskForm({
  workspaceId,
  parentTicketId,
}: {
  workspaceId: string;
  parentTicketId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<TicketState, FormData>(
    async (prev, formData) => {
      const result = await createTicketAction(prev, formData);
      if (!result?.error) formRef.current?.reset();
      return result;
    },
    undefined,
  );

  return (
    <form ref={formRef} action={formAction} className="mt-3 flex gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="parentTicketId" value={parentTicketId} />
      <Input
        name="title"
        placeholder="Add a sub-task…"
        maxLength={140}
        required
        className="flex-1"
      />
      <SubmitButton />
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
