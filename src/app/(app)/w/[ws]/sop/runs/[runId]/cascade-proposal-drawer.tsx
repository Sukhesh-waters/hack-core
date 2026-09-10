"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, Sparkles, X, Clock } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";
import {
  applyCascadeProposalAction,
  dismissCascadeProposalAction,
} from "./cascade-actions";
import type { CascadeResult } from "@/lib/sop/cascade";

export function CascadeProposalDrawer({
  workspaceId,
  runId,
  proposalId,
  cascade,
  aiExplanation,
  aiClientNote,
  onClose,
}: {
  workspaceId: string;
  runId: string;
  proposalId: string;
  cascade: CascadeResult;
  aiExplanation?: string;
  aiClientNote?: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientNoteDraft, setClientNoteDraft] = useState(aiClientNote ?? "");

  const handleApply = () => {
    setError(null);
    startTransition(async () => {
      const res = await applyCascadeProposalAction({
        workspaceId,
        runId,
        proposalId,
      });
      if (res.ok) {
        onClose();
      } else {
        setError(res.error ?? "Failed to apply cascade changes.");
      }
    });
  };

  const handleDismiss = () => {
    setError(null);
    startTransition(async () => {
      await dismissCascadeProposalAction({
        workspaceId,
        runId,
        proposalId,
      });
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-md animate-in fade-in">
      <GlassCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border-brand-amber/30 bg-popover p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-brand-amber" />
            <h3 className="font-display text-lg font-bold text-foreground">
              Schedule Cascade Proposal (+{cascade.slipDays}d)
            </h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {/* AI Operational Explanation */}
        {aiExplanation ? (
          <div className="mt-4 rounded-xl border border-brand-teal/30 bg-brand-teal/10 p-3.5 text-xs text-foreground">
            <div className="flex items-center gap-1.5 font-semibold text-brand-teal">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Operations Analysis</span>
            </div>
            <p className="mt-1 text-foreground/80 leading-relaxed">{aiExplanation}</p>
          </div>
        ) : null}

        {/* Breaches & Alerts */}
        {cascade.breaches.length > 0 ? (
          <div className="mt-4 space-y-2">
            {cascade.breaches.map((b, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{b.message}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Moves Table */}
        <div className="mt-5">
          <h4 className="label-mono text-xs text-muted-foreground">
            Proposed Step Date Adjustments
          </h4>
          <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-muted/40">
            {cascade.moves.map((move) => (
              <div
                key={move.stepId}
                className="flex items-center justify-between p-3 text-xs"
              >
                <span className="font-medium text-foreground">{move.stepTitle}</span>
                <div className="flex items-center gap-2 font-mono text-muted-foreground">
                  <span className="line-through">
                    {new Date(move.fromDate).toLocaleDateString()}
                  </span>
                  <ArrowRight className="h-3 w-3 text-brand-amber" />
                  <span className="font-bold text-brand-teal">
                    {new Date(move.toDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Editable Client Note */}
        {aiClientNote ? (
          <div className="mt-5">
            <label className="label-mono text-xs text-muted-foreground">
              Client Heads-Up Note (Optional Draft)
            </label>
            <textarea
              rows={3}
              value={clientNoteDraft}
              onChange={(e) => setClientNoteDraft(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border bg-background p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal"
            />
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDismiss}
            disabled={isPending}
            className="rounded-full"
          >
            Dismiss Proposal
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isPending}
            className="rounded-full bg-brand-teal text-slate-950 hover:bg-brand-teal/90"
          >
            {isPending ? "Applying..." : "Apply Revised Schedule"}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
