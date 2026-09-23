"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithEmail } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-brand-teal text-foreground hover:bg-brand-teal/90"
    >
      {pending ? "Sending link…" : "Email me a magic link"}
    </Button>
  );
}

export function EmailForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction] = useActionState(signInWithEmail, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="space-y-2 text-left">
        <Label htmlFor="email" className="label-mono text-muted-foreground/70">
          Work email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@agency.com"
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
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
