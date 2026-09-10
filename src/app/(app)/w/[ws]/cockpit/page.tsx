import Link from "next/link";
import {
  getCycleTimeByState,
  getOverdueLoad,
  getOwnerLoad,
  getWipVsLimit,
} from "@/db/queries/metrics";
import {
  listPendingApprovalGates,
  listSopRuns,
  sopRunProgress,
} from "@/db/queries/sop";
import {
  getWorkspaceSpendSince,
  listRecentUsage,
  listSpendByProvider,
} from "@/db/queries/usage";
import { aiDailyCapUsd, dayStart } from "@/lib/ai/budget";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";
import { CockpitLive } from "./cockpit-live";
import { resolved } from "./settle";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Cockpit" };
export const dynamic = "force-dynamic";

function usd(value: number) {
  return `$${value.toFixed(value < 0.1 ? 4 : 2)}`;
}

export default async function CockpitPage({
  params,
}: {
  params: { ws: string };
}) {
  const ws = params.ws;
  const now = new Date();
  const today = dayStart(now);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cap = aiDailyCapUsd();

  const results = await Promise.allSettled([
    getWorkspaceSpendSince(ws, today),
    listSpendByProvider(ws, weekAgo),
    listRecentUsage(ws, 12),
    listSopRuns(ws),
    sopRunProgress(ws),
    listPendingApprovalGates(ws),
    getWipVsLimit(ws),
    getOverdueLoad(ws),
    getOwnerLoad(ws),
    getCycleTimeByState(ws),
  ]);

  const failedSections: string[] = [];
  const todaySpend = resolved(results[0], { costUsd: 0, calls: 0 }, "AI spend today", failedSections);
  const weekByProvider = resolved(results[1], [], "AI spend by provider", failedSections);
  const recent = resolved(results[2], [], "Recent AI calls", failedSections);
  const runs = resolved(results[3], [], "SOP runs", failedSections);
  const progressMap = resolved(results[4], new Map(), "SOP run progress", failedSections);
  const pendingGates = resolved(results[5], [], "Pending approval gates", failedSections);
  const wipStates = resolved(results[6], [], "WIP limits", failedSections);
  const overdueSteps = resolved(results[7], [], "Overdue steps", failedSections);
  const ownerLoads = resolved(results[8], [], "Owner workload", failedSections);
  const cycleTimes = resolved(results[9], [], "Cycle time", failedSections);

  const activeRuns = runs.filter((r) => r.status === "active");
  const totalOverdueSopSteps = Array.from(progressMap.values()).reduce(
    (acc, curr) => acc + curr.overdue,
    0,
  );
  const wipBreaches = wipStates.filter((s) => s.isOverLimit);

  const capUsed = Math.min(100, Math.round((todaySpend.costUsd / cap) * 100));
  const overCap = todaySpend.costUsd >= cap;
  const weekTotal = weekByProvider.reduce((sum, p) => sum + p.costUsd, 0);

  return (
    <PageShell width="wide">
      <div>
        <div className="flex items-center gap-3">
          <p className="label-mono text-brand-amber">Cockpit · Live Command Centre</p>
          <CockpitLive workspaceId={ws} />
        </div>
        <h1 className="mt-2 font-display text-4xl">Workspace Command Centre</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground/70">
        Real-time operational health, SOP run progress, workload balance, and AI telemetry in one place.
      </p>

      {failedSections.length > 0 ? (
        <GlassCard className="mt-4 border-amber-400/40 p-4">
          <p className="text-sm text-amber-300">
            {failedSections.length} section{failedSections.length > 1 ? "s" : ""}{" "}
            failed to load and {failedSections.length > 1 ? "are" : "is"} showing
            as empty: {failedSections.join(", ")}. Reload to retry.
          </p>
        </GlassCard>
      ) : null}

      {/* Operational Summary Grid */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href={`/w/${ws}/sop`} className="block">
          <GlassCard className="p-5 transition hover:border-brand-teal/40">
            <p className="label-mono text-muted-foreground/70">Active SOP Runs</p>
            <p className="mt-2 font-display text-3xl text-brand-teal">
              {activeRuns.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {runs.length - activeRuns.length} completed
            </p>
          </GlassCard>
        </Link>

        <Link href={`/w/${ws}/sop`} className="block">
          <GlassCard className="p-5 transition hover:border-amber-400/40">
            <p className="label-mono text-muted-foreground/70">Overdue SOP Steps</p>
            <p
              className={`mt-2 font-display text-3xl ${
                totalOverdueSopSteps > 0 ? "text-amber-300" : "text-foreground"
              }`}
            >
              {totalOverdueSopSteps}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              across {overdueSteps.length} open steps
            </p>
          </GlassCard>
        </Link>

        <Link href={`/w/${ws}/production`} className="block">
          <GlassCard className="p-5 transition hover:border-destructive/40">
            <p className="label-mono text-muted-foreground/70">WIP Breaches</p>
            <p
              className={`mt-2 font-display text-3xl ${
                wipBreaches.length > 0 ? "text-destructive" : "text-emerald-300"
              }`}
            >
              {wipBreaches.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {wipBreaches.length > 0
                ? `${wipBreaches.map((b) => b.stateName).join(", ")} over limit`
                : "All stages within limits"}
            </p>
          </GlassCard>
        </Link>

        <Link href={`/w/${ws}/approvals`} className="block">
          <GlassCard className="p-5 transition hover:border-sky-400/40">
            <p className="label-mono text-muted-foreground/70">Pending Gates</p>
            <p className="mt-2 font-display text-3xl text-sky-300">
              {pendingGates.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              process gates awaiting approval
            </p>
          </GlassCard>
        </Link>
      </div>

      {/* Active Runs & Progress */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <p className="label-mono text-muted-foreground/70">Active SOP Runs</p>
            <Link
              href={`/w/${ws}/sop`}
              className="text-xs text-brand-teal hover:underline"
            >
              View all →
            </Link>
          </div>
          {activeRuns.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground/70">
              No active SOP runs. Start a run from your template list to execute a process.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {activeRuns.map((run) => {
                const prog = progressMap.get(run.id) ?? {
                  total: 0,
                  closed: 0,
                  overdue: 0,
                };
                const pct =
                  prog.total > 0 ? Math.round((prog.closed / prog.total) * 100) : 0;
                return (
                  <Link
                    key={run.id}
                    href={`/w/${ws}/sop/runs/${run.id}`}
                    className="block rounded border border-border bg-muted p-4 transition hover:border-brand-teal/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">
                        {run.name}
                      </span>
                      {run.clientName ? (
                        <Badge
                          variant="outline"
                          className="border-border text-muted-foreground shrink-0"
                        >
                          {run.clientName}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground/70">
                      <span>
                        {prog.closed} of {prog.total} steps closed ({pct}%)
                      </span>
                      {prog.overdue > 0 ? (
                        <span className="text-amber-300 font-medium">
                          {prog.overdue} overdue
                        </span>
                      ) : (
                        <span className="text-emerald-300">On schedule</span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent">
                      <div
                        className="h-full bg-brand-teal transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* WIP Limits & Workflow Health */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <p className="label-mono text-muted-foreground/70">Workflow WIP Limits</p>
            <Link
              href={`/w/${ws}/production`}
              className="text-xs text-brand-teal hover:underline"
            >
              Production Board →
            </Link>
          </div>
          {wipStates.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground/70">
              No workflow states defined yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {wipStates.map((st) => (
                <div
                  key={st.stateId}
                  className="flex items-center justify-between rounded border border-border bg-muted p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: st.colorKey || "#10b981" }}
                    />
                    <span className="font-medium text-foreground">{st.stateName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {st.currentCount} {st.wipLimit !== null ? `/ ${st.wipLimit} limit` : "items"}
                    </span>
                    {st.isOverLimit ? (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        WIP Breach
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-400/40 text-emerald-300">
                        OK
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Overdue Steps & Per-Owner Workload */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Overdue Steps */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <p className="label-mono text-muted-foreground/70">Overdue Run Steps</p>
            <Link
              href={`/w/${ws}/sop`}
              className="text-xs text-brand-teal hover:underline"
            >
              SOP Runs →
            </Link>
          </div>
          {overdueSteps.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground/70">
              No overdue steps! All active run steps are on target.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {overdueSteps.map((step) => (
                <Link
                  key={step.stepId}
                  href={`/w/${ws}/sop/runs/${step.runId}`}
                  className="flex items-center justify-between rounded border border-amber-500/20 bg-amber-500/5 p-3 text-sm transition hover:border-amber-400/40"
                >
                  <div className="truncate pr-2">
                    <p className="font-medium text-foreground truncate">{step.stepTitle}</p>
                    <p className="text-xs text-muted-foreground/70 truncate">
                      {step.runName} · Owner: {step.assigneeName ?? "Unassigned"}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-amber-300">
                    Due {new Date(step.dueAt).toLocaleDateString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Per-Owner Workload */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <p className="label-mono text-muted-foreground/70">Team Member Workload</p>
            <span className="text-xs text-muted-foreground/70">{ownerLoads.length} members</span>
          </div>
          {ownerLoads.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground/70">No team members found.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {ownerLoads.map((owner) => (
                <div
                  key={owner.userId}
                  className="flex items-center justify-between rounded border border-border bg-muted p-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {owner.userName ?? owner.userEmail}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      {owner.openStepCount} SOP steps · {owner.openTicketCount} tickets · {owner.openContentCount} content
                    </p>
                  </div>
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {owner.totalLoad} active items
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Cycle Time Metrics */}
      <GlassCard className="mt-8 p-6">
        <p className="label-mono text-muted-foreground/70">State Cycle Time (Avg Hours)</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Measures average duration content stays in each state. Min-N gate requires at least 5 sample transitions before rendering averages.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cycleTimes.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground/70">
              No transition data recorded yet.
            </p>
          ) : (
            cycleTimes.map((ct) => (
              <div
                key={ct.stateKey}
                className="rounded border border-border bg-muted p-4 text-center"
              >
                <p className="label-mono text-muted-foreground/70 truncate">{ct.stateKey}</p>
                {ct.hasEnoughData ? (
                  <>
                    <p className="mt-2 font-display text-2xl text-brand-teal">
                      {ct.avgHours}h
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      {ct.sampleCount} samples
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-amber-300/80">
                      Insufficient data
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      ({ct.sampleCount} / 5 samples)
                    </p>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </GlassCard>

      {/* AI Telemetry & Spend Section */}
      <div className="mt-12">
        <p className="label-mono text-brand-amber">AI Telemetry & Spend</p>
        <h2 className="mt-2 font-display text-2xl">What the AI is costing</h2>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Token counts and costs routed through the AI model router.
        </p>

        {overCap ? (
          <GlassCard className="mt-4 border-brand-amber/40 p-4">
            <p className="text-sm text-brand-amber">
              Daily AI budget reached — AI actions are paused until the day
              resets (UTC). Raise AI_DAILY_COST_CAP_USD to lift the cap.
            </p>
          </GlassCard>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <GlassCard className="p-5">
            <p className="label-mono text-muted-foreground/70">Spend today</p>
            <p className="mt-2 font-display text-3xl">
              {usd(todaySpend.costUsd)}
            </p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="label-mono text-muted-foreground/70">Calls today</p>
            <p className="mt-2 font-display text-3xl">{todaySpend.calls}</p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="label-mono text-muted-foreground/70">Spend · 7 days</p>
            <p className="mt-2 font-display text-3xl">{usd(weekTotal)}</p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="label-mono text-muted-foreground/70">Daily cap</p>
            <p className="mt-2 font-display text-3xl">{usd(cap)}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-accent">
              <div
                className={
                  overCap ? "h-full bg-brand-amber" : "h-full bg-brand-teal"
                }
                style={{ width: `${capUsed}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground/70">
              {capUsed}% used
            </p>
          </GlassCard>
        </div>

        <GlassCard className="mt-6 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground/70">
                <th className="p-4 font-normal">Provider · 7 days</th>
                <th className="p-4 font-normal">Calls</th>
                <th className="p-4 font-normal">Tokens in</th>
                <th className="p-4 font-normal">Tokens out</th>
                <th className="p-4 font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {weekByProvider.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground/70">
                    No AI calls logged yet — run ideation or a compliance check
                    and spend appears here.
                  </td>
                </tr>
              ) : (
                weekByProvider.map((row) => (
                  <tr key={row.provider} className="border-b border-border">
                    <td className="p-4 text-foreground">{row.provider}</td>
                    <td className="p-4 font-mono text-muted-foreground">{row.calls}</td>
                    <td className="p-4 font-mono text-muted-foreground">
                      {row.tokensIn.toLocaleString()}
                    </td>
                    <td className="p-4 font-mono text-muted-foreground">
                      {row.tokensOut.toLocaleString()}
                    </td>
                    <td className="p-4 font-mono text-muted-foreground">
                      {usd(row.costUsd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </GlassCard>

        <GlassCard className="mt-6 p-6">
          <p className="label-mono text-muted-foreground/70">Recent AI calls</p>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground/70">Nothing yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recent.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {row.purpose ?? row.kind} · {row.model}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-border text-muted-foreground/70"
                    >
                      {row.provider}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground/70">
                      {usd(row.costUsd)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </div>
    </PageShell>
  );
}
