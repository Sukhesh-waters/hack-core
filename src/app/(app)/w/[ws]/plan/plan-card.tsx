"use client";

import { useEffect, useRef, useState, useTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass-card";
import { RejectReasonPanel } from "@/components/reject-reason-panel";
import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
import {
  IDEA_STATUS_CHIP_CLASSES,
  IDEA_STATUS_LABELS,
  nextIdeaStatusesFrom,
  type IdeaStatus,
} from "@/lib/idea-workflow";
import {
  acceptIdeaAction,
  editIdeaAction,
  rejectIdeaAction,
  type PlanState,
} from "./actions";

export type PlanIdeaView = {
  id: string;
  clientId: string;
  clientName: string;
  topic: string;
  hook: string;
  angle: string | null;
  format: string | null;
  whyReason: string | null;
  citedCaptions: string[];
  status: IdeaStatus;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

function ConfirmRejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      {pending ? "Rejecting…" : "Confirm reject"}
    </Button>
  );
}

export function PlanCard({
  workspaceId,
  idea,
  pipelineChip,
}: {
  workspaceId: string;
  idea: PlanIdeaView;
  pipelineChip?: string;
}) {
  const [mode, setMode] = useState<"view" | "editing" | "rejecting">("view");
  const [draft, setDraft] = useState({
    topic: idea.topic,
    hook: idea.hook,
    angle: idea.angle ?? "",
    format: idea.format ?? "",
  });
  const [reason, setReason] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [editState, editAction] = useActionState<PlanState, FormData>(
    editIdeaAction,
    undefined,
  );
  const [rejectState, rejectActionFn] = useActionState<PlanState, FormData>(
    rejectIdeaAction,
    undefined,
  );

  const lastEditState = useRef<PlanState>(undefined);
  useEffect(() => {
    if (editState !== lastEditState.current) {
      lastEditState.current = editState;
      if (!editState?.error) setMode("view");
    }
  }, [editState]);

  const statusOptions: TransitionOption<IdeaStatus>[] = nextIdeaStatusesFrom(
    idea.status,
  ).map((option) => ({
    value: option.status,
    // Semantic verb ("Accept", "Reject") when this destination has one,
    // falling back to the plain status name for the rest.
    label: option.actionLabel ?? IDEA_STATUS_LABELS[option.status],
    allowed: option.allowed,
    reason: option.reason,
    chipClass: IDEA_STATUS_CHIP_CLASSES[option.status],
  }));

  function handleStatusSelect(to: IdeaStatus) {
    setStatusError(null);
    if (to === "archived") {
      setMode("rejecting");
      return;
    }
    if (to === "drafted") {
      const formData = new FormData();
      formData.set("workspaceId", workspaceId);
      formData.set("ideaId", idea.id);
      // acceptIdeaAction triggers an AI draft generation that can take
      // seconds — the status trigger must show a busy state for that whole
      // window, not just fire-and-forget.
      startTransition(async () => {
        const result = await acceptIdeaAction(undefined, formData);
        if (result?.error) setStatusError(result.error);
      });
    }
  }

  if (mode === "editing") {
    return (
      <GlassCard className="space-y-3 p-5">
        <p className="label-mono text-muted-foreground/70">Editing idea</p>
        <Input
          value={draft.topic}
          onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
          placeholder="Topic"
        />
        <Input
          value={draft.hook}
          onChange={(e) => setDraft((d) => ({ ...d, hook: e.target.value }))}
          placeholder="Hook"
        />
        <Input
          value={draft.angle}
          onChange={(e) => setDraft((d) => ({ ...d, angle: e.target.value }))}
          placeholder="Angle (optional)"
        />
        <Input
          value={draft.format}
          onChange={(e) =>
            setDraft((d) => ({ ...d, format: e.target.value }))
          }
          placeholder="Format (optional)"
        />
        {editState?.error ? (
          <p className="text-xs text-destructive">{editState.error}</p>
        ) : null}
        <div className="flex items-center justify-between pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode("view")}
          >
            Cancel
          </Button>
          <form action={editAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="ideaId" value={idea.id} />
            <input type="hidden" name="topic" value={draft.topic} />
            <input type="hidden" name="hook" value={draft.hook} />
            <input type="hidden" name="angle" value={draft.angle} />
            <input type="hidden" name="format" value={draft.format} />
            <SaveButton />
          </form>
        </div>
      </GlassCard>
    );
  }

  if (mode === "rejecting") {
    return (
      <RejectReasonPanel
        reason={reason}
        onReasonChange={setReason}
        error={rejectState?.error}
        onCancel={() => setMode("view")}
      >
        <form action={rejectActionFn}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="ideaId" value={idea.id} />
          <input type="hidden" name="reason" value={reason} />
          <ConfirmRejectButton />
        </form>
      </RejectReasonPanel>
    );
  }

  return (
    <GlassCard className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-mono text-muted-foreground/70">{idea.clientName}</p>
          <p className="mt-1 font-display text-xl">{idea.hook}</p>
        </div>
        {idea.format ? (
          <Badge
            variant="outline"
            className="shrink-0 border-border text-muted-foreground/70"
          >
            {idea.format}
          </Badge>
        ) : null}
      </div>
      {idea.angle ? (
        <p className="mt-2 text-sm text-muted-foreground">{idea.angle}</p>
      ) : null}

      {idea.whyReason ? (
        <div className="mt-4 rounded-xl border border-brand-purple/25 bg-brand-purple/5 p-3">
          <p className="label-mono text-brand-purple">Why this idea</p>
          <p className="mt-1 text-sm text-muted-foreground">{idea.whyReason}</p>
          {idea.citedCaptions.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {idea.citedCaptions.map((caption) => (
                <li
                  key={caption}
                  className="truncate text-xs text-muted-foreground/70"
                  title={caption}
                >
                  ↳ first-party: “{caption}”
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <StatusMenu
          current={idea.status}
          currentLabel={pending ? "Working…" : IDEA_STATUS_LABELS[idea.status]}
          currentChipClass={IDEA_STATUS_CHIP_CLASSES[idea.status]}
          options={statusOptions}
          onSelect={handleStatusSelect}
          disabled={pending}
          label={idea.hook}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setMode("editing")}
        >
          Edit
        </Button>
        {statusError ? (
          <p className="text-xs text-destructive">{statusError}</p>
        ) : null}
      </div>

      {pipelineChip ? (
        <div className="mt-3 rounded-lg border border-brand-teal/20 bg-brand-teal/5 px-3 py-2">
          <p className="text-xs text-muted-foreground/70">Pipeline</p>
          <p className="mt-0.5 text-xs font-medium text-foreground">
            {pipelineChip}
          </p>
        </div>
      ) : null}
    </GlassCard>
  );
}
