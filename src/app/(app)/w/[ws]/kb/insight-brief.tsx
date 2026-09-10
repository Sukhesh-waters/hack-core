"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import { generateInsightBrief, type InsightBriefState } from "./actions";

function GenerateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Reading pattern layer…" : "Generate insight brief"}
    </Button>
  );
}

/** Inspiration-only observations over the top pattern posts. */
export function InsightBrief({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useFormState<InsightBriefState, FormData>(
    generateInsightBrief,
    undefined,
  );

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between">
        <p className="label-mono text-brand-purple">Insight brief</p>
        <Badge
          variant="outline"
          className="border-brand-purple/40 text-brand-purple"
        >
          PATTERN LAYER · INSPIRATION ONLY
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Format and hook observations from the public pattern layer. Never
        cited as evidence for your own baseline — adapt, don&apos;t copy.
      </p>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <GenerateButton />
      </form>
      {state?.error ? (
        <p className="mt-3 text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.observations ? (
        <ul className="mt-4 space-y-3">
          {state.observations.map((obs, index) => (
            <li
              key={index}
              className="rounded-lg border border-border p-3 text-sm"
            >
              <p className="text-foreground">{obs.pattern}</p>
              <p className="mt-1 text-muted-foreground">{obs.suggestion}</p>
              {obs.evidence.length > 0 ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground/50">
                  pattern refs: {obs.evidence.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </GlassCard>
  );
}
