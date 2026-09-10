import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  Timer,
} from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import type { SopTemplateRow } from "@/db/queries/sop";
import type { TemplateMetricsRollup } from "@/lib/sop/metrics";

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TemplateMetricsView({
  workspaceId,
  template,
  metrics,
}: {
  workspaceId: string;
  template: SopTemplateRow;
  metrics: TemplateMetricsRollup;
}) {
  const maxStepHours = Math.max(
    ...(metrics.bottlenecks.map((b) => b.avgDurationHours ?? 0)),
    1,
  );

  return (
    <div className="mt-6 space-y-8">
      {/* 4 KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              Total Runs
            </span>
            <Layers className="h-4 w-4 text-brand-teal" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-3xl">{metrics.totalRuns}</span>
            <span className="text-xs text-muted-foreground">initiated</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground/80">
            <span className="text-foreground font-medium">
              {metrics.activeRunsCount}
            </span>{" "}
            active ·{" "}
            <span className="text-foreground font-medium">
              {metrics.completedRunsCount}
            </span>{" "}
            completed ·{" "}
            <span className="text-muted-foreground">
              {metrics.cancelledRunsCount}
            </span>{" "}
            cancelled
          </p>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              Avg Cycle Time
            </span>
            <Clock className="h-4 w-4 text-brand-purple" />
          </div>
          <div className="mt-2">
            {metrics.hasEnoughData && metrics.avgDurationDays !== null ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl">
                    {metrics.avgDurationDays}
                  </span>
                  <span className="text-sm text-muted-foreground">days</span>
                  <span className="text-xs text-muted-foreground/70">
                    ({metrics.avgDurationHours}h total)
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  Calculated over {metrics.completedRunsCount} completed runs
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="text-lg font-medium">Insufficient data</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="border-amber-400/40 text-amber-300 text-[11px] py-0"
                  >
                    Min-N gate: {metrics.completedRunsCount}/{metrics.minSampleRequired} runs
                  </Badge>
                </div>
              </>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              On-Time Rate
            </span>
            <Timer className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            {metrics.hasEnoughData && metrics.onTimeRate !== null ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl">
                    {metrics.onTimeRate}%
                  </span>
                  <span className="text-xs text-emerald-400 font-medium">
                    on schedule
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  Completed on or before anchor date (+24h grace)
                </p>
              </>
            ) : (
              <>
                <div className="text-lg font-medium text-muted-foreground">—</div>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  Requires ≥ {metrics.minSampleRequired} completed runs to calculate
                </p>
              </>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              Primary Bottleneck
            </span>
            <AlertCircle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2">
            {metrics.slowestStep ? (
              <>
                <p className="font-display text-lg truncate" title={metrics.slowestStep.stepTitle}>
                  {metrics.slowestStep.stepTitle}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Avg {metrics.slowestStep.avgDurationHours}h (
                  {metrics.slowestStep.sampleCount} run
                  {metrics.slowestStep.sampleCount === 1 ? "" : "s"})
                  {metrics.slowestStep.rejectionCount > 0 ? (
                    <span className="text-amber-300 font-medium">
                      {" "}
                      · {metrics.slowestStep.rejectionCount} rejection(s)
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-muted-foreground">
                  None observed
                </div>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  Step turnaround times within expected baseline
                </p>
              </>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Bottleneck Analysis Section */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl">Step Turnaround & Bottleneck Breakdown</h2>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Turnaround duration across all executions of each step relative to
              the template anchor.
            </p>
          </div>
        </div>

        {metrics.bottlenecks.length === 0 ? (
          <GlassCard className="mt-3 p-8 text-center">
            <p className="font-display text-lg">No step execution data yet</p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Once runs are executed and marked done, empirical step durations and
              rejections will be analyzed here.
            </p>
          </GlassCard>
        ) : (
          <GlassCard className="mt-3 divide-y divide-border/40 overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <div className="col-span-5">Step Title</div>
              <div className="col-span-3 text-center">Turnaround (Avg)</div>
              <div className="col-span-2 text-center">Completed Samples</div>
              <div className="col-span-2 text-right">Rejections</div>
            </div>
            {metrics.bottlenecks.map((b, idx) => {
              const pct =
                b.avgDurationHours !== null
                  ? Math.min(100, Math.round((b.avgDurationHours / maxStepHours) * 100))
                  : 0;

              return (
                <div
                  key={b.templateStepId ?? `${b.stepTitle}-${idx}`}
                  className="grid grid-cols-12 items-center px-5 py-3.5 hover:bg-accent/40 transition-colors"
                >
                  <div className="col-span-5 min-w-0 pr-4">
                    <p className="font-medium text-sm truncate">{b.stepTitle}</p>
                    {b.avgDurationHours !== null ? (
                      <div className="mt-1.5 h-1.5 w-full max-w-xs rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            idx === 0
                              ? "bg-amber-400"
                              : "bg-brand-teal"
                          }`}
                          style={{ width: `${Math.max(5, pct)}%` }}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="col-span-3 text-center text-sm">
                    {b.avgDurationHours !== null ? (
                      <div>
                        <span className="font-mono font-medium">
                          {b.avgDurationHours}h
                        </span>
                        {b.avgDurationDays && b.avgDurationDays >= 1 ? (
                          <span className="text-xs text-muted-foreground/70 ml-1">
                            ({b.avgDurationDays}d)
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </div>

                  <div className="col-span-2 text-center text-sm font-mono text-muted-foreground">
                    {b.sampleCount}
                  </div>

                  <div className="col-span-2 text-right">
                    {b.rejectionCount > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-amber-400/40 text-amber-300 font-mono text-xs"
                      >
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {b.rejectionCount}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">0</span>
                    )}
                  </div>
                </div>
              );
            })}
          </GlassCard>
        )}
      </div>

      {/* Run History List */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl">Execution History</h2>
            <p className="mt-1 text-sm text-muted-foreground/70">
              All runs spawned from &ldquo;{template.name}&rdquo;.
            </p>
          </div>
        </div>

        {metrics.runs.length === 0 ? (
          <GlassCard className="mt-3 p-8 text-center">
            <p className="font-display text-lg">No runs launched yet</p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Launch a run from the main SOP page to track live execution and metrics.
            </p>
          </GlassCard>
        ) : (
          <div className="mt-3 space-y-3">
            {metrics.runs.map((run) => {
              const statusVariant =
                run.status === "completed"
                  ? "border-emerald-500/40 text-emerald-400"
                  : run.status === "active"
                    ? "border-brand-teal/40 text-brand-teal"
                    : "border-border text-muted-foreground";

              return (
                <Link
                  key={run.runId}
                  href={`/w/${workspaceId}/sop/runs/${run.runId}`}
                  className="block group"
                >
                  <GlassCard className="p-5 transition-colors hover:bg-accent">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-display text-lg group-hover:text-brand-teal transition-colors">
                            {run.runName}
                          </p>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground/70">
                          {run.clientName ? `${run.clientName} · ` : ""}
                          Started {formatDate(run.createdAt)}
                          {run.startedByName ? ` by ${run.startedByName}` : ""}
                          {" · "}Anchored to {formatDate(run.anchorDate)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {/* Progress */}
                        <span className="text-xs text-muted-foreground font-mono">
                          {run.completedSteps}/{run.totalSteps} steps
                        </span>

                        {/* Status */}
                        <Badge variant="outline" className={statusVariant}>
                          {run.status}
                        </Badge>

                        {/* Duration */}
                        {run.durationDays !== null ? (
                          <Badge
                            variant="outline"
                            className="border-border text-foreground font-mono"
                          >
                            {run.durationDays}d
                          </Badge>
                        ) : null}

                        {/* On-Time indicator */}
                        {run.isOnTime === true ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-400"
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            On Time
                          </Badge>
                        ) : run.isOnTime === false ? (
                          <Badge
                            variant="outline"
                            className="border-amber-400/40 text-amber-300"
                          >
                            <Clock className="mr-1 h-3 w-3" />
                            Delayed
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
