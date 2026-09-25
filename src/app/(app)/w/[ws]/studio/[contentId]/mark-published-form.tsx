"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { markPublishedAction, type RefineState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Marking published…" : "Mark as published"}
    </Button>
  );
}

/** Publish-back (W7): flips the draft to published once it's live. */
export function MarkPublishedForm({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  const [state, formAction] = useActionState<RefineState, FormData>(
    markPublishedAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
