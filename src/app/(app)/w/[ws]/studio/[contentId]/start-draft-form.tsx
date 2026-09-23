"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { startDraftAction, type RefineState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save draft"}
    </Button>
  );
}

/**
 * Direct-add content (Production "New card", Calendar "Add to this day")
 * has no AI-generated draft to fall back on. This lets someone type one by
 * hand so the card can enter the same compliance/refine/publish pipeline
 * as an AI-generated draft.
 */
export function StartDraftForm({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  const [state, formAction] = useActionState<RefineState, FormData>(
    startDraftAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />
      <div>
        <label className="label-mono text-muted-foreground/70" htmlFor="caption">
          Caption
        </label>
        <textarea
          id="caption"
          name="caption"
          rows={3}
          required
          className="mt-1 w-full rounded-md border border-border bg-muted p-2 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="label-mono text-muted-foreground/70" htmlFor="script">
          Script
        </label>
        <textarea
          id="script"
          name="script"
          rows={4}
          required
          className="mt-1 w-full rounded-md border border-border bg-muted p-2 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="label-mono text-muted-foreground/70" htmlFor="hashtags">
          Hashtags
        </label>
        <input
          id="hashtags"
          name="hashtags"
          placeholder="#brand #launch"
          className="mt-1 w-full rounded-md border border-border bg-muted p-2 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="label-mono text-muted-foreground/70" htmlFor="cta">
          Call to action
        </label>
        <input
          id="cta"
          name="cta"
          required
          className="mt-1 w-full rounded-md border border-border bg-muted p-2 text-sm text-foreground"
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
