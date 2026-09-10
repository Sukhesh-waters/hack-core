"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  updateClientContactEmailAction,
  type UpdateContactEmailState,
} from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function ContactEmailForm({
  workspaceId,
  clientId,
  contactEmail,
}: {
  workspaceId: string;
  clientId: string;
  contactEmail: string | null;
}) {
  const [state, formAction] = useFormState<UpdateContactEmailState, FormData>(
    updateClientContactEmailAction,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex items-center gap-2">
        <Input
          type="email"
          name="contactEmail"
          defaultValue={contactEmail ?? ""}
          placeholder="client@example.com"
          className="h-8 w-56 text-xs"
        />
        <SaveButton />
      </div>
      {state?.ok ? (
        <p className="text-xs text-brand-teal">{state.ok}</p>
      ) : null}
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
