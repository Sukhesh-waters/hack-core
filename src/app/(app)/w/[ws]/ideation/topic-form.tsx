"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runIdeation, type IdeationState } from "./actions";

export type GoalOption = { id: string; title: string; hypothesis: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Ideating — retrieving drivers, scoring angles…" : "Generate ideas"}
    </Button>
  );
}

export function TopicForm({
  workspaceId,
  clients,
  goalsByClientId,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
  /** G1 — active goals per client, for the optional goal picker below. */
  goalsByClientId: Record<string, GoalOption[]>;
}) {
  const [state, formAction] = useActionState<IdeationState, FormData>(
    runIdeation,
    undefined,
  );
  // Controlled so the goal picker can react to which client is selected.
  const [clientId, setClientId] = useState("");
  const goalsForClient = clientId ? (goalsByClientId[clientId] ?? []) : [];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-1.5">
        <Label htmlFor="clientId">Client</Label>
        <select
          id="clientId"
          name="clientId"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="">Select a client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="topic">Topic</Label>
        <Input
          id="topic"
          name="topic"
          placeholder="Spring menu launch"
          required
        />
      </div>
      {clientId ? (
        <div className="space-y-1.5">
          <Label htmlFor="goalId">Client goal (optional)</Label>
          <select
            id="goalId"
            name="goalId"
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">No goal</option>
            {goalsForClient.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
          {goalsForClient.length === 0 ? (
            <p className="text-xs text-muted-foreground/50">
              No active goals for this client yet.
            </p>
          ) : null}
        </div>
      ) : null}
      {state?.error ? (
        <p className="text-sm text-brand-amber">{state.error}</p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
