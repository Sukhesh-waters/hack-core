"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import { RejectReasonPanel } from "@/components/reject-reason-panel";
import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
import {
  IDEA_STATUS_CHIP_CLASSES,
  IDEA_STATUS_LABELS,
  nextIdeaStatusesFrom,
  type IdeaStatus,
} from "@/lib/idea-workflow";
import { draftIdea, rejectIdeaAction } from "./actions";

export type IdeaView = {
  id: string;
  hook: string;
  angle: string | null;
  format: string | null;
  whyReason: string | null;
  citedCaptions: string[];
  status: IdeaStatus;
  // G1 — computed server-side from whyReason === DECLARED_ONLY_REASON.
  // NOT re-derived here: importing ideation-agent.ts (server-only AI router
  // chain, node:async_hooks) from this "use client" file breaks the client
  // bundle. Copy only, no new logic.
  isDeclaredOnly: boolean;
};

export function IdeaCard({
  workspaceId,
  idea,
}: {
  workspaceId: string;
  idea: IdeaView;
}) {
  const [mode, setMode] = useState<"view" | "rejecting">("view");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    setError(null);
    if (to === "archived") {
      setMode("rejecting");
      return;
    }
    if (to === "drafted") {
      const formData = new FormData();
      formData.set("workspaceId", workspaceId);
      formData.set("ideaId", idea.id);
      // draftIdea runs the AI draft generation and redirects to Studio on
      // success — the multi-second gap before that redirect is exactly why
      // the trigger needs a visible busy state, not a dead-looking button.
      startTransition(async () => {
        const result = await draftIdea(undefined, formData);
        if (result?.error) setError(result.error);
      });
    }
  }

  function handleConfirmReject() {
    setError(null);
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("ideaId", idea.id);
    formData.set("reason", reason);
    startTransition(async () => {
      const result = await rejectIdeaAction(undefined, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setMode("view");
    });
  }

  if (mode === "rejecting") {
    return (
      <RejectReasonPanel
        reason={reason}
        onReasonChange={setReason}
        error={error}
        onCancel={() => setMode("view")}
        cancelDisabled={pending}
      >
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={handleConfirmReject}
        >
          {pending ? "Rejecting…" : "Confirm reject"}
        </Button>
      </RejectReasonPanel>
    );
  }

  return (
    <GlassCard className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-xl">{idea.hook}</p>
        {idea.format ? (
          <Badge variant="outline" className="shrink-0 border-border text-muted-foreground/70">
            {idea.format}
          </Badge>
        ) : null}
      </div>
      {idea.angle ? (
        <p className="mt-2 text-sm text-muted-foreground">{idea.angle}</p>
      ) : null}

      {idea.whyReason ? (
        <div className="mt-4 rounded-xl border border-brand-purple/25 bg-brand-purple/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="label-mono text-brand-purple">Why this idea</p>
            {/* Evidence state — already computed (whyReason/citedCaptions),
                surfaced here as copy only. No new logic, no schema. */}
            {idea.isDeclaredOnly ? (
              <Badge
                variant="outline"
                className="border-border text-[11px] text-muted-foreground/70"
              >
                Declared context only
              </Badge>
            ) : idea.citedCaptions.length > 0 ? (
              <Badge
                variant="outline"
                className="border-brand-teal/40 text-[11px] text-brand-teal"
              >
                Baseline-backed
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-400/40 text-[11px] text-amber-300"
              >
                No citations
              </Badge>
            )}
          </div>
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
          currentLabel={
            pending ? "Working…" : IDEA_STATUS_LABELS[idea.status]
          }
          currentChipClass={IDEA_STATUS_CHIP_CLASSES[idea.status]}
          options={statusOptions}
          onSelect={handleStatusSelect}
          disabled={pending}
          label={idea.hook}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </GlassCard>
  );
}
