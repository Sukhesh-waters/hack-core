"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/glass-card";

/**
 * "Reject — give a reason" card shell shared by IdeaCard (ideation) and
 * PlanCard (plan & validate) — same copy, same layout, same Cancel control
 * in both places.
 *
 * Only the shell is shared. The two callers submit differently — IdeaCard
 * drives a manual startTransition + server-action call and shows its own
 * "Rejecting…" busy label; PlanCard uses a real `<form action={...}>` with
 * useFormState/useFormStatus for progressive enhancement. Rather than force
 * one submission mechanism on both (a bigger change than this duplication
 * warrants), the confirm control is a `children` slot each caller fills with
 * whatever it already uses.
 */
export function RejectReasonPanel({
  reason,
  onReasonChange,
  error,
  onCancel,
  cancelDisabled,
  children,
}: {
  reason: string;
  onReasonChange: (value: string) => void;
  error?: string | null;
  onCancel: () => void;
  /** Disables Cancel while the caller's own submit is in flight. */
  cancelDisabled?: boolean;
  /** The confirm control — caller-owned submit mechanism. */
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="space-y-3 p-5">
      <p className="label-mono text-muted-foreground/70">Reject — give a reason</p>
      <Textarea
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="Why doesn't this idea fit?"
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={cancelDisabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
        {children}
      </div>
    </GlassCard>
  );
}
