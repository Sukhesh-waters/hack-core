"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinWorkspace } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-purple text-foreground hover:bg-brand-purple/90"
    >
      {pending ? "Joining…" : "Join workspace"}
    </Button>
  );
}

export function JoinWorkspaceForm() {
  const [state, formAction] = useFormState(joinWorkspace, undefined);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="code" className="label-mono text-muted-foreground/70">
          Invite code or workspace slug
        </Label>
        <Input
          id="code"
          name="code"
          required
          placeholder="e.g. 4f9a2c81b3 or acme-skincare"
          className="border-border bg-muted font-mono text-sm text-foreground placeholder:text-muted-foreground/50"
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
