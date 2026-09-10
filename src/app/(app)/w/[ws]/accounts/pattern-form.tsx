"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addPublicPage, type AccountsActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      variant="outline"
      className="w-full"
    >
      {pending ? "Scraping via Apify…" : "Pull public patterns"}
    </Button>
  );
}

export function PatternForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useFormState<AccountsActionState, FormData>(
    addPublicPage,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-1.5">
        <Label htmlFor="handle">Public Instagram handle</Label>
        <Input id="handle" name="handle" placeholder="@competitor" required />
        <p className="text-xs text-muted-foreground/70">
          Lands in the pattern layer — source=public, weight neutral, never
          scored, never cited as performance truth.
        </p>
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? <p className="text-sm text-brand-teal">{state.ok}</p> : null}
      <SubmitButton />
    </form>
  );
}
