"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideGateStepAction } from "../sop/actions";
import type { SopActionState } from "../sop/actions";

function PendingButton({
  label,
  pending: pendingLabel,
  variant = "default",
}: {
  label: string;
  pending: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Approve closes the step; reject returns it with a reason.
 *
 * The reason is required on reject and nowhere else: an approval that says
 * nothing is still actionable ("it's fine"), but a rejection that says
 * nothing leaves the owner guessing what to change.
 */
export function GateDecisionForm({
  workspaceId,
  runId,
  stepId,
}: {
  workspaceId: string;
  runId: string;
  stepId: string;
}) {
  const [state, formAction] = useFormState<SopActionState, FormData>(
    decideGateStepAction,
    undefined,
  );
  const [rejecting, setRejecting] = useState(false);

  const hidden = (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="stepId" value={stepId} />
    </>
  );

  if (rejecting) {
    return (
      <form action={formAction} className="mt-3 space-y-2">
        {hidden}
        <input type="hidden" name="decision" value="reject" />
        <Input
          name="reason"
          required
          maxLength={500}
          autoFocus
          placeholder="What needs to change?"
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground/50"
        />
        {state?.error ? (
          <p className="text-xs text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <PendingButton
            label="Send back"
            pending="Sending…"
            variant="destructive"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRejecting(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <form action={formAction}>
          {hidden}
          <input type="hidden" name="decision" value="approve" />
          <PendingButton label="Approve" pending="Approving…" />
        </form>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRejecting(true)}
        >
          Send back
        </Button>
      </div>
      {state?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
