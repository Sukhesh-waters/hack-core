"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startRunAction, type SopActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Starting…" : "Start run"}
    </Button>
  );
}

export type RunnableTemplate = { id: string; name: string; anchorLabel: string };
export type ClientOption = { id: string; name: string };

export function StartRunForm({
  workspaceId,
  templates,
  clients,
}: {
  workspaceId: string;
  templates: RunnableTemplate[];
  clients: ClientOption[];
}) {
  const [state, formAction] = useActionState<SopActionState, FormData>(
    startRunAction,
    undefined,
  );

  // No reset effect here: a successful start redirects to the new run, so
  // this form is unmounted rather than re-rendered.
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Template *
          </span>
          <select
            name="templateId"
            required
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id} className="bg-popover">
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Name this run *
          </span>
          <Input
            name="name"
            required
            maxLength={120}
            placeholder="Aurora autumn launch"
            className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Anchor date *
          </span>
          <input
            type="date"
            name="anchorDate"
            required
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground [color-scheme:dark]"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground/50">
            Every step&apos;s due date is counted from this.
          </span>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Client
          </span>
          <select
            name="clientId"
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            <option value="" className="bg-popover">
              No client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id} className="bg-popover">
                {c.name}
              </option>
            ))}
          </select>
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
