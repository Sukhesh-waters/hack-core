"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { refineDraftAction, type RefineState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant="outline">
      {pending ? "Refining with brand rules…" : "Refine draft"}
    </Button>
  );
}

export function RefineForm({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  const [state, formAction] = useFormState<RefineState, FormData>(
    refineDraftAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />
      <div className="space-y-1.5">
        <Label htmlFor="feedback">Feedback</Label>
        <textarea
          id="feedback"
          name="feedback"
          required
          rows={3}
          placeholder="Make the CTA punchier; shorten the script."
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
