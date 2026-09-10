"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass-card";
import {
  createProductionCardAction,
  type ProductionState,
} from "./actions";

export type ClientOption = { id: string; name: string };

const selectClasses =
  "h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Adding…" : "New card"}
    </Button>
  );
}

/** Direct kanban add — the card starts in Brief, status stays draft. */
export function NewCardForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: ClientOption[];
}) {
  const [state, formAction] = useFormState<ProductionState, FormData>(
    createProductionCardAction,
    undefined,
  );

  if (clients.length === 0) return null;

  return (
    <GlassCard className="mt-6 p-3">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <select
          name="clientId"
          className={selectClasses}
          defaultValue={clients[0].id}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id} className="bg-neutral-900">
              {c.name}
            </option>
          ))}
        </select>
        <Input
          name="title"
          placeholder="What needs producing?"
          maxLength={140}
          required
          className="min-w-48 flex-1"
        />
        <select name="type" className={selectClasses} defaultValue="post">
          {["post", "reel", "story", "carousel"].map((t) => (
            <option key={t} value={t} className="bg-neutral-900">
              {t}
            </option>
          ))}
        </select>
        <SubmitButton />
        {state?.error ? (
          <p className="w-full text-xs text-destructive">{state.error}</p>
        ) : null}
      </form>
    </GlassCard>
  );
}
