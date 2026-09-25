"use client";

import { useEffect, useRef, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClientGoalAction, type ClientGoalActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Set goal"}
    </Button>
  );
}

export function GoalForm({
  workspaceId,
  clientId,
}: {
  workspaceId: string;
  clientId: string;
}) {
  const [state, formAction] = useActionState<ClientGoalActionState, FormData>(
    createClientGoalAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedAt = useRef<number | undefined>(undefined);

  // Clear after a successful create — a revalidate re-renders rather than
  // remounts, so uncontrolled inputs otherwise keep the last goal's title
  // and hypothesis sitting in the form.
  useEffect(() => {
    if (!state?.savedAt || state.savedAt === lastSavedAt.current) return;
    lastSavedAt.current = state.savedAt;
    formRef.current?.reset();
  }, [state?.savedAt]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Goal *
          </span>
          <Input
            name="title"
            required
            maxLength={160}
            placeholder="Grow saves on educational reels"
            className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Metric *
          </span>
          <Input
            name="metric"
            required
            maxLength={80}
            placeholder="saves, engagement rate…"
            className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Hypothesis
        </span>
        <Input
          name="hypothesis"
          maxLength={1000}
          placeholder="Educational hooks outperform promotional ones for this audience"
          className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Window start *
          </span>
          <Input
            name="targetWindowStart"
            type="date"
            required
            className="mt-1 border-border bg-muted text-foreground"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Window end *
          </span>
          <Input
            name="targetWindowEnd"
            type="date"
            required
            className="mt-1 border-border bg-muted text-foreground"
          />
        </label>
      </div>
      {state?.error ? (
        <p className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
