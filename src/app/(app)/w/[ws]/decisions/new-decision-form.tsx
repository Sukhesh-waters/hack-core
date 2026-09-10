"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDecisionAction, type DecisionActionState } from "./actions";

export type ClientOption = { id: string; name: string };
export type GoalOption = { id: string; title: string; hypothesis: string | null };
export type EvidencePostOption = { id: string; caption: string | null };
export type InsightOption = { id: string; pattern: string; suggestion: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Record decision"}
    </Button>
  );
}

export function NewDecisionForm({
  workspaceId,
  clients,
  goalsByClientId,
  postsByClientId,
  insights,
}: {
  workspaceId: string;
  clients: ClientOption[];
  goalsByClientId: Record<string, GoalOption[]>;
  postsByClientId: Record<string, EvidencePostOption[]>;
  insights: InsightOption[];
}) {
  const [state, formAction] = useFormState<DecisionActionState, FormData>(
    createDecisionAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const lastSavedAt = useRef<number | undefined>(undefined);

  // Controlled so the goal and evidence pickers can react to which client
  // is selected — same pattern as the ideation topic form (G1).
  const [clientId, setClientId] = useState("");
  const goalsForClient = clientId ? (goalsByClientId[clientId] ?? []) : [];
  const postsForClient = clientId ? (postsByClientId[clientId] ?? []) : [];

  useEffect(() => {
    if (!state?.savedAt || state.savedAt === lastSavedAt.current) return;
    lastSavedAt.current = state.savedAt;
    formRef.current?.reset();
    setClientId("");
  }, [state?.savedAt]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Decision *
        </span>
        <Input
          name="title"
          required
          maxLength={160}
          placeholder="Switch to educational hooks"
          className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
      </label>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Why *
        </span>
        <Input
          name="reason"
          required
          maxLength={1000}
          placeholder="Promotional posts underperformed last quarter"
          className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
      </label>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Expected outcome *
        </span>
        <Input
          name="expectedOutcome"
          required
          maxLength={500}
          placeholder="Engagement rate rises above the current baseline median"
          className="mt-1 border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
      </label>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Review on *
        </span>
        <Input
          name="reviewAt"
          type="date"
          required
          className="mt-1 border-border bg-muted text-foreground"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Client (optional)
          </span>
          <select
            name="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-border bg-muted px-3 py-1 text-sm text-foreground"
          >
            <option value="">Workspace-level</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Goal (optional)
          </span>
          <select
            name="goalId"
            defaultValue=""
            disabled={!clientId}
            className="mt-1 flex h-9 w-full rounded-md border border-border bg-muted px-3 py-1 text-sm text-foreground disabled:opacity-40"
          >
            <option value="">No goal</option>
            {goalsForClient.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {insights.length > 0 ? (
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Pattern insight (optional — inspiration, not proof)
          </span>
          <select
            name="insightId"
            defaultValue=""
            className="mt-1 flex h-9 w-full rounded-md border border-border bg-muted px-3 py-1 text-sm text-foreground"
          >
            <option value="">None</option>
            {insights.map((insight) => (
              <option key={insight.id} value={insight.id}>
                {insight.pattern}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {clientId ? (
        <div>
          <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Evidence — first-party posts only
          </span>
          {postsForClient.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground/50">
              No first-party posts for this client yet.
            </p>
          ) : (
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border border-border p-2">
              {postsForClient.map((post) => (
                <label
                  key={post.id}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <input
                    type="checkbox"
                    name="evidencePostIds"
                    value={post.id}
                    className="mt-0.5"
                  />
                  <span className="truncate">
                    {post.caption ?? "(no caption)"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {state?.error ? (
        <p className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
