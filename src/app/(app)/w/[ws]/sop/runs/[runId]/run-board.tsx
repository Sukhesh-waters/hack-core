"use client";

import { useEffect, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import type { SopRunRow, SopRunStepRow } from "@/db/queries/sop";
import { SOP_CREATES_META, SOP_GATE_META } from "@/lib/sop/template";
import { daysLate, runRisk } from "@/lib/sop/risk";
import { validateRun } from "@/lib/sop/validate";
import { useWorkspaceRealtime } from "@/app/(app)/w/[ws]/use-workspace-realtime";

import {
  assignStepAction,
  bulkAssignReadyStepsToSelfAction,
  cancelRunAction,
  completeStepAction,
  materialiseStepAction,
  reanchorRunAction,
  rescheduleDownstreamAction,
  skipStepAction,
  startStepAction,
  suggestNextActionAction,
  type SopActionState,
  type SuggestionActionState,
} from "../../actions";
import { createCascadeProposalAction } from "./cascade-actions";
import { CascadeProposalDrawer } from "./cascade-proposal-drawer";
import type { CascadeResult } from "@/lib/sop/cascade";
import { AlertCircle, CalendarDays, GitPullRequest, History, Loader2 } from "lucide-react";

export type SerializedSopRunActivity = {
  id: string;
  subjectType: string;
  subjectId: string;
  actorId: string | null;
  actorName: string | null;
  verb: string;
  meta: Record<string, unknown> | null;
  createdAtIso: string;
};

export type MemberOption = { userId: string; label: string };

/** Static, fully-written class strings — Tailwind's JIT scans source text. */
const STATUS_CHIP: Record<SopRunStepRow["status"], string> = {
  blocked: "border-border text-muted-foreground/70",
  ready: "border-brand-teal/40 text-brand-teal",
  in_progress: "border-sky-400/40 text-sky-300",
  done: "border-emerald-400/40 text-emerald-300",
  skipped: "border-border text-muted-foreground/50",
};

const STATUS_LABEL: Record<SopRunStepRow["status"], string> = {
  blocked: "Blocked",
  ready: "Ready",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
};

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Overdue is no longer computed here: runRisk owns "late" and "at risk"
// together, so the board and the reschedule action can never disagree about
// which steps have actually slipped.

function PendingButton({
  label,
  pending: pendingLabel,
  variant = "default",
}: {
  label: string;
  pending: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function RunBoard({
  workspaceId,
  viewerId,
  run,
  steps,
  members,
  activities = [],
}: {
  workspaceId: string;
  viewerId: string;
  run: SopRunRow;
  steps: SopRunStepRow[];
  members: MemberOption[];
  activities?: SerializedSopRunActivity[];
}) {
  const router = useRouter();
  const [showReanchor, setShowReanchor] = useState(false);
  const [reanchorState, reanchorAction] = useActionState<
    SopActionState,
    FormData
  >(reanchorRunAction, undefined);

  useEffect(() => {
    if (reanchorState && "savedAt" in reanchorState) {
      setShowReanchor(false);
    }
  }, [reanchorState]);

  useWorkspaceRealtime({
    workspaceId,
    userId: viewerId,
    scopes: ["sop"],
    onSignal: () => router.refresh(),
  });

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [router]);

  const labelById = new Map(members.map((m) => [m.userId, m.label]));

  const claimableCount = steps.filter(
    (s) => s.status === "ready" && s.assigneeId === null,
  ).length;
  const [bulkAssignPending, setBulkAssignPending] = useState(false);
  const [bulkAssignError, setBulkAssignError] = useState<string | null>(null);

  async function claimReadySteps() {
    setBulkAssignPending(true);
    setBulkAssignError(null);
    const result = await bulkAssignReadyStepsToSelfAction(workspaceId, run.id);
    setBulkAssignPending(false);
    if (result.error) {
      setBulkAssignError(result.error);
      return;
    }
    router.refresh();
  }

  const closed = steps.filter(
    (s) => s.status === "done" || s.status === "skipped",
  ).length;

  // One pass for the whole run: which steps are late, and which are not
  // late yet but wait on something that is.
  const now = new Date();
  const risk = runRisk(
    steps.map((s) => ({
      id: s.id,
      status: s.status,
      dueAt: s.dueAt,
      dependsOn: s.dependsOn,
    })),
    now,
  );
  const overdueIds = new Set(risk.overdue);
  const atRiskIds = new Set(risk.atRisk);
  const overdue = risk.overdue.length;
  const findings = validateRun({ run, steps, now });

  const [activeProposal, setActiveProposal] = useState<{
    proposalId: string;
    cascade: CascadeResult;
  } | null>(null);
  const [isProposingCascade, setIsProposingCascade] = useState<string | null>(null);

  const handleTriggerCascade = async (stepId: string) => {
    setIsProposingCascade(stepId);
    const slipDate = new Date();
    slipDate.setDate(slipDate.getDate() + 2);

    const res = await createCascadeProposalAction({
      workspaceId,
      runId: run.id,
      slippedStepId: stepId,
      actualCompletionDate: slipDate,
    });

    setIsProposingCascade(null);
    if (res.ok) {
      setActiveProposal({
        proposalId: res.proposalId,
        cascade: res.cascade,
      });
    }
  };

  return (
    <div>
      {activeProposal && (
        <CascadeProposalDrawer
          workspaceId={workspaceId}
          runId={run.id}
          proposalId={activeProposal.proposalId}
          cascade={activeProposal.cascade}
          aiExplanation={`Schedule slip detected. Downstream dates shifted by ${activeProposal.cascade.slipDays} days.`}
          onClose={() => setActiveProposal(null)}
        />
      )}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <p className="label-mono text-brand-teal">SOP run</p>
          <h1 className="mt-2 font-display text-4xl">{run.name}</h1>
        </div>
        {run.status === "active" && (
          <div className="flex items-center gap-2">
            {claimableCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkAssignPending}
                onClick={claimReadySteps}
                className="border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10 text-xs"
              >
                {bulkAssignPending
                  ? "Claiming…"
                  : `Claim ${claimableCount} unassigned step${claimableCount === 1 ? "" : "s"}`}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowReanchor((v) => !v)}
              className="border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10 text-xs flex items-center gap-1.5"
            >
              <CalendarDays className="size-3.5" />
              <span>{showReanchor ? "Hide Re-anchor" : "Re-anchor Run"}</span>
            </Button>

            <form
              action={async () => {
                if (
                  window.confirm(
                    "Are you sure you want to cancel this SOP run? All remaining steps will be marked as skipped.",
                  )
                ) {
                  await cancelRunAction(workspaceId, run.id);
                  router.refresh();
                }
              }}
            >
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs"
              >
                Cancel run
              </Button>
            </form>
          </div>
        )}
        {run.status === "cancelled" && (
          <Badge
            variant="outline"
            className="border-destructive/40 text-destructive uppercase tracking-wider"
          >
            Cancelled
          </Badge>
        )}
      </div>

      {bulkAssignError && (
        <p className="mt-2 text-xs text-destructive">{bulkAssignError}</p>
      )}

      {showReanchor && run.status === "active" && (
        <GlassCard className="mt-4 border-brand-teal/30 p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-brand-teal" />
              <p className="label-mono font-semibold text-foreground">Re-anchor Run Timeline</p>
            </div>
            <button
              type="button"
              onClick={() => setShowReanchor(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕ Close
            </button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Current anchor date: <span className="font-semibold text-foreground">{formatDate(run.anchorDate)}</span>.
            Selecting a new anchor date shifts all <span className="font-semibold text-foreground">{steps.length - closed} open steps</span> by the calculated delta.
            Historical completed steps will not be moved.
          </p>

          <form action={reanchorAction} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="runId" value={run.id} />

            <div>
              <label htmlFor="reanchor-date" className="block text-xs font-medium text-muted-foreground">
                New Anchor Date
              </label>
              <input
                id="reanchor-date"
                type="date"
                name="anchorDate"
                defaultValue={new Date(run.anchorDate).toISOString().slice(0, 10)}
                required
                className="mt-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal"
              />
            </div>

            <PendingButton label="Shift Timeline & Save" pending="Shifting…" />
          </form>

          {reanchorState?.error ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {reanchorState.error}
            </p>
          ) : null}
        </GlassCard>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground/70">
        {run.clientName ? <span>{run.clientName}</span> : null}
        {run.clientName ? <span aria-hidden="true">·</span> : null}
        <span>
          Anchored to {formatDate(run.anchorDate)}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {closed} of {steps.length} closed
        </span>
        {overdue > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-amber-300">{overdue} overdue</span>
          </>
        ) : null}
        {risk.atRisk.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-amber-300/70">
              {risk.atRisk.length} at risk
            </span>
          </>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted-foreground/60 italic">
        This run creates and tracks work in your normal pipeline — it never replaces it.
      </p>

      {findings.length > 0 ? (
        <GlassCard className="mt-6 border-amber-500/30 p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-amber-300">Pre-flight checks · {findings.length} findings</p>
          </div>
          <div className="mt-3 space-y-2">
            {findings.map((f, idx) => (
              <div
                key={idx}
                className="rounded border border-border bg-muted p-3 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      f.severity === "error"
                        ? "border-destructive/40 text-destructive"
                        : "border-amber-400/40 text-amber-300"
                    }
                  >
                    {f.severity}
                  </Badge>
                  <span className="font-semibold text-foreground">
                    {f.stepTitle ? f.stepTitle : "Run setup"}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{f.message}</p>
                <p className="mt-1 text-muted-foreground/70">
                  <span className="text-brand-teal font-medium">Fix: </span>
                  {f.fix}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}

      <div className="mt-6 space-y-3">
        {steps.map((step) => {
          // Only steps that are actually still holding this one up — a
          // dependency that's already closed is not a reason to wait.
          const openBlockers = step.dependsOn
            .map((id) => steps.find((s) => s.id === id))
            .filter(
              (s): s is SopRunStepRow =>
                Boolean(s) && s!.status !== "done" && s!.status !== "skipped",
            );

          const owner = step.assigneeId
            ? (labelById.get(step.assigneeId) ?? "Unknown member")
            : step.assigneeRole
              ? `Needs ${step.assigneeRole === "admin" ? "an" : "a"} ${step.assigneeRole}`
              : "Unassigned";

          return (
            <StepCard
              key={step.id}
              workspaceId={workspaceId}
              viewerId={viewerId}
              runId={run.id}
              step={step}
              owner={owner}
              openBlockers={openBlockers}
              members={members}
              overdue={overdueIds.has(step.id)}
              atRisk={atRiskIds.has(step.id)}
              lateBy={daysLate(step.dueAt, now)}
              isProposingCascade={isProposingCascade}
              onTriggerCascade={handleTriggerCascade}
            />
          );
        })}
      </div>

      <RunActivityTimeline activities={activities} steps={steps} />
    </div>
  );
}

function StepCard({
  workspaceId,
  viewerId,
  runId,
  step,
  owner,
  openBlockers,
  members,
  overdue,
  atRisk,
  lateBy,
  isProposingCascade,
  onTriggerCascade,
}: {
  workspaceId: string;
  viewerId: string;
  runId: string;
  step: SopRunStepRow;
  owner: string;
  openBlockers: SopRunStepRow[];
  members: MemberOption[];
  overdue: boolean;
  atRisk: boolean;
  lateBy: number;
  isProposingCascade: string | null;
  onTriggerCascade: (stepId: string) => Promise<void>;
}) {
  const [moveState, moveAction] = useActionState<SopActionState, FormData>(
    step.status === "ready" ? startStepAction : completeStepAction,
    undefined,
  );
  const [skipState, skipAction] = useActionState<SopActionState, FormData>(
    skipStepAction,
    undefined,
  );
  const [assignState, assignAction] = useActionState<SopActionState, FormData>(
    assignStepAction,
    undefined,
  );
  const [materialiseState, materialiseAction] = useActionState<
    SopActionState,
    FormData
  >(materialiseStepAction, undefined);
  const [rescheduleState, rescheduleAction] = useActionState<
    SopActionState,
    FormData
  >(rescheduleDownstreamAction, undefined);
  const [suggestState, suggestAction] = useActionState<
    SuggestionActionState,
    FormData
  >(suggestNextActionAction, {});

  const open = step.status !== "done" && step.status !== "skipped";
  const hidden = (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="stepId" value={step.id} />
    </>
  );

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg">{step.title}</p>
                  {step.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
                    <span
                      className={overdue ? "text-amber-300" : "text-muted-foreground/70"}
                    >
                      Due {formatDate(step.dueAt)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        step.assigneeId ? "text-muted-foreground/70" : "text-amber-300/80"
                      }
                    >
                      {owner}
                    </span>
                    {step.creates !== "none" ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          Creates {SOP_CREATES_META[step.creates].label}
                        </span>
                      </>
                    ) : null}
                    {step.linkedId ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <Link
                          href={
                            step.creates === "content"
                              ? `/w/${workspaceId}/studio/${step.linkedId}`
                              : step.creates === "ticket"
                                ? `/w/${workspaceId}/tickets/${step.linkedId}`
                                : `/w/${workspaceId}/docs`
                          }
                          className="text-brand-teal hover:underline"
                        >
                          View {step.creates !== "none" ? SOP_CREATES_META[step.creates].label.toLowerCase() : "linked item"} →
                        </Link>
                      </>
                    ) : null}
                  </div>

                  {step.rejectionReason ? (
                    <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                      <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                        <AlertCircle className="size-3.5 shrink-0" />
                        <span>Returned Gate Feedback:</span>
                      </div>
                      <p className="mt-1 text-xs text-rose-200/90 whitespace-pre-wrap">
                        {step.rejectionReason}
                      </p>
                    </div>
                  ) : null}

                  {/* A blocked step must say what it waits on. "Blocked" with
                      no reason is the single most common way a process
                      stalls without anyone knowing whose move it is. */}
                  {step.status === "blocked" && openBlockers.length > 0 ? (
                    <p className="mt-2 text-xs text-amber-300/80">
                      Waiting on:{" "}
                      {openBlockers.map((b) => b.title).join(", ")}
                    </p>
                  ) : null}
                  {atRisk ? (
                    <p className="mt-2 text-xs text-amber-300/70">
                      At risk — something this waits on is already late.
                    </p>
                  ) : null}
                  {step.status === "blocked" && openBlockers.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      Nothing outstanding — ready to pick up.
                    </p>
                  ) : null}
                  {step.gate !== "none" ? (
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      {SOP_GATE_META[step.gate].hint}
                    </p>
                  ) : null}

                  {/* A compliance gate closes when the check passes on a
                      LINKED draft. With nothing linked there is nothing to
                      check, so the step could sit unclosable forever — say
                      so rather than letting the run quietly stall. */}
                  {step.gate === "compliance" &&
                  !step.linkedId &&
                  step.creates !== "content" ? (
                    <p className="mt-2 text-xs text-amber-300/80">
                      No draft to check, so this gate can&apos;t close. Set
                      this step to create a content draft in the template.
                    </p>
                  ) : null}

                  {/* A3 — Next-Action Suggestion button & panel */}
                  {open && (step.status === "blocked" || overdue || atRisk) ? (
                    <div className="mt-3">
                      {!suggestState.suggestion ? (
                        <form action={suggestAction}>
                          {hidden}
                          <PendingButton
                            label="✨ Suggest Action"
                            pending="Analyzing step..."
                            variant="ghost"
                          />
                        </form>
                      ) : null}

                      {suggestState.error ? (
                        <p className="mt-1 text-xs text-amber-300">{suggestState.error}</p>
                      ) : null}

                      {suggestState.suggestion ? (
                        <div className="mt-2 rounded border border-brand-teal/30 bg-brand-teal/5 p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-brand-teal">AI Suggestion</span>
                            <Badge
                              variant="outline"
                              className={
                                suggestState.suggestion.urgency === "high"
                                  ? "border-destructive/40 text-destructive"
                                  : "border-brand-teal/40 text-brand-teal"
                              }
                            >
                              {suggestState.suggestion.urgency} urgency
                            </Badge>
                          </div>
                          <p className="mt-1 font-medium text-foreground">
                            {suggestState.suggestion.action}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {suggestState.suggestion.reason}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant="outline" className={STATUS_CHIP[step.status]}>
            {STATUS_LABEL[step.status]}
          </Badge>
          {step.gate !== "none" ? (
            <Badge variant="outline" className="border-border text-muted-foreground/70">
              {SOP_GATE_META[step.gate].label}
            </Badge>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {/* Only an unblocked step offers a move. A blocked one shows what
              it waits on instead — the graph, not the button, decides. */}
          {step.status === "ready" || step.status === "in_progress" ? (
            <form action={moveAction}>
              {hidden}
              <PendingButton
                label={step.status === "ready" ? "Start" : "Mark done"}
                pending={step.status === "ready" ? "Starting…" : "Saving…"}
              />
            </form>
          ) : null}

          <form action={assignAction}>
            {hidden}
            <input type="hidden" name="assigneeId" value={viewerId} />
            {!step.assigneeId ? (
              <PendingButton
                label="Claim"
                pending="Claiming…"
                variant="outline"
              />
            ) : null}
          </form>

          <form action={assignAction} className="flex items-center gap-1.5">
            {hidden}
            <select
              name="assigneeId"
              defaultValue={step.assigneeId ?? ""}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-xs text-muted-foreground"
              aria-label={`Owner of ${step.title}`}
            >
              <option value="" className="bg-popover">
                Unassigned
              </option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId} className="bg-popover">
                  {m.label}
                </option>
              ))}
            </select>
            <PendingButton label="Set" pending="…" variant="ghost" />
          </form>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(isProposingCascade)}
            onClick={() => onTriggerCascade(step.id)}
            className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 flex items-center gap-1"
          >
            {isProposingCascade === step.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="w-3.5 h-3.5" />
            )}
            <span>Cascade Schedule</span>
          </Button>

          {/* Created on demand, not at instantiation: a 14-step template
              would otherwise dump 14 empty drafts into the workspace the
              moment anyone started a run. */}
          {step.creates !== "none" && !step.linkedId ? (
            <form action={materialiseAction}>
              {hidden}
              <PendingButton
                label={`Create ${SOP_CREATES_META[step.creates].label.toLowerCase()}`}
                pending="Creating…"
                variant="outline"
              />
            </form>
          ) : null}

          <form action={skipAction} className="ml-auto">
            {hidden}
            <PendingButton
              label="Skip"
              pending="Skipping…"
              variant="ghost"
            />
          </form>
        </div>
      ) : null}

      {/* Offered only on a step that has actually slipped, and never applied
          automatically: a due date is a commitment other people planned
          around, so a human decides whether the rest of the run moves. */}
      {open && lateBy > 0 ? (
        <form
          action={rescheduleAction}
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
        >
          {hidden}
          <span className="text-xs text-amber-300">
            {lateBy} day{lateBy === 1 ? "" : "s"} late.
          </span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            Shift everything downstream by
            <input
              type="number"
              name="days"
              defaultValue={lateBy}
              min={-365}
              max={365}
              step={1}
              className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
              aria-label={`Days to shift steps after ${step.title}`}
            />
            days
          </label>
          <PendingButton
            label="Reschedule downstream"
            pending="Rescheduling…"
            variant="outline"
          />
        </form>
      ) : null}

      {rescheduleState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {rescheduleState.error}
        </p>
      ) : null}

      {materialiseState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {materialiseState.error}
        </p>
      ) : null}

      {moveState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {moveState.error}
        </p>
      ) : null}
      {skipState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {skipState.error}
        </p>
      ) : null}
      {assignState?.error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {assignState.error}
        </p>
      ) : null}
    </GlassCard>
  );
}

