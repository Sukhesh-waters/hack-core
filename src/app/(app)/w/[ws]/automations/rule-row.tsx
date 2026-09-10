"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";
import { cn } from "@/lib/utils";
import { describeAction, describeTrigger } from "@/lib/automation";
import type { AutomationAction, AutomationTrigger } from "@/db/schema";
import {
  deleteAutomationRuleAction,
  toggleAutomationRuleAction,
  type AutomationRuleState,
} from "./actions";

export type RunStatusView = {
  status: "queued" | "running" | "done" | "failed";
  matched: number;
  acted: number;
  createdAt: Date;
  error: string | null;
};

export type RuleRowView = {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  cadence: "hourly" | "daily";
  enabled: boolean;
  lastRunAt: Date | null;
  recentRuns: RunStatusView[];
};

// Static Tailwind class map — no template-built classes (JIT scan
// requirement, same idiom as ticket-card.tsx's PRIORITY_COLORS).
const RUN_STATUS_COLORS: Record<RunStatusView["status"], string> = {
  queued: "bg-accent text-muted-foreground/70",
  running: "bg-brand-teal/15 text-brand-teal",
  done: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
};

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] transition",
        enabled
          ? "bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
          : "bg-accent text-muted-foreground/70 hover:bg-accent",
      )}
    >
      {pending ? "…" : enabled ? "Enabled" : "Disabled"}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-muted-foreground/50 hover:text-destructive"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

export function RuleRow({
  workspaceId,
  rule,
}: {
  workspaceId: string;
  rule: RuleRowView;
}) {
  const [toggleState, toggleAction] = useFormState<
    AutomationRuleState,
    FormData
  >(toggleAutomationRuleAction, undefined);
  const [deleteState, deleteFormAction] = useFormState<
    AutomationRuleState,
    FormData
  >(deleteAutomationRuleAction, undefined);

  return (
    <GlassCard className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-foreground">{rule.name}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {describeTrigger(rule.trigger)} → {describeAction(rule.action)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/50">
            <span className="rounded bg-accent px-1.5 py-0.5">
              {rule.cadence}
            </span>
            <span>
              last run{" "}
              {rule.lastRunAt ? rule.lastRunAt.toLocaleString() : "never"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <form action={toggleAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="ruleId" value={rule.id} />
            <input
              type="hidden"
              name="enabled"
              value={(!rule.enabled).toString()}
            />
            <ToggleButton enabled={rule.enabled} />
          </form>
          <form action={deleteFormAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="ruleId" value={rule.id} />
            <DeleteButton />
          </form>
        </div>
      </div>

      {rule.recentRuns.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {rule.recentRuns.map((run, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "border-transparent text-[10px]",
                  RUN_STATUS_COLORS[run.status],
                )}
                title={run.createdAt.toLocaleString()}
              >
                {run.status} · {run.matched}/{run.acted}
              </Badge>
              {run.status === "failed" ? (
                <span className="font-mono text-[10px] text-destructive/80">
                  {(run.error ?? "failed").slice(0, 40)}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/50">No runs yet.</p>
      )}

      {toggleState?.error ? (
        <p className="text-xs text-destructive">{toggleState.error}</p>
      ) : null}
      {deleteState?.error ? (
        <p className="text-xs text-destructive">{deleteState.error}</p>
      ) : null}
    </GlassCard>
  );
}
