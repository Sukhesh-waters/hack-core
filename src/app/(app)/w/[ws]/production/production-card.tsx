"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";
import {
  WorkflowStateMenu,
  type StateOptionView,
} from "@/components/workflow-state-menu";
import { cn } from "@/lib/utils";
import {
  clientColor,
  CONTENT_TYPE_COLORS,
  type ContentType,
} from "@/lib/colors";
import { transitionContentAction } from "./actions";

export type ProductionCardView = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  type: ContentType;
  /** W3 — the workflow state this card sits in, from the DB. */
  stateId: string;
  stateName: string;
  stateColorKey: string;
  revisionCount: number;
  /** Null when unassigned — the card renders "Unassigned" rather than
   *  hiding ownership, so a board scan shows gaps as loudly as owners. */
  assigneeName: string | null;
};

export function ProductionCard({
  workspaceId,
  card,
  options,
}: {
  workspaceId: string;
  card: ProductionCardView;
  /** Decided server-side by the engine against this workspace's own
   *  workflow — the client never computes legality. */
  options: StateOptionView[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Naming the destination ("Moving to Done…") is the per-action pending
  // indicator the discrete buttons had before they became one menu.
  const [pendingName, setPendingName] = useState<string | null>(null);

  function handleSelect(toStateId: string) {
    setError(null);
    setPendingName(options.find((o) => o.stateId === toStateId)?.name ?? null);
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("contentId", card.id);
    // Only the destination travels. The source is read server-side and the
    // write is guarded on it, so a stale tab can't assert a state it left.
    formData.set("toStateId", toStateId);
    startTransition(async () => {
      const result = await transitionContentAction(undefined, formData);
      if (result?.error) setError(result.error);
      setPendingName(null);
    });
  }

  return (
    <GlassCard className="space-y-3 p-4">
      <div>
        <p className="text-sm text-foreground">{card.title}</p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
              clientColor(card.clientId).dot,
            )}
          />
          <span>{card.clientName}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              CONTENT_TYPE_COLORS[card.type].chip,
            )}
          >
            {card.type}
          </span>
        </div>
        <p
          className={cn(
            "mt-1 text-[11px]",
            card.assigneeName ? "text-muted-foreground" : "text-muted-foreground/50",
          )}
        >
          {card.assigneeName ?? "Unassigned"}
        </p>
      </div>
      {card.revisionCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-brand-amber/40 text-brand-amber"
          >
            Revised ×{card.revisionCount}
          </Badge>
        </div>
      ) : null}
      <div>
        <WorkflowStateMenu
          currentStateId={card.stateId}
          currentName={card.stateName}
          currentColorKey={card.stateColorKey}
          options={options}
          onSelect={handleSelect}
          disabled={pending}
          pendingLabel={pendingName ? `Moving to ${pendingName}…` : undefined}
          label={card.title}
        />
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    </GlassCard>
  );
}