function RunActivityTimeline({
  activities,
  steps,
}: {
  activities: SerializedSopRunActivity[];
  steps: SopRunStepRow[];
}) {
  if (activities.length === 0) return null;
  const stepById = new Map(steps.map((s) => [s.id, s]));

  return (
    <GlassCard className="mt-8 p-5">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <History className="size-4 text-brand-teal" />
        <p className="label-mono text-foreground font-semibold">Run Activity & Decisions</p>
        <span className="text-xs text-muted-foreground/60">({activities.length})</span>
      </div>
      <div className="mt-4 space-y-3">
        {activities.map((a) => {
          const step = stepById.get(a.subjectId);
          const reason = typeof a.meta?.reason === "string" ? a.meta.reason : null;
          const dateStr = new Date(a.createdAtIso).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });

          return (
            <div
              key={a.id}
              className="flex flex-col gap-1 rounded-lg border border-border/70 bg-card/40 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ActivityBadge verb={a.verb} />
                  {step ? (
                    <span className="font-medium text-foreground">
                      {step.title}
                    </span>
                  ) : null}
                </div>
                <span className="text-[11px] text-muted-foreground/60">{dateStr}</span>
              </div>

              <p className="text-muted-foreground/80">
                By <span className="text-foreground">{a.actorName ?? "System"}</span>
              </p>

              {reason ? (
                <div className="mt-1.5 rounded border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
                  <span className="font-medium text-rose-200">Feedback: </span>
                  <span className="italic">&ldquo;{reason}&rdquo;</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function ActivityBadge({ verb }: { verb: string }) {
  switch (verb) {
    case "gate_rejected":
      return (
        <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300 text-[10px]">
          Gate Rejected
        </Badge>
      );
    case "gate_approved":
      return (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px]">
          Gate Approved
        </Badge>
      );
    case "run_cancelled":
      return (
        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive text-[10px]">
          Run Cancelled
        </Badge>
      );
    case "reopened":
      return (
        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px]">
          Step Reopened
        </Badge>
      );
    case "rescheduled_downstream":
      return (
        <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-300 text-[10px]">
          Rescheduled
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">
          {verb.replace(/_/g, " ")}
        </Badge>
      );
  }
}

