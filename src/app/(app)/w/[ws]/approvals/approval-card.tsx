"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { approveAction, scheduleAction, type ApprovalState } from "./actions";

function PendingButton({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={status.pending}>
      {status.pending ? pending : label}
    </Button>
  );
}

export function ApproveForm({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  const [state, formAction] = useFormState<ApprovalState, FormData>(
    approveAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />
      <PendingButton label="Approve" pending="Approving…" />
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

export function ScheduleForm({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  const [state, formAction] = useFormState<ApprovalState, FormData>(
    scheduleAction,
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentId" value={contentId} />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
        Scheduled for *
        <input
          type="datetime-local"
          name="scheduledFor"
          required
          className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground [color-scheme:dark]"
        />
      </label>
      <PendingButton label="Schedule" pending="Scheduling…" />
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

export function DraftLink({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  return (
    <Link
      href={`/w/${workspaceId}/studio/${contentId}`}
      className="text-xs text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
    >
      Open draft
    </Link>
  );
}
