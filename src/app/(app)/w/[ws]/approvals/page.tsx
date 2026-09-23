import Link from "next/link";
import { listApprovalQueue } from "@/db/queries/schedule";
import { listPendingApprovalGates } from "@/db/queries/sop";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clientColor, CONTENT_TYPE_COLORS } from "@/lib/colors";
import { ApproveForm, DraftLink, ScheduleForm } from "./approval-card";
import { ApprovalsLive } from "./approvals-live";
import { GateDecisionForm } from "./gate-card";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

function formatDue(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default async function ApprovalsPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const [queue, gates] = await Promise.all([
    listApprovalQueue(params.ws),
    listPendingApprovalGates(params.ws),
  ]);
  const inReview = queue.filter((row) => row.status === "review");
  const approved = queue.filter((row) => row.status === "approved");

  return (
    <PageShell width="app">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl">Approvals</h1>
        <ApprovalsLive workspaceId={params.ws} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground/70">
        Compliance-checked drafts waiting on a human: approve, then pick a
        slot on the calendar.
      </p>

      {/* S4 — SOP gates land in the SAME queue as content approvals. A
          second approval inbox is how sign-offs get missed; one place to
          look is the whole point. */}
      <section className="mt-8">
        <p className="label-mono text-brand-teal">Process gates</p>
        {gates.length === 0 ? (
          <GlassCard className="mt-3 p-5">
            <p className="text-sm text-muted-foreground/70">
              No SOP steps waiting on a sign-off.
            </p>
          </GlassCard>
        ) : (
          <div className="mt-3 space-y-3">
            {gates.map((gate) => (
              <GlassCard key={gate.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{gate.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      {gate.clientName ? `${gate.clientName} · ` : ""}
                      <Link
                        href={`/w/${params.ws}/sop/runs/${gate.runId}`}
                        className="text-brand-teal hover:underline"
                      >
                        {gate.runName}
                      </Link>
                      {" · due "}
                      {formatDue(gate.dueAt)}
                    </p>
                    {gate.description ? (
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        {gate.description}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-brand-purple/40 text-brand-purple"
                  >
                    Approval
                  </Badge>
                </div>
                <GateDecisionForm
                  workspaceId={params.ws}
                  runId={gate.runId}
                  stepId={gate.id}
                />
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <p className="label-mono text-brand-purple">In review</p>
        {inReview.length === 0 ? (
          <GlassCard className="mt-3 p-5">
            <p className="text-sm text-muted-foreground/70">
              Nothing in review. Run compliance on a draft in the studio to
              move it here.
            </p>
          </GlassCard>
        ) : (
          <div className="mt-3 space-y-3">
            {inReview.map((row) => (
              <GlassCard key={row.id} className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{row.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                      <span
                        className={cn(
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          clientColor(row.clientId).dot,
                        )}
                      />
                      <span>{row.clientName}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          CONTENT_TYPE_COLORS[row.type].chip,
                        )}
                      >
                        {row.type}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      row.complianceStatus === "passed"
                        ? "border-brand-teal/40 text-brand-teal"
                        : "border-destructive/40 text-destructive"
                    }
                  >
                    compliance {row.complianceStatus}
                  </Badge>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <ApproveForm workspaceId={params.ws} contentId={row.id} />
                  <DraftLink workspaceId={params.ws} contentId={row.id} />
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <p className="label-mono text-brand-teal">Approved — pick a slot</p>
        {approved.length === 0 ? (
          <GlassCard className="mt-3 p-5">
            <p className="text-sm text-muted-foreground/70">Nothing approved yet.</p>
          </GlassCard>
        ) : (
          <div className="mt-3 space-y-3">
            {approved.map((row) => (
              <GlassCard key={row.id} className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{row.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                      <span
                        className={cn(
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          clientColor(row.clientId).dot,
                        )}
                      />
                      <span>{row.clientName}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          CONTENT_TYPE_COLORS[row.type].chip,
                        )}
                      >
                        {row.type}
                      </span>
                    </div>
                  </div>
                  <DraftLink workspaceId={params.ws} contentId={row.id} />
                </div>
                <div className="mt-4">
                  <ScheduleForm workspaceId={params.ws} contentId={row.id} />
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
