"use client";

import { useEffect, useRef, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTemplateAction, type SopActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Creating…" : "Create template"}
    </Button>
  );
}

export function NewTemplateForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState<SopActionState, FormData>(
    createTemplateAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedAt = useRef<number | undefined>(undefined);

  // Clear after a successful create — a revalidate re-renders rather than
  // remounts, so uncontrolled inputs otherwise keep the last template's
  // name and description sitting in the form.
  useEffect(() => {
    if (!state?.savedAt || state.savedAt === lastSavedAt.current) return;
    lastSavedAt.current = state.savedAt;
    formRef.current?.reset();
  }, [state?.savedAt]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Name *
          </span>
          <Input
            name="name"
            required
            maxLength={80}
            placeholder="Campaign launch"
            className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Runs count from *
          </span>
          <Input
            name="anchorLabel"
            required
            maxLength={40}
            defaultValue="Launch date"
            placeholder="Launch date"
            className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground/50">
            Every step&apos;s due date is an offset from this.
          </span>
        </label>
      </div>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Description
        </span>
        <Input
          name="description"
          maxLength={500}
          placeholder="What this process is for"
          className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
      </label>
      {state?.error ? (
        <p className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
