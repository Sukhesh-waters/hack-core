"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import {
  DECISION_OUTCOME_CHIP,
  DECISION_OUTCOME_LABELS,
  isDueForReview,
  type DecisionOutcome,
} from "@/lib/decisions";
import { recordDecisionOutcomeAction } from "./actions";

export type DecisionView = {
  id: string;
  title: string;
  reason: string;
  expectedOutcome: string;
  reviewAt: Date;
  outcome: DecisionOutcome;
  outcomeNote: string | null;
  clientName: string | null;
  goalTitle: string | null;
  evidenceCaptions: string[];
  insight: { pattern: string; suggestion: string } | null;
};

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DecisionCard({
  workspaceId,
  decision,
}: {
  workspaceId: string;
  decision: DecisionView;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [outcomeChoice, setOutcomeChoice] = useState<
    Exclude<DecisionOutcome, "pending"> | ""
  >("");
  const [note, setNote] = useState("");

  const due =
    decision.outcome === "pending" &&
    isDueForReview({ reviewAt: decision.reviewAt, outcome: decision.outcome }, new Date());

  function handleSubmitOutcome() {
    if (!outcomeChoice) {
      setError("Pick an outcome first.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("decisionId", decision.id);
    formData.set("outcome", outcomeChoice);
    formData.set("outcomeNote", note);
    startTransition(async () => {
      const result = await recordDecisionOutcomeAction(undefined, formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-lg">{decision.title}</p>
        <Badge
          variant="outline"
          className={`shrink-0 text-[11px] ${DECISION_OUTCOME_CHIP[decision.outcome]}`}
        >
          {DECISION_OUTCOME_LABELS[decision.outcome]}
        </Badge>
      </div>

      <p className="mt-2 text-xs text-muted-foreground/70">
        {decision.clientName ?? "Workspace-level"}
        {decision.goalTitle ? ` · Goal: ${decision.goalTitle}` : ""}
        {" · Review "}
        {formatDate(decision.reviewAt)}
      </p>

      <p className="mt-3 text-sm text-muted-foreground">{decision.reason}</p>
      <p className="mt-2 text-xs text-muted-foreground/70">
        <span className="font-medium text-muted-foreground">Expected: </span>
        {decision.expectedOutcome}
      </p>

      {decision.evidenceCaptions.length > 0 ? (
        <div className="mt-3 rounded-lg border border-brand-teal/20 bg-brand-teal/5 p-3">
          <p className="label-mono text-brand-teal">First-party evidence</p>
          <ul className="mt-1 space-y-1">
            {decision.evidenceCaptions.map((caption, i) => (
              <li key={i} className="truncate text-xs text-muted-foreground/70">
                ↳ {caption}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* I2 as a UI requirement: the cited insight renders in its own
          block, visually separate from first-party evidence above, and
          is labelled inspiration — never merged into one "why" list. */}
      {decision.insight ? (
        <div className="mt-3 rounded-lg border border-brand-purple/20 bg-brand-purple/5 p-3">
          <p className="label-mono text-brand-purple">
            Pattern insight · inspiration only
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{decision.insight.pattern}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {decision.insight.suggestion}
          </p>
        </div>
      ) : null}

      {decision.outcome !== "pending" ? (
        decision.outcomeNote ? (
          <p className="mt-3 text-xs text-muted-foreground/70">
            <span className="font-medium text-muted-foreground">Outcome note: </span>
            {decision.outcomeNote}
          </p>
        ) : null
      ) : due ? (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <p className="text-xs text-amber-300">Due for review</p>
          <div className="flex flex-wrap items-center gap-2">
            {(["worked", "did_not_work", "inconclusive"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOutcomeChoice(o)}
                className={`rounded border px-2 py-1 text-xs ${
                  outcomeChoice === o
                    ? DECISION_OUTCOME_CHIP[o]
                    : "border-border text-muted-foreground/70"
                }`}
              >
                {DECISION_OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded border border-border bg-muted px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50"
          />
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={handleSubmitOutcome}
          >
            {pending ? "Saving…" : "Record outcome"}
          </Button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
